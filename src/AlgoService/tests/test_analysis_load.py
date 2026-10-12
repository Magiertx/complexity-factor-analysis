"""What keeps analyses from loading the server: the measure cap, and giving up analyses
nobody waits for any more."""

from __future__ import annotations

import threading
import time

import numpy as np
import pandas as pd
import pytest

from factor_analysis import core


def _wide_csv(columns: int, rows: int = 12) -> bytes:
    rng = np.random.default_rng(1)
    table = pd.DataFrame(rng.normal(size=(rows, columns)), columns=[f"m{i}" for i in range(columns)])
    return table.to_csv(index_label="observation").encode()


def test_the_cap_counts_the_measures_left_after_excluding(monkeypatch):
    monkeypatch.setattr(core, "MAX_MEASURES", 5)
    data = pd.DataFrame(np.random.default_rng(0).normal(size=(40, 6)), columns=list("abcdef"))
    with pytest.raises(core.AnalysisError) as e:
        core.analyze(data, core.AnalysisParams())
    assert e.value.code == "too_many_measures_for_analysis"
    assert e.value.params == {"max": 5, "n": 6}
    core.analyze(data, core.AnalysisParams(excluded=["f"], auto_msa_filter=False, n_factors=1))


def test_an_analysis_over_400_measures_is_refused_before_anything_runs(client, monkeypatch):
    def no_fit(*args, **kwargs):
        raise AssertionError("fitted despite the cap")

    monkeypatch.setattr(core, "kmo", no_fit)
    monkeypatch.setattr(core, "_fit_factors", no_fit)
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv"},
        files=[("files", ("wide.csv", _wide_csv(401), "text/csv"))],
    )
    assert r.status_code == 200, r.text
    url = f"/factor-analysis/datasets/{r.json()['dataset_id']}"

    r = client.post(f"{url}/analyze", json={})
    assert r.status_code == 400
    assert r.json()["code"] == "too_many_measures_for_analysis"
    assert r.json()["params"] == {"max": 400, "n": 401}
    assert "Exclude measures" in r.json()["detail"]
    # Saving such options is refused the same way.
    assert client.put(f"{url}/options", json={}).json()["code"] == "too_many_measures_for_analysis"
    # One excluded measure brings it down to the cap; then the 12 rows are too few.
    r = client.post(f"{url}/analyze", json={"excluded": ["m0"]})
    assert r.json()["code"] == "too_few_observations"


# --- latest wins -------------------------------------------------------------------------

#: How long the stub fit below takes, in seconds.
FIT_S = 2.0


@pytest.fixture
def slow_fit(monkeypatch):
    """A fit that takes FIT_S and gives up like the real one when it is no longer wanted;
    returns the rotations it was started with. Fresh slots, because an asyncio semaphore that
    had to make a request wait stays bound to the event loop of that test."""
    import asyncio

    from routes import factor_analysis as route

    started = []
    real = core._fit_factors

    def slow(data, n_factors, rotation, should_stop=None):
        started.append(rotation)
        deadline = time.perf_counter() + FIT_S
        while time.perf_counter() < deadline:
            core._check_stop(should_stop)
            time.sleep(0.01)
        return real(data, n_factors, rotation, should_stop)

    monkeypatch.setattr(core, "_fit_factors", slow)
    monkeypatch.setattr(route, "_ANALYSIS_SLOTS", asyncio.Semaphore(2))
    core._FIT_CACHE.clear()
    yield started
    core._FIT_CACHE.clear()


def _inductive(client) -> str:
    r = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner",
    })
    return f"/factor-analysis/datasets/{r.json()['dataset_id']}"


def _overlapping(client, url: str, bodies: list[dict], gap_s: float = 0.05, query: str = "") -> tuple[list, float]:
    """Send the bodies ``gap_s`` apart, each without waiting for the one before; returns the
    responses in order and the seconds until the last one came back."""
    responses: list = [None] * len(bodies)

    def send(i: int, body: dict) -> None:
        time.sleep(i * gap_s)
        responses[i] = client.post(f"{url}/analyze{query}", json=body)

    threads = [threading.Thread(target=send, args=(i, b)) for i, b in enumerate(bodies)]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return responses, time.perf_counter() - start


