"""Horn's parallel analysis next to the Kaiser criterion (core.random_eigenvalues)."""

from __future__ import annotations

import io
import json
import threading
import time
import zipfile

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, storage


def test_the_random_eigenvalues_repeat_with_the_seed():
    """The values for 288 observations and 10 measures, as numpy's default generator draws
    them from seed 20261012. A change here means that the suggestions of earlier analyses can
    no longer be repeated."""
    core._RANDOM_EIGENVALUES.clear()
    values = core.random_eigenvalues(288, 10)
    assert len(values) == 10
    assert values[:3] == pytest.approx([1.404335980392367, 1.2640390033837796, 1.188901554097223], rel=1e-9)
    assert values == sorted(values, reverse=True)
    assert core.random_eigenvalues(288, 10) is values


def test_the_random_eigenvalues_are_cached_per_shape(monkeypatch):
    core._RANDOM_EIGENVALUES.clear()
    calls = []
    real = core.np.random.default_rng
    monkeypatch.setattr(core.np.random, "default_rng", lambda seed: calls.append(seed) or real(seed))
    first = core.random_eigenvalues(50, 4)
    assert core.random_eigenvalues(50, 4) is first
    core.random_eigenvalues(51, 4)
    assert calls == [core.PARALLEL_ANALYSIS_SEED] * 2


def _counting_corr(monkeypatch, pause_s: float = 0.0) -> list[int]:
    """Counts the random samples drawn, each optionally slowed down; returns the counter."""
    calls = []
    real = core._corr

    def corr(x):
        calls.append(1)
        time.sleep(pause_s)
        return real(x)

    monkeypatch.setattr(core, "_corr", corr)
    return calls


def test_parallel_analysis_stops_between_samples_and_caches_nothing_then(monkeypatch):
    """An upload of 100,000 rows takes a minute of samples; an analysis nobody waits for any
    more must not hold its slot for that long."""
    core._RANDOM_EIGENVALUES.clear()
    calls = _counting_corr(monkeypatch)
    with pytest.raises(core.Superseded):
        core.random_eigenvalues(40, 4, should_stop=lambda: len(calls) >= 3)
    assert len(calls) == 3
    assert (40, 4) not in core._RANDOM_EIGENVALUES and not core._RANDOM_IN_FLIGHT
    # Asked again, it runs to the end, with the same values as without a stop check.
    values = core.random_eigenvalues(40, 4, should_stop=lambda: False)
    assert len(calls) == 3 + core.PARALLEL_ANALYSIS_SIMULATIONS
    core._RANDOM_EIGENVALUES.clear()
    assert core.random_eigenvalues(40, 4) == values


def test_parallel_analysis_asked_for_twice_at_once_runs_once(monkeypatch):
    core._RANDOM_EIGENVALUES.clear()
    calls = _counting_corr(monkeypatch, pause_s=0.005)
    results = {}

    def ask(name: str) -> None:
        results[name] = core.random_eigenvalues(30, 5, should_stop=lambda: False)

    threads = [threading.Thread(target=ask, args=(name,)) for name in ("first", "second")]
    for t in threads:
        t.start()
        time.sleep(0.05)
    for t in threads:
        t.join()
    assert len(calls) == core.PARALLEL_ANALYSIS_SIMULATIONS
    assert results["first"] is results["second"] is core._RANDOM_EIGENVALUES[(30, 5)]


def test_parallel_analysis_goes_on_while_anybody_waits_for_it(monkeypatch):
    core._RANDOM_EIGENVALUES.clear()
    calls = _counting_corr(monkeypatch, pause_s=0.005)
    leave = threading.Event()
    results = {}

    def ask(name: str, should_stop) -> None:
        try:
            results[name] = core.random_eigenvalues(30, 6, should_stop)
        except core.Superseded:
            results[name] = None

    first = threading.Thread(target=ask, args=("first", leave.is_set))
    second = threading.Thread(target=ask, args=("second", None))
    first.start()
    time.sleep(0.05)
    second.start()
    time.sleep(0.05)
    # The first caller, which started the samples, leaves at once and frees its analysis slot;
    # the samples go on for the second.
    leave.set()
    first.join(timeout=0.3)
    assert not first.is_alive() and results["first"] is None
    second.join()
    assert results["second"] is core._RANDOM_EIGENVALUES[(30, 6)]
    assert len(calls) == core.PARALLEL_ANALYSIS_SIMULATIONS
    assert not core._RANDOM_IN_FLIGHT


