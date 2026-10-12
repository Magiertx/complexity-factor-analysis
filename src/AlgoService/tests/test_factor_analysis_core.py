"""Numerics of the factor analysis (factor_analysis/core.py and export.py)."""

from __future__ import annotations

import math
import os

import numpy as np
import pandas as pd
import pytest

from factor_analysis import core
from factor_analysis.export import latex_escape, loadings_csv, loadings_latex, matrix_csv

DATASETS = os.path.join(os.path.dirname(__file__), "..", "datasets")


def _correlated(n: int = 200, seed: int = 0) -> pd.DataFrame:
    """Six measures driven by two latent factors, three each."""
    rng = np.random.default_rng(seed)
    f1, f2 = rng.normal(size=(2, n))
    noise = rng.normal(scale=0.4, size=(6, n))
    cols = {
        "a1": f1 + noise[0], "a2": 2 * f1 + noise[1], "a3": -f1 + noise[2],
        "b1": f2 + noise[3], "b2": f2 + noise[4], "b3": 3 * f2 + noise[5],
    }
    return pd.DataFrame(cols, index=[f"obs{i}" for i in range(n)])


def _inductive() -> pd.DataFrame:
    raw = pd.read_csv(os.path.join(DATASETS, "model", "complexity_scores-inductive-miner.csv"), index_col=0)
    return core.clean_matrix(raw).data


# --- cleaning -----------------------------------------------------------------------------


def test_clean_drops_non_numeric_constant_and_duplicate_measures():
    raw = pd.DataFrame({
        "x": [1.0, 2.0, 3.0, 4.0],
        "text": ["1", "2", "ERR: ValueError", "4"],
        "const": [5, 5, 5, 5],
        "twice_x": [2.0, 4.0, 6.0, 8.0],
        "minus_x": [-1.0, -2.0, -3.0, -4.0],
        "y": [1.0, 0.0, 1.0, 3.0],
    }, index=["a", "b", "c", "d"])

    result = core.clean_matrix(raw)

    assert list(result.data.columns) == ["x", "y"]
    reasons = {d["measure"]: d["reason"] for d in result.dropped}
    assert reasons == {"text": "non_numeric", "const": "constant", "twice_x": "duplicate", "minus_x": "duplicate"}
    duplicate = next(d for d in result.dropped if d["measure"] == "twice_x")
    assert duplicate["detail"] == "perfectly correlated with x"
    assert result.dropped_rows == 0
    assert list(result.data.index) == ["a", "b", "c", "d"]


def test_clean_drops_measures_with_gaps_like_comfy_for_log_measures():
    raw = pd.DataFrame({
        "x": [1.0, 2.0, 3.0, 5.0],
        "gap": [1.0, None, 2.0, 7.0],
        "inf": [1.0, 2.0, math.inf, 0.0],
        "blank": ["1", "", "3", "0"],
    })
    result = core.clean_matrix(raw)
    assert list(result.data.columns) == ["x"]
    assert {d["measure"]: d["reason"] for d in result.dropped} == {
        "gap": "missing", "inf": "missing", "blank": "missing",
    }
    assert next(d for d in result.dropped if d["measure"] == "gap")["detail"] == "1 of 4 values missing"


def test_clean_drops_mostly_empty_rows_before_measures():
    """An input on which every measure failed costs one row, not every measure."""
    raw = pd.DataFrame({
        "x": [1.0, 2.0, None, 5.0],
        "y": [2.0, 1.0, None, 7.0],
        "z": [1.0, 0.0, 4.0, 2.0],
    }, index=["a", "b", "failed", "d"])
    result = core.clean_matrix(raw)
    assert list(result.data.columns) == ["x", "y", "z"]
    assert result.empty_rows == ["failed"]
    assert result.dropped_rows == 1 and result.dropped == []