def test_only_the_newest_of_overlapping_analyses_is_computed(client, slow_fit):
    url = _inductive(client)
    rotations = ["varimax", "promax", "oblimin", "quartimax", "promax"]
    bodies = [{"n_factors": 3 + i % 2, "rotation": rotation} for i, rotation in enumerate(rotations)]
    responses, elapsed = _overlapping(client, url, bodies)

    assert [r.status_code for r in responses] == [409, 409, 409, 409, 200]
    for r in responses[:4]:
        assert r.json() == {
            "detail": "A newer analysis of this dataset replaced this one, or the client left.",
            "code": "superseded",
            "params": {},
        }
    last = responses[-1].json()
    assert (last["n_factors"], last["rotation"]) == (3, "promax")
    assert last["elapsed_ms"] >= FIT_S * 1000
    # Five fits one after the other in two slots would take three; the newest alone one.
    assert elapsed <= 1.5 * FIT_S, elapsed


def test_identical_overlapping_analyses_share_one_fit(client, slow_fit):
    url = _inductive(client)
    responses, elapsed = _overlapping(client, url, [{"n_factors": 3, "rotation": "promax"}] * 5)
    # A newer request for the same parameters replaces none; all get the one fit.
    assert slow_fit == ["promax"]
    assert [r.status_code for r in responses] == [200] * 5
    assert all(r.json()["loadings"] == responses[0].json()["loadings"] for r in responses)
    assert elapsed <= 1.25 * FIT_S, elapsed


def test_a_fit_runs_on_while_anybody_waits_for_it(slow_fit):
    data = pd.DataFrame(np.random.default_rng(4).normal(size=(60, 5)), columns=list("abcde"))
    leave = threading.Event()
    fits = {}

    def ask(name: str, should_stop) -> None:
        try:
            fits[name] = core.fit_factors(data, 2, "varimax", should_stop)
        except core.Superseded:
            fits[name] = None

    first = threading.Thread(target=ask, args=("first", leave.is_set))
    second = threading.Thread(target=ask, args=("second", None))
    first.start()
    time.sleep(0.2)
    second.start()
    time.sleep(0.2)
    # The first caller, which started the fit, leaves at once; the fit goes on for the second.
    start = time.perf_counter()
    leave.set()
    first.join()
    assert time.perf_counter() - start < FIT_S / 2
    second.join()
    assert slow_fit == ["varimax"]
    assert fits["first"] is None
    assert fits["second"] is core._FIT_CACHE[core._fit_key(data, 2, "varimax")]
    assert not core._IN_FLIGHT