def test_parallel_analysis_counts_the_leading_eigenvalues_above_random_ones():
    assert core.parallel_analysis([3.0, 2.0, 1.5, 1.6], [1.4, 1.3, 1.6, 1.0]) == 2
    # Like the Kaiser criterion, at least one factor.
    assert core.parallel_analysis([1.0, 0.5], [1.2, 1.0]) == 1


def _bundled(client, dataset_id: str, kind: str = "model") -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": kind, "source": "bundled", "bundled_id": dataset_id})
    return r.json()["dataset_id"]


def test_inductive_has_kaiser_2_and_parallel_analysis_2(client):
    dataset_id = _bundled(client, "comfy-paper-inductive-miner")
    result = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json={}).json()
    counts = result["factor_count"]
    assert counts["kaiser"] == result["suggested_n_factors"] == result["n_factors"] == 2
    assert counts["parallel_analysis"] == 2
    assert {k: counts[k] for k in ("method", "seed", "simulations", "percentile")} == {
        "method": "pca", "seed": 20261012, "simulations": 100, "percentile": 95,
    }
    # Same matrix as the scree plot: one random eigenvalue per eigenvalue of the data.
    assert len(counts["eigenvalues_random"]) == len(result["eigenvalues"]) == 10
    assert result["eigenvalues"][:3] == pytest.approx([5.462, 2.1971, 0.9091], abs=1e-4)
    assert counts["eigenvalues_random"][:3] == pytest.approx([1.4043, 1.2640, 1.1889], abs=1e-4)


def test_the_paper_data_suggest_fewer_factors_than_the_paper_chose(client):
    """Important Factors fixes k = 4 a priori; both criteria give one to three."""
    for miner in ("alpha", "directly-follows", "hybrid-ilp"):
        dataset_id = _bundled(client, f"comfy-paper-{miner}-miner")
        counts = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json={}).json()["factor_count"]
        assert (counts["kaiser"], counts["parallel_analysis"]) == {
            "alpha": (3, 2), "directly-follows": (1, 1), "hybrid-ilp": (2, 2),
        }[miner]


def test_bundled_log_data_with_the_seed():
    """Without the MSA filter the 128 measures are the same on every platform (the filter
    depends on the platform here, see test_published_numbers.py). Parallel analysis keeps 15
    of the 17 factors Kaiser suggests; the 15th eigenvalue is 0.035 above its random one."""
    raw = pd.read_csv(cat.DATASETS_DIR / cat.bundled_entry("comfy-log-pdc-training-logs")["file"], index_col=0)
    data = storage.as_stored(core.clean_matrix(raw).data)
    result = core.analyze(data, core.AnalysisParams(n_factors=1, auto_msa_filter=False))
    counts = result["factor_count"]
    assert len(result["used_measures"]) == 128
    assert (counts["kaiser"], counts["parallel_analysis"]) == (17, 15)
    assert counts["eigenvalues_random"][:3] == pytest.approx(
        [1.5585211333108382, 1.521224344138854, 1.5030213468438125], rel=1e-9
    )


def test_the_zip_carries_the_random_eigenvalues_and_the_seed(client):
    dataset_id = _bundled(client, "comfy-paper-inductive-miner")
    url = f"/factor-analysis/datasets/{dataset_id}"
    result = client.post(f"{url}/analyze", json={"n_factors": 4}).json()
    with zipfile.ZipFile(io.BytesIO(client.post(f"{url}/export/zip", json={"n_factors": 4}).content)) as archive:
        eigenvalues = pd.read_csv(io.BytesIO(archive.read("eigenvalues.csv")), float_precision="round_trip")
        manifest = json.loads(archive.read("manifest.json"))
    assert eigenvalues["parallel_analysis"].tolist() == result["factor_count"]["eigenvalues_random"]
    assert manifest["analysis"]["seed"] == 20261012
    assert manifest["analysis"]["factor_count"] == {
        "used": 4, "kaiser": 2, "parallel_analysis": 2, "method": "pca", "seed": 20261012,
        "simulations": 100, "percentile": 95,
    }