def test_clean_keeps_measures_on_a_tiny_scale():
    raw = pd.DataFrame({"tiny": [1e-12, 3e-12, 2e-12, 5e-12], "x": [1.0, 2.0, 2.0, 4.0]})
    result = core.clean_matrix(raw)
    assert list(result.data.columns) == ["tiny", "x"]


def test_clean_drops_rows_when_measures_may_have_gaps():
    raw = pd.DataFrame({"x": [1.0, 2.0, 3.0, 5.0], "y": [1.0, None, 2.0, 7.0]})
    result = core.clean_matrix(raw, max_missing_share=0.5)
    assert list(result.data.columns) == ["x", "y"]
    assert result.dropped_rows == 1
    assert len(result.data) == 3


# --- Bartlett, KMO, MSA filter ------------------------------------------------------------


def test_bartlett_matches_factor_analyzer_on_regular_data():
    from factor_analyzer.factor_analyzer import calculate_bartlett_sphericity

    data = _correlated()
    chi, p = calculate_bartlett_sphericity(data)
    ours = core.bartlett_sphericity(data)
    assert ours["chi_square"] == pytest.approx(chi, rel=1e-9)
    assert ours["p_value"] == pytest.approx(p, abs=1e-12)
    assert ours["df"] == 15


def test_bartlett_stays_finite_on_a_singular_matrix():
    data = _correlated()
    data["sum"] = data["a1"] + data["b1"]
    result = core.bartlett_sphericity(data)
    assert math.isfinite(result["chi_square"])
    assert result["p_value"] == 0.0
    assert core.singular_measures(data)
    assert set(core.singular_measures(data)[0]) == {"a1", "b1", "sum"}


def test_bartlett_does_not_reject_independent_measures():
    rng = np.random.default_rng(1)
    data = pd.DataFrame(rng.normal(size=(300, 4)), columns=list("abcd"))
    assert core.bartlett_sphericity(data)["p_value"] > 0.05


def test_kmo_matches_factor_analyzer():
    from factor_analyzer.factor_analyzer import calculate_kmo

    data = _correlated()
    per, overall = calculate_kmo(data)
    ours_per, ours_overall = core.kmo(data)
    assert ours_overall == pytest.approx(overall)
    assert list(ours_per.values()) == pytest.approx(list(per))


def test_msa_filter_removes_every_low_measure_in_one_step():
    """ComFy drops all measures below the threshold at once and records the MSA of that step.

    One at a time, Control flow complexity would only go after Sequentiality, with an MSA of
    0.5193; ComFy's report lists 0.573, the value of the first step.
    """
    result = core.msa_filter(_inductive(), 0.6)
    removed = {r["measure"]: (round(r["msa"], 4), r["step"]) for r in result.removed}
    assert removed == {"Sequentiality": (0.4889, 1), "Control flow complexity": (0.573, 1)}
    assert all(v >= 0.6 for v in result.per_measure.values())


def test_msa_filter_stops_when_too_few_measures_remain():
    rng = np.random.default_rng(2)
    data = pd.DataFrame(rng.normal(size=(100, 4)), columns=list("abcd"))
    result = core.msa_filter(data, 0.99)
    assert result.data.shape[1] < core.MIN_MEASURES


def test_eigenvalues_and_kaiser_criterion():
    values = core.eigenvalues(_correlated())
    assert values == sorted(values, reverse=True)
    assert sum(values) == pytest.approx(6.0)
    assert core.kaiser_criterion(values) == 2
    assert core.kaiser_criterion([0.9, 0.5]) == 1


# --- factor fit ---------------------------------------------------------------------------


def test_fit_factors_derived_quantities():
    data = _correlated()
    fit = core.fit_factors(data, 2, "varimax")
    loadings = fit.loadings.to_numpy()
    communalities = np.array([fit.communalities[c] for c in data.columns])
    assert communalities == pytest.approx((loadings ** 2).sum(axis=1))
    assert [fit.uniquenesses[c] for c in data.columns] == pytest.approx(1 - communalities)
    assert fit.ss_loadings == pytest.approx((loadings ** 2).sum(axis=0))
    assert fit.proportion == pytest.approx(np.array(fit.ss_loadings) / 6)
    assert fit.cumulative == pytest.approx(np.cumsum(fit.proportion))
    assert fit.explained == pytest.approx(fit.cumulative[-1])
    assert fit.rotation == "varimax"
    assert fit.structure is None and fit.factor_correlations is None


