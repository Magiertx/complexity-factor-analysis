"""The analysis always gets the measures in the order the dataset stores them.

Another column order changes the numbers only in their last bits (on the singular log
measures the MSA by about 1e-8; tests/test_msa_invariance.py), but those bits would show in
exports and break the round trip. So the analysis, the MSA filter and every export use the
stored order. Sorting or grouping the measures in the UI changes only what is shown, and a
dataset that leaves the tool as CSV and comes back gives the same numbers to the last bit.
"""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pandas as pd
import pytest

from factor_analysis import core

LOG = "comfy-log-pdc-training-logs"
INDUCTIVE = "comfy-paper-inductive-miner"


def _create(client, kind: str, bundled_id: str | None = None, csv: bytes | None = None, measures=None) -> str:
    data = {"kind": kind, "source": "bundled" if csv is None else "csv"}
    if bundled_id:
        data["bundled_id"] = bundled_id
    if measures is not None:
        data["measures"] = json.dumps(measures)
    files = [("files", ("again.csv", csv, "text/csv"))] if csv is not None else None
    r = client.post("/factor-analysis/datasets", data=data, files=files)
    assert r.status_code == 200, r.text
    return r.json()["dataset_id"]


def _analyze(client, dataset_id: str, **body) -> dict:
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/analyze", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _numbers(result: dict) -> dict:
    """Everything of an analysis that depends on the column order."""
    return {k: result[k] for k in ("used_measures", "bartlett", "kmo", "msa_filter", "eigenvalues", "loadings", "communalities")}


def _zip(client, dataset_id: str, **body) -> dict[str, bytes]:
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/export/zip", json=body)
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_core_keeps_the_column_order_in_every_result():
    rng = np.random.default_rng(3)
    f1, f2 = rng.normal(size=(2, 300))
    noise = rng.normal(scale=0.5, size=(6, 300))
    data = pd.DataFrame({
        "z": f1 + noise[0], "b": f2 + noise[1], "y": -f1 + noise[2],
        "a": f2 + noise[3], "x": 2 * f1 + noise[4], "c": f2 - noise[5],
    })
    result = core.analyze(data, core.AnalysisParams(n_factors=2))
    order = list(data.columns)
    assert result["used_measures"] == order
    assert list(result["kmo"]["per_measure"]) == order
    assert list(result["loadings"]) == order
    assert list(result["communalities"]) == order


def test_analysis_msa_filter_and_exports_use_the_stored_order(client):
    """A selection in another order than the file's is stored as given and used as stored."""
    measures = [
        "Number of duplicate tasks", "Size", "Density", "Sequentiality", "Token split",
        "Control flow complexity", "Separability", "Connector Heterogeneity",
        "Average connector degree", "Maximum connector degree", "Connector Mismatch",
        "Coefficient of network connectivity",
    ]
    assert measures != sorted(measures)
    key = _create(client, "model", INDUCTIVE, measures=measures)
    assert client.get(f"/factor-analysis/datasets/{key}?rows=0").json()["measures"] == measures

    result = _analyze(client, key, n_factors=4)
    removed = {r["measure"] for r in result["msa_filter"]["removed"]}
    assert removed == {"Control flow complexity", "Sequentiality"}
    kept = [m for m in measures if m not in removed]
    assert result["used_measures"] == kept
    assert list(result["kmo"]["per_measure"]) == kept
    assert list(result["loadings"]) == kept

    download = client.get(f"/factor-analysis/datasets/{key}/download").text
    assert download.splitlines()[0] == ",".join(["observation", *measures])
    exported = client.post(f"/factor-analysis/datasets/{key}/export", json={"n_factors": 4}).text
    assert [line.split(",")[0] for line in exported.splitlines()[1:]] == kept

    files = _zip(client, key, n_factors=4)
    assert files["dataset.csv"].decode().splitlines()[0] == ",".join(["observation", *measures])
    assert [line.split(",")[0] for line in files["msa.csv"].decode().splitlines()[1:]] == measures
    assert [line.split(",")[0] for line in files["loadings.csv"].decode().splitlines()[1:]] == kept
    assert json.loads(files["analysis.json"])["used_measures"] == kept


@pytest.fixture
def log_dataset(client) -> str:
    return _create(client, "log", LOG)


def test_order_of_the_excluded_measures_does_not_matter(client, log_dataset):
    excluded = ["trace_len_hist1", "n_variants", "activities_q3"]
    # One factor keeps the fit short; the order only matters for KMO, MSA and the fit itself.
    results = [_numbers(_analyze(client, log_dataset, n_factors=1, excluded=e))
               for e in (excluded, excluded[::-1], sorted(excluded))]
    assert results[0] == results[1] == results[2]


def test_csv_round_trip_keeps_every_number_to_the_last_bit(client, log_dataset):
    """Downloaded as CSV, or taken from the ZIP, and uploaded again: the same numbers, compared
    with ==, on the singular log data where the order would show."""
    first = _numbers(_analyze(client, log_dataset, n_factors=1))

    download = client.get(f"/factor-analysis/datasets/{log_dataset}/download").content
    again = _create(client, "log", csv=download)
    assert _numbers(_analyze(client, again, n_factors=1)) == first

    from_zip = _zip(client, log_dataset, n_factors=1)["dataset.csv"]
    again = _create(client, "log", csv=from_zip)
    assert _numbers(_analyze(client, again, n_factors=1)) == first
