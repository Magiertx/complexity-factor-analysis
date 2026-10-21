"""Short codes of the measures (factor_analysis/short_codes.py)."""

from __future__ import annotations

import pandas as pd

from algorithms.comfy import MEASURES_BY_NAME
from factor_analysis import catalog as cat
from factor_analysis.short_codes import LOG_CODES, MODEL_CODES, TOOL_MODEL_CODES, codes_for, label, short_code
from vendored.comfy_log import Constants as LogConstants

# The codes the tables of Important Factors (ATAED 2026) print.
PAPER_CODES = {
    "Size": "size", "Connector Mismatch": "MM", "Connector Heterogeneity": "CH", "Token split": "ts",
    "Control flow complexity": "CFC", "Separability": "sep", "Average connector degree": "acd",
    "Maximum connector degree": "mcd", "Sequentiality": "seq",
    "Coefficient of network connectivity": "CNC", "Density": "dens",
    "Number of duplicate tasks": "dup", "Number of empty sequence flows": "esf",
}


def test_every_model_measure_has_a_code():
    assert set(MODEL_CODES) == set(MEASURES_BY_NAME)
    assert len(set(MODEL_CODES.values())) == len(MODEL_CODES)


def test_the_model_codes_are_those_of_important_factors():
    # The 13 measures of the paper keep its codes; only the four it leaves out have the tool's.
    assert {m: MODEL_CODES[m] for m in PAPER_CODES} == PAPER_CODES
    assert set(MODEL_CODES) - set(PAPER_CODES) == TOOL_MODEL_CODES


def test_every_feeed_feature_has_a_code():
    features = [f for group in LogConstants.all_measures.values() for f in group]
    assert len(features) == 146
    assert set(LOG_CODES) == set(features)
    assert len(set(LOG_CODES.values())) == len(LOG_CODES)
    # As the macros of ComFy for log measures write them, without LaTeX escapes.
    assert LOG_CODES["n_events"] == "mag"
    assert LOG_CODES["n_variants"] == "DT-#"
    assert LOG_CODES["ratio_top_1_variants"] == "FREQ-T-max-1%"
    assert not any("\\" in code for code in LOG_CODES.values())


def test_every_column_of_a_bundled_dataset_has_a_code():
    for entry in cat.manifest()["datasets"]:
        columns = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0, nrows=0).columns
        assert all(short_code(entry["kind"], c) for c in columns), entry["id"]


def test_the_catalog_names_the_codes():
    for kind in cat.KINDS:
        measures = cat.catalog(kind)["measures"]
        assert all(m["short"] == short_code(kind, m["key"]) for m in measures), kind


def test_a_measure_without_a_code_keeps_its_name():
    assert short_code("model", "my own measure") is None
    assert label("model", "my own measure", short=True) == "my own measure"
    assert label("model", "Density", short=True) == "dens"
    assert label("model", "Density", short=False) == "Density"
    assert codes_for("log", ["n_events", "nope"]) == {"n_events": "mag"}
