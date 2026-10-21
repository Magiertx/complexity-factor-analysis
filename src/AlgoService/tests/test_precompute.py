"""The analyses of the bundled datasets computed after startup (factor_analysis/precompute.py):
what they compute, that a first open finds the fit in the cache, and how the server starts them."""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict

import pytest

from factor_analysis import core, precompute
from factor_analysis.catalog import manifest

PAPER = "comfy-paper-inductive-miner"
HEURISTICS = "comfy-paper-heuristics-miner"
LOG = "comfy-log-pdc-training-logs"


@pytest.fixture
def fits(monkeypatch):
    """An empty fit cache for the test, and the fits it computes, as (factors, rotation)."""
    monkeypatch.setattr(core, "_FIT_CACHE", OrderedDict())
    calls: list[tuple[int, str]] = []
    original = core._fit_factors

    def counting(data, n_factors, rotation, should_stop=None):
        calls.append((n_factors, rotation))
        return original(data, n_factors, rotation, should_stop)

    monkeypatch.setattr(core, "_fit_factors", counting)
    return calls


async def _analyze(data, params):
    return core.analyze(data, params)


def _precompute(dataset_id: str):
    selected = [j for j in precompute.jobs() if j.dataset_id == dataset_id]
    return asyncio.run(precompute.run(_analyze, selected))


def _open(client, dataset_id: str, kind: str, options: dict) -> dict:
    created = client.post(
        "/factor-analysis/datasets", data={"kind": kind, "source": "bundled", "bundled_id": dataset_id}
    ).json()
    r = client.post(f"/factor-analysis/datasets/{created['dataset_id']}/analyze", json=options)
    assert r.status_code == 200, r.text
    return r.json()


def test_every_bundled_dataset_gets_the_standard_settings_and_those_with_a_paper_its_own():
    entries = manifest()["datasets"]
    jobs = precompute.jobs()
    standard = [j for j in jobs if j.settings == precompute.STANDARD]
    assert [j.dataset_id for j in standard] == [e["id"] for e in entries]
    # What an analyze request without a body uses, which differs by kind.
    by_id = {j.dataset_id: j for j in standard}
    assert (by_id[PAPER].params.n_factors, by_id[PAPER].params.loading_threshold) == (None, 0.35)
    assert (by_id[LOG].params.n_factors, by_id[LOG].params.loading_threshold) == (None, 0.5)

    paper = {j.dataset_id: j for j in jobs if j.settings == precompute.PAPER}
    assert set(paper) == {e["id"] for e in entries if e.get("published_options")}
    assert LOG not in paper
    assert (paper[PAPER].params.n_factors, paper[PAPER].params.assignment_rule) == (4, "multi")
    assert paper[HEURISTICS].params.n_factors == 3
    assert len(jobs) == len(standard) + len(paper)


def test_the_first_open_of_a_bundled_dataset_finds_its_fits_in_the_cache(client, fits):
    done, failed = _precompute(PAPER)
    assert (done, failed) == (2, 0)
    computed = len(fits)
    assert computed == 2  # the Kaiser count of the standard settings, and the paper's four factors

    standard = _open(client, PAPER, "model", {})
    paper_options = next(e for e in manifest()["datasets"] if e["id"] == PAPER)["published_options"]
    paper = _open(client, PAPER, "model", paper_options)
    assert len(fits) == computed, "the analyses of the first open fitted again"
    assert standard["n_factors"] != paper["n_factors"] == 4
    # The same numbers as an analysis that had to compute the fit itself.
    assert paper["published_match"]["status"] == "match"


def test_a_first_open_after_the_precomputation_fits_nothing_for_the_log_data(client, fits):
    _precompute(LOG)
    assert len(fits) == 1

    started = time.perf_counter()
    result = _open(client, LOG, "log", {})
    assert len(fits) == 1, "the analysis of the log data fitted again"
    assert result["n_factors"] > 1
    # Not a measurement of the fit, which takes seconds on the machine of a test run.
    assert time.perf_counter() - started < 10


def test_a_failed_analysis_does_not_stop_the_others(fits):
    jobs = [j for j in precompute.jobs() if j.dataset_id in (PAPER, HEURISTICS)]
    seen: list[str] = []

    async def analyze(data, params):
        seen.append(f"{params.n_factors}")
        if len(seen) == 1:
            raise RuntimeError("boom")
        return core.analyze(data, params)

    done, failed = asyncio.run(precompute.run(analyze, jobs))
    assert (done, failed) == (len(jobs) - 1, 1)
    assert len(seen) == len(jobs)


def test_it_stays_off_under_test_whatever_the_environment_says(monkeypatch):
    monkeypatch.setenv("PRECOMPUTE_BUNDLED", "1")
    assert precompute.enabled() is False


@pytest.fixture
def started(monkeypatch):
    """Whether the server started the precomputation, and a way to tell that it was cancelled."""
    from routes import factor_analysis as routes

    state = {"started": False, "cancelled": False}

    async def stub() -> None:
        state["started"] = True
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    monkeypatch.setattr(routes, "precompute_bundled", stub)
    return state


def test_the_server_starts_it_in_the_background_when_it_is_on(isolated_jobs_dir, monkeypatch, started):
    from fastapi.testclient import TestClient
    from srv_main import app

    monkeypatch.setattr(precompute, "enabled", lambda: True)
    with TestClient(app) as client:
        # Requests are answered while it runs; it does not hold up the start.
        assert client.get("/health").status_code == 200
        deadline = time.time() + 5
        while not started["started"] and time.time() < deadline:
            time.sleep(0.05)
        assert started["started"]
    # Stopping the server cancels it instead of waiting for it.
    assert started["cancelled"]


def test_the_server_does_not_start_it_when_it_is_off(isolated_jobs_dir, monkeypatch, started):
    from fastapi.testclient import TestClient
    from srv_main import app

    monkeypatch.setattr(precompute, "enabled", lambda: False)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        time.sleep(0.3)
    assert started == {"started": False, "cancelled": False}
