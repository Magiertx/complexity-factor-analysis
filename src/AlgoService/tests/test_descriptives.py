"""Descriptive statistics of the measures of a dataset (factor_analysis/descriptives.py)."""

from __future__ import annotations

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis.descriptives import BINS, STATISTICS, describe, histogram
from factor_analysis.published import published

MODEL_DATASETS = [d["id"] for d in cat.manifest()["datasets"] if d["kind"] == "model"]


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_descriptives_are_those_of_the_comfy_report(dataset_id):
    """ComFy prints pandas' mean, median, std (ddof=1), min and max of the data as collected,
    constant measures included, with six decimals."""
    entry = cat.bundled_entry(dataset_id)
    table = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)
    ours = {d["measure"]: d for d in describe(table)["measures"]}
    printed = published(dataset_id)["descriptives"]
    assert list(ours) == list(printed)
    for measure, values in printed.items():
        for statistic in STATISTICS:
            assert f"{ours[measure][statistic]:.6f}" == f"{values[statistic]:.6f}", (measure, statistic)


def test_descriptives_describe_the_input_before_cleaning():
    raw = pd.DataFrame(
        {
            "a": [1.0, 2.0, 3.0, 4.0],
            "constant": [5.0, 5.0, 5.0, 5.0],
            "gap": [1.0, None, 3.0, 8.0],
            "text": ["x", "1", "2", "3"],
            "twice_a": [2.0, 4.0, 6.0, 8.0],
        },
        index=["r1", "r2", "r3", "r4"],
    )
    out = describe(raw)
    assert out["basis"] == "input" and out["n_rows"] == 4
    rows = {d["measure"]: d for d in out["measures"]}
    # A measure with a non-numeric value is left out, as ComFy for log measures leaves it out.
    assert "text" not in rows
    assert rows["constant"]["std"] == 0 and rows["constant"]["dropped"] == "constant"
    assert rows["twice_a"]["dropped"] == "duplicate"
    assert rows["gap"]["n"] == 3 and rows["gap"]["mean"] == pytest.approx(4.0)
    assert rows["gap"]["dropped"] == "missing"
    assert rows["a"]["std"] == pytest.approx(pd.Series([1, 2, 3, 4]).std())
    assert rows["a"]["dropped"] is None


def test_every_measure_has_the_histogram_of_its_values():
    spread = pd.Series([float(i) for i in range(100)])
    h = histogram(spread)
    assert h["min"] == 0.0 and h["max"] == 99.0 and len(h["counts"]) == BINS and sum(h["counts"]) == 100
    # The largest value is in the last bin.
    assert h["counts"][-1] >= 1
    # Few distinct values: a bin for each.
    h = histogram(pd.Series([1.0, 2.0, 3.0, 3.0, 3.0, 2.0]))
    assert h["counts"] == [1, 2, 3]
    # A single value has one bin; nothing has no histogram.
    assert histogram(pd.Series([5.0, 5.0])) == {"min": 5.0, "max": 5.0, "counts": [2]}
    assert histogram(pd.Series([], dtype=float)) is None


def test_the_statistics_carry_the_histograms_over_the_values_present():
    raw = pd.DataFrame(
        {"a": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "gap": [1.0, None, 3.0, 8.0, 8.0, 9.0], "flat": [2.0] * 6},
        index=[f"r{i}" for i in range(6)],
    )
    rows = {d["measure"]: d for d in describe(raw)["measures"]}
    assert sum(rows["a"]["histogram"]["counts"]) == rows["a"]["n"] == 6
    # Missing values are not counted, as they are in no statistic.
    assert sum(rows["gap"]["histogram"]["counts"]) == rows["gap"]["n"] == 5
    assert rows["flat"]["histogram"] == {"min": 2.0, "max": 2.0, "counts": [6]}
    # The statistics ComFy prints are those of before.
    assert [rows["a"][s] for s in STATISTICS] == [3.5, 3.5, pytest.approx(1.870829), 1.0, 6.0]


def test_the_histograms_are_in_the_dataset_and_old_ones_get_them(client):
    from factor_analysis import storage

    r = client.post(
        "/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner"}
    )
    dataset_id = r.json()["dataset_id"]
    served = client.get(f"/factor-analysis/datasets/{dataset_id}").json()["descriptives"]["measures"]
    assert all(sum(row["histogram"]["counts"]) == row["n"] for row in served)
    # Statistics stored before the histograms were kept are completed from the cleaned matrix.
    session = next(d.name for d in storage.root().iterdir() if (d / dataset_id).is_dir())
    path = storage.dataset_dir(session, dataset_id) / "descriptives.json"
    import json

    stored = json.loads(path.read_text())
    for row in stored["measures"]:
        row.pop("histogram", None)
    path.write_text(json.dumps(stored))
    again = client.get(f"/factor-analysis/datasets/{dataset_id}").json()["descriptives"]["measures"]
    # Those of the measures the matrix has; a measure cleaning dropped has no values left to count.
    for before, after in zip(served, again):
        assert after["histogram"] == (None if before["dropped"] else before["histogram"]), before["measure"]
    assert any(row["dropped"] for row in served), "the data are expected to have a measure that cleaning drops"
