"""KMO and MSA do not depend on the units, the column order or the platform.

``core.kmo`` takes the partial correlations from the correlation matrix, with its eigenvalues
below ``Constants.eigenvalue_floor`` counted as zero. factor_analyzer's ``calculate_kmo``
inverts the covariance matrix instead and, on singular data, cuts its singular values
relative to the largest variance. On the bundled log measures (variances from 1.6e-6 to
1.6e11) that cut 30 directions, of which only six are the exact dependencies; the MSA filter
then removed between 5 and 14 measures depending on the column order, failed on some orders,
and moved by up to 0.003 in the KMO between Windows and Linux (datasets/PROVENANCE.md).

The log dataset is pinned here, so that CI on any platform catches a drift.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core
from factor_analysis.precompute import bundled_matrix

LOG = "comfy-log-pdc-training-logs"

#: What the MSA filter removes from the log dataset with the threshold 0.6, all in round 1,
#: with the MSA to three decimals.
LOG_REMOVED = {"start_activities_iqr": 0.287, "end_activities_iqr": 0.318, "trace_len_hist6": 0.546}


@pytest.fixture(scope="module")
def log_data() -> pd.DataFrame:
    """The 128 cleaned log measures as the API stores them."""
    return bundled_matrix(cat.bundled_entry(LOG))


def test_log_dataset_with_the_standard_settings(client, log_data):
    """The analysis the UI runs for the bundled log dataset with the standard settings."""
    created = client.post("/factor-analysis/datasets", data={"kind": "log", "source": "bundled", "bundled_id": LOG})
    assert created.status_code == 200, created.text
    key = created.json()["dataset_id"]
    response = client.post(f"/factor-analysis/datasets/{key}/analyze")
    assert response.status_code == 200, response.text
    result = response.json()

    assert result["n_observations"] == 2112
    removed = {r["measure"]: r for r in result["msa_filter"]["removed"]}
    assert set(removed) == set(LOG_REMOVED)
    for measure, msa in LOG_REMOVED.items():
        assert removed[measure]["step"] == 1
        assert abs(removed[measure]["msa"] - msa) <= 0.5e-3, (measure, removed[measure]["msa"])
    kept = [m for m in log_data.columns if m not in LOG_REMOVED]
    assert len(kept) == 125
    assert result["used_measures"] == kept
    assert min(result["kmo"]["per_measure"].values()) >= 0.6
    assert abs(result["kmo"]["overall"] - 0.9283) <= 0.5e-4, result["kmo"]["overall"]

    assert result["suggested_n_factors"] == result["factor_count"]["kaiser"] == 16
    assert result["factor_count"]["parallel_analysis"] == 12
    assert result["n_factors"] == 16
    assert sum(1 for f in result["factors"] if f["measures"]) == 14


def test_log_msa_filter_does_not_depend_on_the_column_order(log_data):
    reference = core.msa_filter(log_data)
    rng = np.random.default_rng(20261110)
    # The alphabetical order made factor_analyzer's MSA non-finite.
    orders = [sorted(log_data.columns), *(list(rng.permutation(log_data.columns)) for _ in range(3))]
    for order in orders:
        result = core.msa_filter(log_data[order])
        assert {r["measure"] for r in result.removed} == set(LOG_REMOVED)
        assert set(result.data.columns) == set(reference.data.columns)
        assert abs(result.overall - reference.overall) <= 1e-6
        for measure, msa in reference.per_measure.items():
            assert abs(result.per_measure[measure] - msa) <= 1e-6, (measure, result.per_measure[measure], msa)


def test_msa_does_not_depend_on_the_units_on_singular_data():
    """Two factors, one exact dependency, and measures rescaled by up to 15 orders of magnitude:
    the MSA stays the same to the last digits (factor_analyzer's moves by 0.5)."""
    rng = np.random.default_rng(5)
    f1, f2 = rng.normal(size=(2, 400))
    noise = rng.normal(scale=0.6, size=(6, 400))
    data = pd.DataFrame({
        "a1": f1 + noise[0], "a2": f1 + noise[1], "a3": -f1 + noise[2],
        "b1": f2 + noise[3], "b2": f2 + noise[4], "b3": f2 - noise[5],
    })
    data["sum"] = data["a1"] + data["b1"]
    assert core.singular_measures(data)
    scaled = data * pd.Series({"a1": 1e-6, "a2": 1.0, "a3": 1e3, "b1": 1e9, "b2": 1e-3, "b3": 1e6, "sum": 1.0})

    per, overall = core.kmo(data)
    per_scaled, overall_scaled = core.kmo(scaled)
    assert overall_scaled == pytest.approx(overall, abs=1e-9)
    for measure, msa in per.items():
        assert per_scaled[measure] == pytest.approx(msa, abs=1e-9), measure


def test_log_msa_does_not_depend_on_the_units(log_data):
    """structure × 1000 moved its MSA under factor_analyzer from 0.281 to 0.819, and
    activities_variance / 1e6 kept three measures the filter had removed.

    The KMO, a sum over all pairs, stays within 1e-9. A single MSA only within 1e-6: without
    the six exact dependencies the correlation matrix still has a condition number of about
    1e9, so rounding in its last bit shows at about 1e-7.
    """
    per, overall = core.kmo(log_data)
    for column, factor in (("structure", 1000.0), ("activities_variance", 1e-6)):
        rescaled = log_data.assign(**{column: log_data[column] * factor})
        per_rescaled, overall_rescaled = core.kmo(rescaled)
        assert abs(overall_rescaled - overall) <= 1e-9, column
        for measure, msa in per.items():
            assert abs(per_rescaled[measure] - msa) <= 1e-6, (column, measure)
        assert {r["measure"] for r in core.msa_filter(rescaled).removed} == set(LOG_REMOVED)
