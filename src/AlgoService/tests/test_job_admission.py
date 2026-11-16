"""The job limits hold for requests that come in at the same time.

Counting the jobs and creating the new one are one step: requests that all counted before any of
them created its job would all be let in (seen on the server: seven dataset jobs with a cap of
four, three stabilities with a cap of two). The counts here wait a moment after counting, so that
every request counts before any creates its job unless the step is guarded.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

PNML_SAMPLE = "pdc-sample-models"
BUNDLED = "comfy-paper-inductive-miner"


@pytest.fixture
def slow_counts(monkeypatch):
    """Every count of active jobs yields to the other requests before it answers."""
    import jobs_db

    by_prefix, by_session = jobs_db.count_active_jobs_by_prefix, jobs_db.count_active_jobs

    async def count_by_prefix(prefix: str) -> int:
        n = await by_prefix(prefix)
        await asyncio.sleep(0.05)
        return n

    async def count_of_session(session_id: str) -> int:
        n = await by_session(session_id)
        await asyncio.sleep(0.05)
        return n

    monkeypatch.setattr(jobs_db, "count_active_jobs_by_prefix", count_by_prefix)
    monkeypatch.setattr(jobs_db, "count_active_jobs", count_of_session)


@pytest.fixture
def jobs_stay_queued(monkeypatch):
    """The jobs are created but never run, so they stay active."""
    from routes import factor_analysis as fa

    async def queued(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(fa, "run_dataset_task", queued)
    monkeypatch.setattr(fa, "run_stability_task", queued)
    # The fits of the stability requests wait for a slot; a semaphore of this test's own keeps the
    # module's one from binding to this test's event loop.
    monkeypatch.setattr(fa, "_ANALYSIS_SLOTS", asyncio.Semaphore(2))


def _at_once(client, requests: list[tuple[str, dict]]) -> list[httpx.Response]:
    """POST every (url, kwargs) at the same time, in the app's own event loop."""
    from srv_main import app

    async def run() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver", cookies=dict(client.cookies)
        ) as c:
            return list(await asyncio.gather(*(c.post(url, **kw) for url, kw in requests)))

    return client.portal.call(run)


def _active(prefix: str) -> int:
    import jobs_db

    async def count() -> int:
        return await jobs_db.count_active_jobs_by_prefix(prefix)

    return asyncio.run(count())


def _dataset_request() -> tuple[str, dict]:
    return "/factor-analysis/datasets", {"data": {"kind": "model", "source": "pnml", "bundled_id": PNML_SAMPLE}}


def test_the_cap_of_dataset_jobs_holds_for_simultaneous_requests(client, slow_counts, jobs_stay_queued):
    from routes import factor_analysis as fa

    cap = fa.MAX_ACTIVE_DATASET_JOBS
    answers = _at_once(client, [_dataset_request() for _ in range(cap + 3)])
    statuses = sorted(r.status_code for r in answers)
    assert statuses == [200] * cap + [429] * 3, [r.text for r in answers]
    assert {r.json()["code"] for r in answers if r.status_code == 429} == {"dataset_jobs_busy"}
    assert _active("_dataset:") == cap


def test_the_session_quota_holds_for_simultaneous_requests(client, monkeypatch, slow_counts, jobs_stay_queued):
    import jobs_db

    monkeypatch.setattr(jobs_db, "MAX_ACTIVE_JOBS_PER_SESSION", 2)
    assert client.get("/factor-analysis/datasets").status_code == 200  # one session for all requests
    assert dict(client.cookies)
    answers = _at_once(client, [_dataset_request() for _ in range(4)])
    assert sorted(r.status_code for r in answers) == [200, 200, 429, 429], [r.text for r in answers]
    assert {r.json()["code"] for r in answers if r.status_code == 429} == {"job_quota"}


def test_a_refused_upload_leaves_no_job_and_no_dataset(client, jobs_stay_queued):
    """The job is created before the uploads are stored; an upload that is refused takes it along."""
    import jobs_db
    from factor_analysis import storage

    files = [("files", ("broken.xes", b"<log", "application/xml"))]
    r = client.post("/factor-analysis/datasets", data={"kind": "log", "source": "logs"}, files=files)
    assert r.status_code == 400 and r.json()["code"] == "xes_invalid"
    assert asyncio.run(jobs_db.list_jobs()) == []
    assert list(storage.root().glob("*/*")) == []


def test_the_cap_of_stabilities_holds_for_simultaneous_requests(client, slow_counts, jobs_stay_queued):
    from routes import factor_analysis as fa

    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    url = f"/factor-analysis/datasets/{r.json()['dataset_id']}/stability"
    cap = fa.MAX_ACTIVE_STABILITY_JOBS
    # Another factor count is another stability.
    answers = _at_once(client, [(url, {"json": {"samples": 100, "n_factors": k}}) for k in range(1, cap + 4)])
    statuses = sorted(r.status_code for r in answers)
    assert statuses == [200] * cap + [429] * 3, [r.text for r in answers]
    assert {r.json()["code"] for r in answers if r.status_code == 429} == {"stability_jobs_busy"}
    assert _active(fa.STABILITY_PREFIX) == cap


def test_the_same_stability_asked_twice_at_once_is_one_job(client, slow_counts, jobs_stay_queued):
    from routes import factor_analysis as fa

    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    url = f"/factor-analysis/datasets/{r.json()['dataset_id']}/stability"
    answers = _at_once(client, [(url, {"json": {"samples": 100}}) for _ in range(3)])
    assert all(r.status_code == 200 and r.json()["status"] == "computing" for r in answers), [r.text for r in answers]
    assert len({r.json()["job_id"] for r in answers}) == 1
    assert _active(fa.STABILITY_PREFIX) == 1
