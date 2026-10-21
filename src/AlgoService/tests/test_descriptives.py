"""Descriptive statistics of the measures of a dataset (factor_analysis/descriptives.py)."""

from __future__ import annotations

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis.descriptives import STATISTICS, describe
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
