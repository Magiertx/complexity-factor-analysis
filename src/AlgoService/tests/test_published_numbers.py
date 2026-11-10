"""The bundled datasets reproduce the numbers they were published with.

The published values are in ``datasets/published/<dataset id>.json``, extracted from the
upstream reports by ``scripts/extract_published.py``. The model datasets run through the API
exactly as the UI runs them: bundled dataset, stored matrix, analysis with the parameters in
``reproduce_with``.

Tolerances: the reports print Bartlett's chi-square and the overall MSA in full, so these
match to 1e-9 relative. Every other value is printed rounded to four decimals, so ours may
differ by half a unit of the fourth decimal, plus a little for the minres optimum, which moves
by about 1e-8 between memory layouts. That is stricter than "loadings to 1e-4" and does not
flip on a value that lies on a rounding boundary.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, storage
from factor_analysis.published import PUBLISHED_DIR, published

MODEL_DATASETS = [
    "comfy-paper-alpha-miner",
    "comfy-paper-alpha-dollar-miner",
    "comfy-paper-alpha-plus-miner",
    "comfy-paper-directly-follows-miner",
    "comfy-paper-heuristics-miner",
    "comfy-paper-hybrid-ilp-miner",
    "comfy-paper-inductive-miner",
]
LOG_DATASET = "comfy-log-pdc-training-logs"

FULL = 1e-9
ROUNDED = 0.5e-4 + 1e-7


def _close(ours: float, printed: float, tolerance: float = ROUNDED) -> bool:
    return abs(ours - printed) <= tolerance


def test_every_bundled_dataset_has_its_published_numbers():
    ids = {d["id"] for d in cat.manifest()["datasets"]}
    files = {p.stem for p in PUBLISHED_DIR.glob("*.json")}
    assert files == ids
    for dataset_id in ids:
        entry, numbers = cat.bundled_entry(dataset_id), published(dataset_id)
        assert numbers["dataset_id"] == dataset_id
        assert numbers["source"]["commit"] == entry["source_commit"]
        assert numbers["source"]["repository"] == entry["source_url"]
        assert set(numbers["verified"]) <= set(numbers), dataset_id


def test_published_is_none_without_a_file():
    assert published("comfy-paper-nope") is None
    assert published("../manifest") is None


_ANALYSES: dict[str, dict] = {}


@pytest.fixture
def analyses(client) -> dict[str, dict]:
    """The analysis of each model dataset through the API, with its dataset. Computed once:
    the results are plain data and do not depend on the session."""
    for dataset_id in MODEL_DATASETS:
        if dataset_id in _ANALYSES:
            continue
        created = client.post(
            "/factor-analysis/datasets",
            data={"kind": "model", "source": "bundled", "bundled_id": dataset_id},
        )
        assert created.status_code == 200, created.text
        key = created.json()["dataset_id"]
        dataset = client.get(f"/factor-analysis/datasets/{key}?rows=0").json()
        body = dict(published(dataset_id)["reproduce_with"])
        result = client.post(f"/factor-analysis/datasets/{key}/analyze", json=body)
        assert result.status_code == 200, result.text
        _ANALYSES[dataset_id] = {"dataset": dataset, "result": result.json()}
    return _ANALYSES


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_suitability_matches_the_comfy_report(analyses, dataset_id):
    numbers = published(dataset_id)
    dataset, result = analyses[dataset_id]["dataset"], analyses[dataset_id]["result"]

    assert result["n_observations"] == numbers["n_observations"]
    # ComFy drops constant measures before Bartlett's test, as the tool does.
    analyzed = [*numbers["kmo"]["per_measure"], *(r["measure"] for r in numbers["msa_filter"]["removed"])]
    assert sorted(dataset["measures"]) == sorted(analyzed)
    assert {d["measure"] for d in dataset["dropped"]} == set(numbers["measures"]) - set(analyzed)
    assert all(d["reason"] == "constant" for d in dataset["dropped"])

    assert result["bartlett"]["chi_square"] == pytest.approx(numbers["bartlett"]["chi_square"], rel=FULL)
    assert result["bartlett"]["p_value"] == numbers["bartlett"]["p_value"]
    assert result["kmo"]["overall"] == pytest.approx(numbers["kmo"]["overall"], rel=FULL)


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_msa_filter_matches_the_comfy_report(analyses, dataset_id):
    numbers = published(dataset_id)
    result = analyses[dataset_id]["result"]

    per_measure = result["kmo"]["per_measure"]
    assert list(per_measure) == [m for m in result["used_measures"]]
    assert set(per_measure) == set(numbers["kmo"]["per_measure"])
    for measure, printed in numbers["kmo"]["per_measure"].items():
        assert _close(per_measure[measure], printed), (measure, per_measure[measure], printed)

    removed = {r["measure"]: r for r in result["msa_filter"]["removed"]}
    expected = {r["measure"]: r for r in numbers["msa_filter"]["removed"]}
    assert set(removed) == set(expected)
    for measure, entry in expected.items():
        assert removed[measure]["step"] == entry["round"], measure
        assert _close(removed[measure]["msa"], entry["msa"]), (measure, removed[measure]["msa"], entry["msa"])


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_eigenvalues_match_the_comfy_scree_plot(analyses, dataset_id):
    numbers = published(dataset_id)
    result = analyses[dataset_id]["result"]
    # ComFy plots PCA's explained variance ratio: eigenvalue / number of measures.
    p = len(result["used_measures"])
    ratios = [v / p for v in result["eigenvalues"]]
    assert len(ratios) == len(numbers["explained_variance_ratio"])
    for ours, printed in zip(ratios, numbers["explained_variance_ratio"]):
        assert _close(ours, printed), (ours, printed)


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_loadings_and_communalities_match_the_comfy_report(analyses, dataset_id):
    numbers = published(dataset_id)
    result = analyses[dataset_id]["result"]
    k = numbers["reproduce_with"]["n_factors"]

    assert result["n_factors"] == k and result["rotation"] == "varimax"
    assert result["used_measures"] == list(numbers["loadings"])
    printed = np.array(list(numbers["loadings"].values()))
    if k < numbers["n_factors"]:
        # Heuristics: the report asks for 4 factors with 4 measures left. factor_analyzer then
        # leaves the 4th column at 0.0; the tool fits at most p - 1 = 3 factors, and the
        # first 3 columns are the same solution.
        assert numbers["n_factors"] == len(numbers["loadings"]) == k + 1
        assert np.all(printed[:, k:] == 0.0)
        printed = printed[:, :k]
    ours = np.array([result["loadings"][m] for m in numbers["loadings"]])
    # Same factor order and signs as ComFy: both run factor_analyzer's varimax on the same matrix.
    assert np.max(np.abs(ours - printed)) <= ROUNDED, np.max(np.abs(ours - printed))

    for measure, value in numbers["communalities"].items():
        assert _close(result["communalities"][measure], value), (measure, result["communalities"][measure], value)


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_descriptive_statistics_match_the_comfy_report(dataset_id):
    """The bundled CSV is the data behind the report: ComFy's descriptive statistics over all
    measures, before any is dropped, printed with six decimals."""
    numbers = published(dataset_id)
    raw = pd.read_csv(cat.DATASETS_DIR / cat.bundled_entry(dataset_id)["file"], index_col=0)
    assert list(raw.columns) == numbers["measures"]
    ours = {
        "mean": raw.mean(), "median": raw.median(), "std": raw.std(), "min": raw.min(), "max": raw.max(),
    }
    for measure, stats in numbers["descriptives"].items():
        for name, printed in stats.items():
            value = float(ours[name][measure])
            assert abs(value - printed) <= 0.5e-6 + 1e-12 * abs(printed), (measure, name, value, printed)


def test_the_extracted_files_are_what_the_script_writes():
    """Each file is plain JSON with a trailing newline, as scripts/extract_published.py writes it."""
    for path in PUBLISHED_DIR.glob("*.json"):
        text = path.read_text(encoding="utf-8")
        assert text == json.dumps(json.loads(text), ensure_ascii=False, indent=2) + "\n", path.name


# --- log measures -------------------------------------------------------------------------


def test_log_paper_cleaning_and_bartlett_are_reproduced():
    """What the tool reproduces of the log report: the 128 measures left after cleaning and
    Bartlett's chi-square.

    KMO and MSA are not compared. After cleaning, the correlation matrix has six exact linear
    dependencies (four iqr = q3 - q1, cyclomatic_number_dfg and n_edges_dfg). factor_analyzer,
    which ComFy for log measures uses, then inverts the covariance matrix with a cutoff
    relative to the largest variance, which also drops genuine directions of the measures on a
    small scale: its KMO (0.882187 published) and the five removed measures change with the
    units, the column order and the platform. The tool takes the MSA from the correlation
    matrix and gets a KMO of 0.9283 with three measures removed (tests/test_msa_invariance.py,
    datasets/PROVENANCE.md). The file keeps the published values as ``platform_dependent``.
    Chi-square sums the logs of the eigenvalues, six of them clamped to the same floor on every
    platform, so it is stable; 1e-6 relative leaves room for the platform's eigenvalue solver.
    """
    numbers = published(LOG_DATASET)
    assert numbers["reproduce_with"] is None
    assert {"kmo", "msa_filter"} <= set(numbers["platform_dependent"])
    assert not set(numbers["platform_dependent"]) & set(numbers["verified"])

    raw = pd.read_csv(cat.DATASETS_DIR / cat.bundled_entry(LOG_DATASET)["file"], index_col=0)
    # The report lists the measures in the order of Constants.all_measures, not the CSV's.
    assert sorted(raw.columns) == sorted(numbers["measures"])
    cleaned = core.clean_matrix(raw)
    data = storage.as_stored(cleaned.data)
    assert data.shape == (numbers["n_observations"], numbers["cleaning"]["analyzed"])

    # ComFy for log measures calls measures with missing values non-numeric.
    by_reason: dict[str, set[str]] = {}
    for d in cleaned.dropped:
        by_reason.setdefault(d["reason"], set()).add(d["measure"])
    assert by_reason == {
        "missing": set(numbers["cleaning"]["non_numeric"]),
        "constant": set(numbers["cleaning"]["constant"]),
        "duplicate": set(numbers["cleaning"]["correlated"]),
    }

    bartlett = core.bartlett_sphericity(data)
    assert bartlett["chi_square"] == pytest.approx(numbers["bartlett"]["chi_square"], rel=1e-6)
    assert bartlett["p_value"] == numbers["bartlett"]["p_value"]
    assert bartlett["clamped"] == 6
