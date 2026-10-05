"""Unit tests for ``AlgorithmBase.coerce_params``.

This is the parameter-coercion layer between the HTTP form-data parser and
the algorithm adapters. Form fields arrive as strings; this method turns
them into the typed values the adapter expects, applies defaults, and
validates enum membership.
"""

from __future__ import annotations

import pytest

from algorithms.base import AlgorithmBase, ParameterSpec


class _DummyAlgo(AlgorithmBase):
    id = "_dummy"
    name = "Dummy"
    description = ""
    tool_type = "complexity"
    parameters_schema = [
        ParameterSpec("a_int", "a", "int", 5),
        ParameterSpec("a_float", "f", "float", 0.5),
        ParameterSpec("a_bool", "b", "bool", False),
        ParameterSpec("a_enum", "e", "enum", "x", options=["x", "y", "z"]),
        ParameterSpec("a_multi", "m", "multi_enum", [], options=["x", "y", "z"]),
    ]


@pytest.fixture
def algo() -> _DummyAlgo:
    return _DummyAlgo()


def test_defaults_applied_when_keys_missing(algo):
    out = algo.coerce_params({})
    assert out == {"a_int": 5, "a_float": 0.5, "a_bool": False, "a_enum": "x", "a_multi": []}


def test_defaults_applied_when_value_empty_string(algo):
    out = algo.coerce_params({"a_int": "", "a_float": "", "a_bool": "", "a_enum": "", "a_multi": ""})
    assert out["a_int"] == 5
    assert out["a_float"] == 0.5
    assert out["a_bool"] is False
    assert out["a_enum"] == "x"
    assert out["a_multi"] == []


def test_defaults_applied_when_value_is_none(algo):
    assert algo.coerce_params({"a_int": None})["a_int"] == 5


def test_int_from_string(algo):
    assert algo.coerce_params({"a_int": "42"})["a_int"] == 42


def test_float_from_string(algo):
    assert algo.coerce_params({"a_float": "1.25"})["a_float"] == 1.25


@pytest.mark.parametrize("raw,expected", [
    ("true", True), ("True", True), ("TRUE", True),
    ("1", True), ("yes", True), ("on", True),
    ("false", False), ("0", False), ("no", False),
    ("off", False), ("anything-else", False),
])
def test_bool_string_variants(algo, raw, expected):
    assert algo.coerce_params({"a_bool": raw})["a_bool"] is expected


def test_bool_native(algo):
    assert algo.coerce_params({"a_bool": True})["a_bool"] is True
    assert algo.coerce_params({"a_bool": False})["a_bool"] is False


def test_enum_accepts_valid(algo):
    assert algo.coerce_params({"a_enum": "y"})["a_enum"] == "y"


def test_enum_rejects_invalid(algo):
    with pytest.raises(ValueError, match="a_enum"):
        algo.coerce_params({"a_enum": "nope"})


def test_multi_enum_list(algo):
    assert algo.coerce_params({"a_multi": ["x", "y"]})["a_multi"] == ["x", "y"]


def test_multi_enum_csv(algo):
    assert algo.coerce_params({"a_multi": "x, y , z"})["a_multi"] == ["x", "y", "z"]


def test_multi_enum_filters_empty_segments(algo):
    assert algo.coerce_params({"a_multi": "x,,y"})["a_multi"] == ["x", "y"]


def test_multi_enum_rejects_unknown(algo):
    with pytest.raises(ValueError, match="a_multi"):
        algo.coerce_params({"a_multi": "x,nope"})


def test_unknown_keys_rejected(algo):
    from algorithms.base import ParameterValidationError
    with pytest.raises(ParameterValidationError) as excinfo:
        algo.coerce_params({"a_int": 10, "totally_unknown": "x"})
    assert "totally_unknown" in excinfo.value.errors
    assert "Unknown parameter key" in excinfo.value.errors["totally_unknown"]


def test_bounds_validation_and_accumulation():
    class TestAlgo(AlgorithmBase):
        id = "test"
        name = "Test"
        description = ""
        tool_type = "complexity"
        parameters_schema = [
            ParameterSpec("val_int", "Val Int", "int", 5, min=2, max=10),
            ParameterSpec("val_float", "Val Float", "float", 0.5, min=0.1, max=2.0),
        ]
    algo = TestAlgo()
    
    # Valid values
    out = algo.coerce_params({"val_int": 3, "val_float": 1.5})
    assert out["val_int"] == 3
    assert out["val_float"] == 1.5
    
    # Out of bounds too low
    from algorithms.base import ParameterValidationError
    with pytest.raises(ParameterValidationError) as excinfo:
        algo.coerce_params({"val_int": 1, "val_float": 0.05})
    assert "val_int" in excinfo.value.errors
    assert "val_float" in excinfo.value.errors
    assert "at least 2" in excinfo.value.errors["val_int"]
    assert "at least 0.1" in excinfo.value.errors["val_float"]

    # Out of bounds too high
    with pytest.raises(ParameterValidationError) as excinfo:
        algo.coerce_params({"val_int": 11, "val_float": 2.5})
    assert "val_int" in excinfo.value.errors
    assert "val_float" in excinfo.value.errors
    assert "at most 10" in excinfo.value.errors["val_int"]
    assert "at most 2.0" in excinfo.value.errors["val_float"]