@pytest.mark.parametrize("rotation", ["promax", "oblimin"])
def test_oblique_rotations_keep_the_communalities(rotation):
    """Rotation does not change communalities; factor_analyzer's own sum over the pattern
    matrix would give values above 1 here."""
    data = _inductive().drop(columns=["Sequentiality", "Control flow complexity"])
    varimax = core.fit_factors(data, 4, "varimax")
    oblique = core.fit_factors(data, 4, rotation)
    measures = list(data.columns)
    assert [oblique.communalities[m] for m in measures] == pytest.approx([varimax.communalities[m] for m in measures])
    assert max(oblique.communalities.values()) < 1
    assert oblique.proportion is None and oblique.cumulative is None
    assert oblique.explained == pytest.approx(varimax.explained)
    phi = np.array(oblique.factor_correlations)
    assert np.diag(phi) == pytest.approx(np.ones(4))
    assert oblique.structure.to_numpy() == pytest.approx(oblique.loadings.to_numpy() @ phi, abs=1e-8)


def test_fit_factors_cache_returns_the_same_fit():
    data = _correlated(seed=5)
    assert core.fit_factors(data, 2, "promax") is core.fit_factors(data.copy(), 2, "promax")


def test_single_factor_is_not_rotated():
    assert core.fit_factors(_correlated(), 1, "varimax").rotation == "none"


@pytest.mark.parametrize("n_factors", [0, 6])
def test_fit_factors_rejects_impossible_factor_counts(n_factors):
    with pytest.raises(core.AnalysisError, match="stay empty") as e:
        core.fit_factors(_correlated(), n_factors)
    assert e.value.code == "n_factors_range" and e.value.params["max"] == 5


def test_assign_factors_by_largest_absolute_loading():
    loadings = pd.DataFrame(
        [[0.9, 0.1], [-0.8, 0.2], [0.3, 0.6], [0.2, 0.3]],
        index=["a", "b", "c", "d"], columns=["Factor 1", "Factor 2"],
    )
    factors, unassigned = core.assign_factors(loadings, 0.35)
    assert factors == [
        {"index": 0, "measures": [{"measure": "a", "loading": 0.9}, {"measure": "b", "loading": -0.8}]},
        {"index": 1, "measures": [{"measure": "c", "loading": 0.6}]},
    ]
    assert unassigned == ["d"]

    factors, unassigned = core.assign_factors(loadings, 0.35, {"a": 0.9, "b": 0.4, "c": 0.5, "d": 0.2}, 0.5)
    assert [m["measure"] for f in factors for m in f["measures"]] == ["a", "c"]
    assert unassigned == ["b", "d"]


# --- the whole analysis -------------------------------------------------------------------


def test_analyze_finds_the_two_latent_factors():
    result = core.analyze(_correlated(), core.AnalysisParams())
    assert result["suggested_n_factors"] == 2 and result["n_factors"] == 2
    groups = [{m["measure"][0] for m in f["measures"]} for f in result["factors"]]
    assert sorted(map(sorted, groups)) == [["a"], ["b"]]
    assert result["unassigned"] == []
    assert result["bartlett"]["passed"] and result["kmo"]["passed"]
    assert not result["bartlett"]["regularised"]
    assert result["warnings"] == [] and result["warning_details"] == []


