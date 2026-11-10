"""The stability of a solution over bootstrap samples (factor_analysis/stability.py), its job and
its exports."""

from __future__ import annotations

import io
import json
import re
import zipfile

import numpy as np
import pandas as pd
import pytest

from factor_analysis import stability
from factor_analysis.core import AnalysisParams, analyze

BUNDLED = "comfy-paper-inductive-miner"


def _two_factors(n: int = 300, noise: float = 0.35, seed: int = 3) -> pd.DataFrame:
    """Three measures on each of two independent factors."""
    rng = np.random.default_rng(seed)
    a, b = rng.normal(size=n), rng.normal(size=n)
    columns = {f"A{i}": a for i in range(3)} | {f"B{i}": b for i in range(3)}
    return pd.DataFrame({name: base + noise * rng.normal(size=n) for name, base in columns.items()})


def _run(data: pd.DataFrame, samples: int = 40, **params) -> tuple[dict, dict]:
    p = AnalysisParams(**params)
    reference = analyze(data, p)
    return reference, stability.bootstrap(data, p, reference, samples)


def test_align_undoes_a_permutation_and_signs():
    reference = np.array([[0.9, 0.1, 0.0], [0.8, -0.2, 0.1], [0.1, 0.7, 0.2], [0.0, 0.6, -0.1], [0.2, 0.1, 0.9]])
    sample = reference[:, [2, 0, 1]] * np.array([-1.0, 1.0, -1.0])
    aligned, phi = stability.align(sample, reference)
    np.testing.assert_allclose(aligned, reference)
    np.testing.assert_allclose(phi, 1.0)


def test_a_permuted_and_mirrored_fit_is_stable_throughout(monkeypatch):
    data = _two_factors()
    p = AnalysisParams(n_factors=2)
    reference = analyze(data, p)
    real = stability._fit_factors

    def mirrored(sample, k, rotation, should_stop=None, analyzer=None):
        # Every sample gives the loadings of the reference, its factors swapped and mirrored.
        fit = real(data[reference["used_measures"]], k, rotation)
        fit.loadings = -fit.loadings.iloc[:, ::-1]
        return fit

    monkeypatch.setattr(stability, "_fit_factors", mirrored)
    result = stability.bootstrap(data, p, reference, 10)
    assert result["valid"] == 10
    assert all(m["assignment"] == 1.0 and m["primary"] == 1.0 for m in result["measures"])
    assert [f["phi_mean"] for f in result["factors"]] == pytest.approx([1.0, 1.0])
    assert {f["reading"] for f in result["factors"]} == {"equal"}


def test_the_same_seed_gives_the_same_result():
    data = _two_factors(n=120, noise=0.8)
    p = AnalysisParams(n_factors=2)
    reference = analyze(data, p)
    first = stability.bootstrap(data, p, reference, 25)
    second = stability.bootstrap(data, p, reference, 25)
    first.pop("seconds"), second.pop("seconds")
    assert first == second
    other = stability.bootstrap(data, p, reference, 25, seed=1)
    other.pop("seconds")
    assert other != first


def test_a_clear_structure_is_stable():
    reference, result = _run(_two_factors(), n_factors=2)
    assert result["valid"] == result["samples"]
    assert all(m["assignment"] >= 0.95 for m in result["measures"])
    assert all(f["reading"] == "equal" for f in result["factors"])
    assert result["summary"] == {"stable": 6, "measures": 6, "threshold": stability.STABLE_SHARE}
    shares = np.array(result["pairs"]["shares"])
    # A0 and A1 share their factor in every sample, A0 and B0 in none.
    assert shares[0, 1] == 1.0 and shares[0, 3] == 0.0
    assert result["pairs"]["reference"][0][1] and not result["pairs"]["reference"][0][3]


def test_noise_is_not_stable():
    rng = np.random.default_rng(11)
    data = pd.DataFrame(rng.normal(size=(80, 6)), columns=[f"M{i}" for i in range(6)])
    _, result = _run(data, n_factors=2, auto_msa_filter=False, loading_threshold=0.3)
    shares = [m["assignment"] for m in result["measures"]]
    assert np.mean(shares) < 0.7
    assert min(f["phi_mean"] for f in result["factors"]) < stability.CONGRUENCE_EQUAL


def test_failed_samples_are_counted_and_left_out():
    data = _two_factors(n=60)
    # Nearly constant: a sample without its one other value has no variance in it.
    data["A2"] = 0.0
    data.loc[0, "A2"] = 1.0
    data["A3"] = data["A0"] + 0.3 * np.random.default_rng(5).normal(size=len(data))
    reference, result = _run(data, samples=30, n_factors=2, auto_msa_filter=False)
    assert result["failed"].get("constant", 0) > 0
    assert result["valid"] + sum(result["failed"].values()) == 30
    assert set(result["failed"]) <= set(stability.FAILURES)


def test_a_sample_at_the_heywood_bound_is_kept_and_counted(monkeypatch):
    data = _two_factors(n=60)
    # A bound low enough that some measures sit at it in some samples and not in the reference.
    monkeypatch.setattr(stability, "HEYWOOD_COMMUNALITY", 0.92)
    reference, result = _run(data, samples=30, n_factors=2, auto_msa_filter=False)
    assert result["heywood"] > 0
    assert result["valid"] == 30 - sum(result["failed"].values())
    assert "heywood" not in result["failed"]


