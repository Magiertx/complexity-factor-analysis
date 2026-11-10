"""Where jobs run: Celery with REDIS_URL, else in this process under a slot limit."""

from __future__ import annotations

import asyncio
import sys
import types
import uuid

import pytest
from fastapi import BackgroundTasks

import job_runner
import jobs_db


def _run(coro):
    return asyncio.run(coro)


async def _drain(tasks: BackgroundTasks) -> None:
    await tasks()


def test_without_redis_the_job_runs_here(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    seen = []

    async def local(*args):
        seen.append(args)

    tasks = BackgroundTasks()
    job_runner.enqueue(tasks, celery_task="x.y", local=local, args=(1, "a"), label="job")
    assert seen == []  # deferred to the background task, like before
    _run(_drain(tasks))
    assert seen == [(1, "a")]


def test_with_redis_the_job_goes_to_celery_with_the_same_args(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://example:6379/0")
    monkeypatch.setattr(job_runner, "uses_celery", lambda: True)
    sent = []
    fake = types.SimpleNamespace(celery_app=types.SimpleNamespace(
        send_task=lambda name, args: sent.append((name, args))))
    monkeypatch.setitem(sys.modules, "celery_worker", fake)

    async def local(*args):
        raise AssertionError("must not run here")

    tasks = BackgroundTasks()
    job_runner.enqueue(tasks, celery_task="celery_worker.run_analysis", local=local, args=("j", "p", {"k": 1}, "comfy"), label="job")
    _run(_drain(tasks))
    assert sent == [("celery_worker.run_analysis", ["j", "p", {"k": 1}, "comfy"])]


def test_when_celery_cannot_be_reached_the_job_runs_here(monkeypatch):
    monkeypatch.setattr(job_runner, "uses_celery", lambda: True)

    def broken(name, args):
        raise ConnectionError("no broker")

    monkeypatch.setitem(sys.modules, "celery_worker", types.SimpleNamespace(
        celery_app=types.SimpleNamespace(send_task=broken)))
    seen = []

    async def local(*args):
        seen.append(args)

    tasks = BackgroundTasks()
    job_runner.enqueue(tasks, celery_task="t", local=local, args=(1,), label="job")
    _run(_drain(tasks))
    assert seen == [(1,)]


def test_celery_is_never_used_by_the_test_harness(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://example:6379/0")
    assert job_runner.uses_celery() is False
    assert job_runner.runs_jobs_itself() is False  # the harness' databases hold seeded jobs


def test_local_slots_bound_the_jobs_computing_at_once(monkeypatch):
    monkeypatch.setattr(job_runner, "LOCAL_JOB_SLOTS", 2)
    state = {"now": 0, "max": 0, "done": 0}

    async def local(i):
        state["now"] += 1
        state["max"] = max(state["max"], state["now"])
        await asyncio.sleep(0.05)
        state["now"] -= 1
        state["done"] += 1

    async def main():
        # Several requests, each with its own background tasks, like concurrent uploads.
        all_tasks = []
        for i in range(6):
            tasks = BackgroundTasks()
            job_runner.enqueue(tasks, celery_task="t", local=local, args=(i,), label="job")
            all_tasks.append(tasks)
        await asyncio.gather(*(t() for t in all_tasks))

    _run(main())
    assert state["done"] == 6
    assert state["max"] == 2


def test_a_failing_job_gives_its_slot_back(monkeypatch):
    monkeypatch.setattr(job_runner, "LOCAL_JOB_SLOTS", 1)
    ran = []

    async def bad():
        raise RuntimeError("boom")

    async def good():
        ran.append(1)

    async def main():
        t1, t2 = BackgroundTasks(), BackgroundTasks()
        job_runner.enqueue(t1, celery_task="t", local=bad, args=(), label="bad")
        job_runner.enqueue(t2, celery_task="t", local=good, args=(), label="good")
        results = await asyncio.gather(t1(), t2(), return_exceptions=True)
        return results

    results = _run(main())
    assert isinstance(results[0], RuntimeError)
    assert ran == [1]


def test_a_plain_function_is_run_in_a_thread(monkeypatch):
    seen = []
    tasks = BackgroundTasks()
    job_runner.enqueue(tasks, celery_task="t", local=lambda *a: seen.append(a), args=(1,), label="job")
    _run(_drain(tasks))
    assert seen == [(1,)]


def test_the_slot_setting_is_validated(monkeypatch):
    import importlib

    import env_config

    monkeypatch.setenv("LOCAL_JOB_SLOTS", "0")
    with pytest.raises(env_config.ConfigError):
        importlib.reload(job_runner)
    monkeypatch.setenv("LOCAL_JOB_SLOTS", "3")
    assert importlib.reload(job_runner).LOCAL_JOB_SLOTS == 3
    monkeypatch.delenv("LOCAL_JOB_SLOTS")
    assert importlib.reload(job_runner).LOCAL_JOB_SLOTS == 2
    env_config.OVERRIDES.pop("LOCAL_JOB_SLOTS", None)


def test_a_job_started_through_the_api_runs_in_process(client, stub_algorithm):
    """End to end through the route: the upload's job is done once the response is."""
    xes = b"<?xml version='1.0'?><log><trace><event><string key='concept:name' value='A'/></event></trace></log>"
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("log.xes", xes, "application/xml")},
    )
    assert r.status_code == 200, r.text
    job = client.get(f"/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "completed"


def test_interrupted_jobs_are_failed_and_leave_the_quotas(client):
    pending, running, done = (str(uuid.uuid4()) for _ in range(3))

    async def main():
        for j in (pending, running, done):
            await jobs_db.create_job(j, "_stability:model", "S", "x", {})
        await jobs_db.update_job_progress(running, 10.0, "r", status="running")
        await jobs_db.update_job_progress(done, 100.0, "d", status="completed")
        assert await jobs_db.count_active_jobs_by_prefix("_stability:") == 2
        n = await jobs_db.fail_interrupted_jobs()
        return n, await jobs_db.count_active_jobs_by_prefix("_stability:"), \
            [await jobs_db.read_job(j) for j in (pending, running, done)]

    n, active, jobs = _run(main())
    assert n == 2 and active == 0
    assert [j["status"] for j in jobs] == ["failed", "failed", "completed"]
    assert "interrupted" in jobs[0]["error"]
    assert jobs[0]["error_code"] == "interrupted"


def test_startup_fails_interrupted_jobs_only_when_the_process_runs_them(monkeypatch):
    from fastapi.testclient import TestClient

    from srv_main import app

    job = str(uuid.uuid4())
    _run(jobs_db.create_job(job, "comfy", "ComFy", "x", {}))

    # Seeded jobs survive the start in the harness (and with a Celery worker around).
    with TestClient(app):
        pass
    assert _run(jobs_db.read_job(job))["status"] == "pending"

    monkeypatch.setattr(job_runner, "runs_jobs_itself", lambda: True)
    with TestClient(app):
        pass
    after = _run(jobs_db.read_job(job))
    assert after["status"] == "failed" and after["error_code"] == "interrupted"