def test_a_superseded_analysis_does_not_wait_for_parallel_analysis(client, monkeypatch):
    """Parallel analysis of an upload of 100,000 rows takes a minute. A request replaced while
    it runs answers at once and frees its slot; the samples go on for the newer request, which
    has the same size of data and so needs the same ones."""
    import asyncio

    from routes import factor_analysis as route

    url = _inductive(client)
    core._RANDOM_EIGENVALUES.clear()
    real = core._corr

    def slow_corr(x):
        time.sleep(FIT_S / core.PARALLEL_ANALYSIS_SIMULATIONS)
        return real(x)

    monkeypatch.setattr(core, "_corr", slow_corr)
    monkeypatch.setattr(route, "_ANALYSIS_SLOTS", asyncio.Semaphore(2))
    answered: dict[int, tuple[int, float]] = {}

    def send(i: int, delay: float) -> None:
        time.sleep(delay)
        start = time.perf_counter()
        r = client.post(f"{url}/analyze", json={"n_factors": i + 1})
        answered[i] = (r.status_code, time.perf_counter() - start)

    threads = [threading.Thread(target=send, args=(i, 0.2 * i)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert answered[0][0] == 409 and answered[0][1] < FIT_S / 2, answered
    assert answered[1][0] == 200
    assert core._RANDOM_EIGENVALUES[(288, 10)]
    core._RANDOM_EIGENVALUES.clear()


def test_latest_wins_false_computes_every_analysis(client, slow_fit):
    url = _inductive(client)
    bodies = [{"n_factors": 2}, {"n_factors": 3}]
    responses, elapsed = _overlapping(client, url, bodies, query="?latest_wins=false")
    assert [r.status_code for r in responses] == [200, 200]
    assert [r.json()["n_factors"] for r in responses] == [2, 3]


def test_another_dataset_does_not_replace_an_analysis(client, slow_fit):
    first, second = _inductive(client), _inductive(client)
    results = {}

    def send(name: str, url: str, delay: float) -> None:
        time.sleep(delay)
        results[name] = client.post(f"{url}/analyze", json={"n_factors": 2})

    threads = [
        threading.Thread(target=send, args=("first", first, 0)),
        threading.Thread(target=send, args=("second", second, 0.05)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert {name: r.status_code for name, r in results.items()} == {"first": 200, "second": 200}


def test_the_newest_request_counts_per_session_and_dataset():
    from routes import factor_analysis as route

    latest = route._Latest()
    one, two = ("session-1", "dataset"), ("session-2", "dataset")
    a = latest.take(one, "k=2")
    b = latest.take(two, "k=2")
    assert latest.is_newest(one, a, "k=2") and latest.is_newest(two, b, "k=2")
    c = latest.take(one, "k=3")
    assert not latest.is_newest(one, a, "k=2") and latest.is_newest(one, c, "k=3")
    # The same parameters again: the older request is as good as the newest.
    d = latest.take(one, "k=3")
    assert latest.is_newest(one, c, "k=3") and latest.is_newest(one, d, "k=3")
    # An older request ending leaves the newer one alone.
    latest.release(one)
    assert latest.is_newest(one, d, "k=3")
    # The newest ending first leaves an older one with the same parameters, which may not have
    # reached its last stop check yet, as good as the newest.
    e = latest.take(one, "k=4")
    latest.take(one, "k=4")
    latest.release(one)
    assert latest.is_newest(one, e, "k=4") and not latest.is_newest(one, d, "k=3")
    # The last open request of the session and dataset clears the entry.
    for _ in (a, d, e):
        latest.release(one)
    assert latest._newest == {two: (b, "k=2")} and latest._open == {two: 1}


def test_a_request_whose_client_left_is_not_fitted(slow_fit):
    import asyncio

    from routes import factor_analysis as route

    data = pd.DataFrame(np.random.default_rng(0).normal(size=(40, 4)), columns=list("abcd"))
    # Random data: no measure would survive the MSA filter.
    params = core.AnalysisParams(n_factors=1, auto_msa_filter=False)

    class Left:
        async def receive(self) -> dict:
            return {"type": "http.disconnect"}

    class LeavesDuringTheFit:
        async def receive(self) -> dict:
            await asyncio.sleep(0.3)
            return {"type": "http.disconnect"}

    with pytest.raises(core.Superseded):
        asyncio.run(route._analyze(data, params, route._Watch(Left())))
    assert slow_fit == []

    start = time.perf_counter()
    with pytest.raises(core.Superseded):
        asyncio.run(route._analyze(data, params, route._Watch(LeavesDuringTheFit())))
    assert slow_fit == ["varimax"]
    assert time.perf_counter() - start < FIT_S / 2


def test_a_fit_given_up_is_not_cached():
    data = pd.DataFrame(np.random.default_rng(3).normal(size=(60, 5)), columns=list("abcde"))
    core._FIT_CACHE.clear()
    with pytest.raises(core.Superseded):
        core.fit_factors(data, 2, "varimax", should_stop=lambda: True)
    assert not core._FIT_CACHE
    stopped_late = core.fit_factors(data, 2, "varimax", should_stop=lambda: False)
    assert core.fit_factors(data, 2, "varimax") is stopped_late
    # The stoppable fit is factor_analyzer's own, to the last bit.
    from factor_analyzer import FactorAnalyzer

    plain = FactorAnalyzer(n_factors=2, rotation="varimax").fit(data.to_numpy())
    assert np.array_equal(stopped_late.loadings.to_numpy(), plain.loadings_)