def test_analyze_errors():
    data = _correlated()
    with pytest.raises(core.AnalysisError, match="At least 3 measures"):
        core.analyze(data, core.AnalysisParams(excluded=["a1", "a2", "a3", "b1"]))
    with pytest.raises(core.AnalysisError, match="too few"):
        core.analyze(data.iloc[:5], core.AnalysisParams())
    with pytest.raises(core.AnalysisError, match="at most 5"):
        core.analyze(data, core.AnalysisParams(n_factors=6))
    with pytest.raises(core.AnalysisError, match="Unknown measure") as e:
        core.analyze(data, core.AnalysisParams(excluded=["nope"]))
    assert e.value.code == "unknown_excluded"


def test_analyze_warns_about_unidentified_solutions():
    result = core.analyze(_correlated(), core.AnalysisParams(n_factors=4, auto_msa_filter=False))
    assert "not_identified" in [w["code"] for w in result["warning_details"]]


def test_analyze_flags_communalities_at_the_uniqueness_bound():
    """minres stops at a uniqueness of 0.005; Maximum connector degree ends there."""
    result = core.analyze(_inductive(), core.AnalysisParams(n_factors=4))
    heywood = next(w for w in result["warning_details"] if w["code"] == "heywood")
    assert "Maximum connector degree" in heywood["params"]["measures"]
    assert "Size" not in heywood["params"]["measures"]


def test_analyze_marks_a_regularised_bartlett_test():
    data = _correlated()
    data["sum"] = data["a1"] + data["b1"]
    result = core.analyze(data, core.AnalysisParams(auto_msa_filter=False))
    assert result["bartlett"]["regularised"]
    assert "singular" in [w["code"] for w in result["warning_details"]]


def test_analyze_warns_about_small_samples_and_failed_bartlett():
    rng = np.random.default_rng(3)
    data = pd.DataFrame(rng.normal(size=(12, 3)), columns=list("abc"))
    result = core.analyze(data, core.AnalysisParams(auto_msa_filter=False))
    text = " ".join(result["warnings"])
    assert "Bartlett" in text and "at least 5 per measure" in text


def test_analyze_without_rotation():
    result = core.analyze(_correlated(), core.AnalysisParams(rotation="none", n_factors=2))
    assert result["rotation"] == "none"


# The published results of ComFy and ComFy for log measures are checked in
# test_published_numbers.py.


# --- export -------------------------------------------------------------------------------


def _small_result() -> dict:
    return {
        "n_factors": 2, "n_observations": 50, "rotation": "varimax", "loading_threshold": 0.5,
        "loadings": {"Size_a & b": [0.91234, -0.1], "=cmd": [0.2, -0.5]},
        "communalities": {"Size_a & b": 0.84, "=cmd": 0.29},
    }


def test_loadings_csv():
    lines = loadings_csv(_small_result()).splitlines()
    assert lines[0] == "measure,Factor 1,Factor 2,communality"
    assert lines[1] == "Size_a & b,0.91234,-0.1,0.84"
    # Names from uploads must not become spreadsheet formulas.
    assert lines[2].startswith("'=cmd,")


def test_loadings_latex_bolds_loadings_at_the_threshold():
    tex = loadings_latex(_small_result())
    assert "\\begin{tabular}{lrrr}" in tex
    assert "Measure & Factor 1 & Factor 2 & Communality \\\\" in tex
    assert "Size\\_a \\& b & $\\mathbf{0.9123}$ & $-0.1000$ & $0.8400$ \\\\" in tex
    assert "=cmd & $0.2000$ & $\\mathbf{-0.5000}$ & $0.2900$ \\\\" in tex


def test_loadings_latex_does_not_bold_measures_below_the_communality_threshold():
    tex = loadings_latex({**_small_result(), "communality_threshold": 0.5})
    assert "=cmd & $0.2000$ & $-0.5000$ & $0.2900$ \\\\" in tex
    assert "communality >= 0.5" in tex


def test_latex_escape():
    assert latex_escape("a_b%c#{d}") == "a\\_b\\%c\\#\\{d\\}"


def test_matrix_csv():
    data = pd.DataFrame({"x": [1.0, 2.5]}, index=["a", "b"])
    assert matrix_csv(data) == "observation,x\na,1.0\nb,2.5\n"
