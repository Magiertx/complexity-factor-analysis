"""Progress updates of a job are written before the job ends.

Under Celery the event loop of a worker process runs only while a task runs
(``celery_worker.py``: ``run_until_complete``). A progress update that the worker thread
handed to the loop and that was still in flight when the task returned stayed suspended
inside its database transaction; its row lock then held every later write to the run, a
delete as well, until the process ran its next task.
"""

from __future__ import annotations

import asyncio

import pandas as pd


def test_settle_waits_for_every_submitted_call():
    from routes.algorithms import _LoopCalls

    finished: list[int] = []

    async def update(i: int) -> None:
        await asyncio.sleep(0.02)
        finished.append(i)

    async def task() -> None:
        calls = _LoopCalls(asyncio.get_running_loop())

        def work() -> None:
            for i in range(5):
                calls.submit(update(i))

        await asyncio.to_thread(work)
        await calls.settle()

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(task())
    finally:
        loop.close()
    assert sorted(finished) == [0, 1, 2, 3, 4]


def test_settle_logs_a_failed_call_instead_of_raising():
    from routes.algorithms import _LoopCalls

    async def broken() -> None:
        raise RuntimeError("database gone")

    async def task() -> None:
        calls = _LoopCalls(asyncio.get_running_loop())
        await asyncio.to_thread(calls.submit, broken())
        await calls.settle()
        assert calls.futures == []

    asyncio.run(task())


def test_a_dataset_job_run_like_celery_leaves_no_update_behind(monkeypatch, isolated_jobs_dir):
    """The job runs on a loop of its own that stops when the task returns, as in the worker."""
    import uuid

    import database
    import jobs_db
    from factor_analysis import storage
    from routes import factor_analysis as fa

    started: list[str] = []
    finished: list[str] = []
    original = jobs_db.update_job_progress

    async def slow_update(job_id: str, percentage: float, status_msg: str, status: str = "running") -> None:
        started.append(status_msg)
        await asyncio.sleep(0.05)
        await original(job_id, percentage, status_msg, status)
        finished.append(status_msg)

    def compute(spec, progress):
        for pct in range(0, 100, 10):
            progress(float(pct), "working")
        table = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0], "b": [2.0, 1.0, 4.0, 3.0]}, index=list("wxyz"))
        return fa.compute.ComputeResult(table)

    monkeypatch.setattr(jobs_db, "update_job_progress", slow_update)
    monkeypatch.setattr(fa, "_compute", compute)
    # Every percentage is written, not only one every half second.
    monkeypatch.setattr(fa._ProgressThrottle, "should_persist", lambda self, pct: True)

    session_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
    meta = storage.create(session_id, kind="model", name="t", source="csv", status="computing", inputs={"files": 1})

    async def run() -> None:
        await jobs_db.init_db()
        await jobs_db.get_or_create_session(session_id)
        await jobs_db.create_job(job_id, algorithm_id="_dataset:model", algorithm_name="Dataset",
                                 filename="t", params={}, session_id=session_id)
        await fa.run_dataset_task(job_id, session_id, meta["id"], {"kind": "model", "source": "csv"})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
        assert started.count("working") == 10
        assert finished.count("working") == 10
        job = loop.run_until_complete(jobs_db.read_job(job_id))
        assert job["status"] == "completed"
    finally:
        loop.run_until_complete(database.engine.dispose())
        loop.close()
