"""The short set: one representative measure per dimension (factor_analysis/short_set.py)."""

from __future__ import annotations

import pytest

from factor_analysis.short_set import purity, representatives


def _factors(*groups: list[str]) -> list[dict]:
    return [{"index": i, "measures": [{"measure": m} for m in g]} for i, g in enumerate(groups)]


def test_the_purest_measure_represents_its_dimension():
    loadings = {
        # Highest loading, but close to the second factor: purity 0.9 - 0.6 = 0.3.
        "a": [0.9, 0.6, 0.0],
        # Lower loading, but pure: 0.7 - 0.1 = 0.6.
        "b": [0.7, 0.1, 0.0],
        "c": [0.1, 0.8, 0.2],
        "d": [-0.2, -0.75, 0.0],
    }
    short = representatives(loadings, _factors(["a", "b"], ["c", "d"], []))
    assert [(r["index"], r["measure"]) for r in short] == [(0, "b"), (1, "c")]
    assert short[0]["purity"] == pytest.approx(0.6)
    assert short[0]["loading"] == 0.7


def test_a_tie_goes_to_the_higher_loading():
    loadings = {"x": [0.6, 0.2], "y": [0.8, 0.4], "z": [-0.8, 0.4]}
    # x and y are equally pure (0.4); y loads higher. y and z tie on both: the first stays.
    assert representatives(loadings, _factors(["x", "y", "z"], []))[0]["measure"] == "y"
    assert representatives(loadings, _factors(["z", "y", "x"], []))[0]["measure"] == "z"


def test_a_dimension_without_a_measure_has_no_representative():
    loadings = {"a": [0.9, 0.1], "b": [0.8, 0.3]}
    assert [r["index"] for r in representatives(loadings, _factors([], ["a", "b"]))] == [1]
    assert representatives(loadings, _factors([], [])) == []


def test_a_single_factor_has_no_other_to_subtract():
    assert purity([-0.7], 0) == pytest.approx(0.7)
    assert representatives({"a": [0.5], "b": [-0.7]}, _factors(["a", "b"]))[0]["measure"] == "b"


def test_the_analysis_carries_its_short_set():
    import numpy as np
    import pandas as pd

    from factor_analysis.core import AnalysisParams, analyze

    rng = np.random.default_rng(2)
    a, b = rng.normal(size=200), rng.normal(size=200)
    # The measure with the least noise on each factor is the purest.
    data = pd.DataFrame({
        f"{name}{i}": base + noise * rng.normal(size=200)
        for name, base in (("A", a), ("B", b))
        for i, noise in enumerate((0.2, 0.5, 0.6))
    })
    result = analyze(data, AnalysisParams(n_factors=2))
    short = {r["measure"] for r in result["short_set"]}
    assert short == {"A0", "B0"}
    assert result["short_set"] == representatives(result["loadings"], result["factors"])