def test_readings_after_lorenzo_seva_and_ten_berge():
    assert [stability.reading(v) for v in (0.97, 0.95, 0.9, 0.85, 0.5, None)] == [
        "equal", "equal", "fair", "fair", "different", None,
    ]


# --- the job and the exports --------------------------------------------------------------


def _bundled(client) -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    assert r.status_code == 200, r.text
    return r.json()["dataset_id"]


def _undated(report: bytes) -> str:
    """The report without the time it was exported at."""
    return re.sub(r"\d{4}-\d\d-\d\dT[\d:]+\+00:00", "", report.decode())


def _zip(client, url: str, body: dict) -> zipfile.ZipFile:
    r = client.post(f"{url}/export/zip", json=body)
    assert r.status_code == 200, r.text
    return zipfile.ZipFile(io.BytesIO(r.content))


def test_the_stability_is_computed_once_and_exported_only_then(client):
    url = f"/factor-analysis/datasets/{_bundled(client)}"
    body = {"samples": 100}
    assert client.post(f"{url}/stability?start=false", json=body).json()["status"] == "none"
    default_report = _undated(client.post(f"{url}/export/report", json={"stability_samples": 100}).content)
    plain = _zip(client, url, {"stability_samples": 100})
    assert not any(name.startswith("stability") for name in plain.namelist())
    assert "short-set.csv" in plain.namelist()
    assert "stability" not in json.loads(plain.read("analysis.json"))

    # The test client runs the job before it answers.
    started = client.post(f"{url}/stability", json=body).json()
    assert started["status"] == "computing"
    job = client.get(f"/jobs/{started['job_id']}").json()
    assert job["status"] == "completed", job
    assert job["algorithm_id"] == "_stability:model"
    ready = client.post(f"{url}/stability?start=false", json=body).json()
    assert ready["status"] == "ready" and ready["key"] == started["key"]
    result = ready["stability"]
    assert result["samples"] == 100 and result["seed"] == stability.SEED
    assert result["valid"] + sum(result["failed"].values()) == 100
    # Another setting is another stability.
    assert client.post(f"{url}/stability?start=false", json={**body, "n_factors": 3}).json()["status"] == "none"
    assert client.post(f"{url}/stability?start=false", json={"samples": 200}).json()["status"] == "none"

    archive = _zip(client, url, {"stability_samples": 100})
    names = set(archive.namelist())
    assert {"stability.csv", "stability-factors.csv", "stability-pairs.csv"} <= names
    assert json.loads(archive.read("analysis.json"))["stability"] == result
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["stability"]["samples"] == 100 and manifest["stability"]["valid"] == result["valid"]
    assert archive.read("stability.csv").decode().startswith("measure,factors,primary_factor,")
    report = archive.read("report.tex").decode()
    assert "\\section*{Stability}" in report

    # Without the samples named, the exports are as before.
    assert _undated(client.post(f"{url}/export/report", json={}).content) == default_report
    assert "\\section*{Stability}" not in default_report
    methods = client.post(f"{url}/export/methods", json={"stability_samples": 100, "short_set": True}).json()
    assert {"efron1993", "zhang2010bootstrap", "kuhn1955", "lorenzoseva2006"} <= set(methods["citation_keys"])
    assert "bootstrap" in methods["text"] and "short set" in methods["text"]
    plain_methods = client.post(f"{url}/export/methods", json={}).json()
    assert "bootstrap" not in plain_methods["text"] and "efron1993" not in plain_methods["citation_keys"]
    bib = client.post(f"{url}/export/bibtex", json={"stability_samples": 100}).text
    assert "doi = {10.1027/1614-2241.2.2.57}" in bib


def test_a_stopped_stability_job_is_aborted(client, monkeypatch):
    from factor_analysis.core import Superseded

    def stopped(*args, **kwargs):
        raise Superseded()

    monkeypatch.setattr(stability, "bootstrap", stopped)
    url = f"/factor-analysis/datasets/{_bundled(client)}"
    started = client.post(f"{url}/stability", json={"samples": 100}).json()
    assert client.get(f"/jobs/{started['job_id']}").json()["status"] == "aborted"
    assert client.post(f"{url}/stability?start=false", json={"samples": 100}).json()["status"] == "none"


def test_a_stability_of_another_measure_set_is_not_served(client, monkeypatch):
    """The key names the result the stability is about: a computation that keeps other measures
    (as the MSA change did) does not get the stability stored for the old ones."""
    from routes import factor_analysis as route

    url = f"/factor-analysis/datasets/{_bundled(client)}"
    body = {"samples": 100}
    started = client.post(f"{url}/stability", json=body).json()
    assert client.get(f"/jobs/{started['job_id']}").json()["status"] == "completed"
    assert client.post(f"{url}/stability?start=false", json=body).json()["status"] == "ready"
    assert "stability.csv" in _zip(client, url, {"stability_samples": 100}).namelist()

    original = route.run_analysis

    def other_measures(data, params, should_stop=None):
        result = original(data, params, should_stop)
        return {**result, "used_measures": result["used_measures"][:-1]}

    monkeypatch.setattr(route, "run_analysis", other_measures)
    looked = client.post(f"{url}/stability?start=false", json=body).json()
    assert looked["status"] == "none" and looked["key"] != started["key"]
    assert "stability.csv" not in _zip(client, url, {"stability_samples": 100}).namelist()
