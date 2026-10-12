"""Assignment rules: how measures become factor groups (core.ASSIGNMENT_RULES).

The dimension tables of "Important Factors: Complexity Dimensions for Petri Nets" (ATAED 2026)
are the reference. Tab. 6, 9 and 12 follow the rule "multi" with two documented deviations;
Tab. 17 follows "hair" in the rows of the Directly Follows and the Inductive miner. Tab. 16
(Hybrid ILP) is not tested: the paper's data differ from the bundled CSV.
"""

from __future__ import annotations

import io
import json
import typing
import zipfile

import pandas as pd
import pytest

from factor_analysis import core

# The short names of the paper.
SHORT = {
    "Size": "size", "Connector Mismatch": "MM", "Connector Heterogeneity": "CH", "Token split": "ts",
    "Control flow complexity": "CFC", "Separability": "sep", "Average connector degree": "acd",
    "Maximum connector degree": "mcd", "Sequentiality": "seq",
    "Coefficient of network connectivity": "CNC", "Density": "dens",
    "Number of duplicate tasks": "dup", "Number of empty sequence flows": "esf",
}

# The settings of the paper (its section 5): k = 4, varimax, MSA 0.6, |loading| > 0.35,
# communality >= 0.3.
PAPER = {
    "n_factors": 4, "rotation": "varimax", "msa_threshold": 0.6, "bartlett_alpha": 0.05,
    "loading_threshold": 0.35, "communality_threshold": 0.3,
}


def _frame(rows: dict[str, list[float]]) -> pd.DataFrame:
    k = len(next(iter(rows.values())))
    return pd.DataFrame(list(rows.values()), index=list(rows), columns=[f"Factor {i + 1}" for i in range(k)])


def _groups(assignment: core.Assignment | dict) -> dict[int, set[str]]:
    factors = assignment.factors if isinstance(assignment, core.Assignment) else assignment["factors"]
    return {f["index"] + 1: {m["measure"] for m in f["measures"]} for f in factors}


# --- the rules on made-up loadings -------------------------------------------------------

LOADINGS = _frame({
    "single": [0.80, 0.10, 0.05],
    "cross": [0.60, -0.50, 0.10],     # 0.10 apart: cross-loaded on factors 1 and 2
    "far": [0.70, 0.40, 0.00],        # 0.30 apart: factor 1 only
    "weak": [0.30, 0.20, 0.10],       # no loading reaches 0.35
    "lonely": [0.10, 0.20, 0.90],     # high loading, low communality below
})
COMMUNALITIES = {"single": 0.7, "cross": 0.6, "far": 0.65, "weak": 0.4, "lonely": 0.45}


def test_largest_is_the_rule_of_comfy_and_reports_cross_loadings_only():
    result = core.assign(LOADINGS, 0.35, COMMUNALITIES, 0.0, "largest")
    assert _groups(result) == {1: {"single", "cross", "far"}, 2: set(), 3: {"lonely"}}
    assert result.unassigned == [{"measure": "weak", "reason": "low_loading"}]
    assert result.cross_loadings == [{"measure": "cross", "factors": [0, 1], "loadings": [0.6, -0.5]}]
    assert result.communality_threshold == 0.0


def test_multi_puts_a_cross_loaded_measure_on_every_factor_of_it():
    result = core.assign(LOADINGS, 0.35, COMMUNALITIES, 0.0, "multi")
    assert _groups(result) == {1: {"single", "cross", "far"}, 2: {"cross"}, 3: {"lonely"}}
    assert result.cross_loadings[0]["measure"] == "cross"
    # Within a factor the largest absolute loading comes first.
    assert [m["measure"] for m in result.factors[0]["measures"]] == ["single", "far", "cross"]
    # The rule's own minimum communality applies, 0.3 here.
    assert result.communality_threshold == 0.3


def test_hair_leaves_out_cross_loaded_measures_and_needs_a_communality_of_one_half():
    result = core.assign(LOADINGS, 0.35, COMMUNALITIES, 0.0, "hair")
    assert _groups(result) == {1: {"single", "far"}, 2: set(), 3: set()}
    assert result.unassigned == [
        {"measure": "cross", "reason": "cross_loading"},
        {"measure": "weak", "reason": "low_communality"},
        {"measure": "lonely", "reason": "low_communality"},
    ]
    assert result.communality_threshold == 0.5


def test_a_higher_communality_threshold_than_the_rule_asks_for_wins():
    result = core.assign(LOADINGS, 0.35, COMMUNALITIES, 0.62, "multi")
    assert result.communality_threshold == 0.62
    assert {u["measure"]: u["reason"] for u in result.unassigned} == {
        "cross": "low_communality", "weak": "low_communality", "lonely": "low_communality",
    }


def test_multi_and_hair_need_a_loading_above_the_threshold_largest_one_at_it():
    at = _frame({"edge": [0.35, 0.0], "other": [0.0, 0.9]})
    assert _groups(core.assign(at, 0.35, rule="largest")) == {1: {"edge"}, 2: {"other"}}
    for rule in ("multi", "hair"):
        result = core.assign(at, 0.35, rule=rule)
        assert result.unassigned == [{"measure": "edge", "reason": "low_loading"}], rule


def test_a_second_loading_must_count_on_its_own_to_cross_load():
    # 0.45 is within 0.15 of 0.5 but not above 0.46.
    below = _frame({"m": [0.5, 0.45]})
    assert core.assign(below, 0.46, rule="multi").cross_loadings == []
    assert core.assign(below, 0.35, rule="multi").cross_loadings[0]["factors"] == [0, 1]


def test_a_gap_of_exactly_the_limit_still_cross_loads():
    exact = _frame({"m": [0.65, 0.5]})
    assert 0.65 - 0.5 > core.CROSS_LOADING_GAP  # in floating point
    assert core.assign(exact, 0.35, rule="multi").cross_loadings[0]["factors"] == [0, 1]


def test_assign_factors_keeps_its_old_shape():
    factors, unassigned = core.assign_factors(LOADINGS, 0.35, COMMUNALITIES, 0.5)
    assert unassigned == ["weak", "lonely"]
    assert _groups({"factors": factors}) == {1: {"single", "cross", "far"}, 2: set(), 3: set()}


def test_unknown_rule():
    with pytest.raises(core.AnalysisError) as e:
        core.assign(LOADINGS, 0.35, rule="nearest")
    assert e.value.code == "unknown_assignment_rule"
    with pytest.raises(core.AnalysisError):
        core.check_params(["a", "b", "c"], 10, core.AnalysisParams(assignment_rule="nearest"))


def test_the_api_offers_exactly_the_rules_of_core():
    from routes.factor_analysis import AnalyzeRequest

    offered = typing.get_args(AnalyzeRequest.model_fields["assignment_rule"].annotation)
    assert set(offered) == set(core.ASSIGNMENT_RULES)
    assert AnalyzeRequest().assignment_rule == core.DEFAULT_ASSIGNMENT_RULE == "largest"


# --- the rules against the paper ---------------------------------------------------------

_RESULTS: dict[tuple, dict] = {}


@pytest.fixture
def analysis(client):
    """The analysis of a bundled IF dataset through the API, short measure names."""

    def run(miner: str, rule: str, **options) -> dict:
        key = (miner, rule, json.dumps(options, sort_keys=True))
        if key not in _RESULTS:
            created = client.post("/factor-analysis/datasets", data={
                "kind": "model", "source": "bundled", "bundled_id": f"comfy-paper-{miner}-miner",
            })
            dataset_id = created.json()["dataset_id"]
            r = client.post(
                f"/factor-analysis/datasets/{dataset_id}/analyze",
                json={**PAPER, **options, "assignment_rule": rule},
            )
            assert r.status_code == 200, r.text
            _RESULTS[key] = r.json()
        return _RESULTS[key]

    return run


def _short_groups(result: dict) -> dict[int, set[str]]:
    return {i: {SHORT[m] for m in g} for i, g in _groups(result).items()}


def test_alpha_multi_is_table_6_with_ch_also_in_factor_2(analysis):
    groups = _short_groups(analysis("alpha", "multi"))
    table_6 = {
        1: {"size", "MM", "ts", "CFC", "mcd", "CNC", "esf"},
        2: {"acd", "dens"},
        3: {"sep", "seq"},
        4: {"CH"},
    }
    # Documented deviation: CH loads -0.49 on factor 2, 0.13 below its 0.62 on factor 4, so
    # the rule of the text puts it there as well; Tab. 6 lists CH in dimension 4 only.
    table_6[2] = table_6[2] | {"CH"}
    assert groups == table_6


def test_directly_follows_multi_is_table_9(analysis):
    result = analysis("directly-follows", "multi")
    # The bundled CSV has dup with tau only; Tab. 9 lists both dup columns in dimension 1.
    assert _short_groups(result) == {
        1: {"size", "CFC", "acd", "dup", "mcd", "CNC"},
        2: {"dens"},
        3: {"mcd", "CNC"},
        4: {"sep"},
    }
    assert {SHORT[c["measure"]] for c in result["cross_loadings"]} == {"mcd", "CNC"}


def test_inductive_multi_is_table_12_with_acd_also_in_factor_2(analysis):
    result = analysis("inductive", "multi")
    table_12 = {
        1: {"size", "ts", "dup", "acd", "dens"},
        2: {"mcd", "CNC"},
        3: {"CH", "acd", "dens"},
        4: {"sep"},
    }
    # Documented deviation: acd loads 0.4608 on factor 2, 0.122 below its 0.583 on factor 3;
    # Tab. 12 lists acd in dimensions 1 and 3 only.
    table_12[2] = table_12[2] | {"acd"}
    assert _short_groups(result) == table_12
    acd = next(c for c in result["cross_loadings"] if SHORT[c["measure"]] == "acd")
    assert acd["factors"] == [2, 0, 1]
    assert acd["loadings"] == pytest.approx([0.583, -0.4835, 0.4608], abs=1e-4)
    # MM: communality 0.21, below 0.3; the paper excludes it from the interpretation.
    assert result["unassigned"] == ["Connector Mismatch"]
    assert result["unassigned_details"] == [{"measure": "Connector Mismatch", "reason": "low_communality"}]


def test_inductive_hair_is_its_row_of_table_17(analysis):
    result = analysis("inductive", "hair")
    assert _short_groups(result) == {1: {"size", "ts", "dup"}, 2: {"mcd", "CNC"}, 3: {"CH"}, 4: {"sep"}}
    reasons = {SHORT[u["measure"]]: u["reason"] for u in result["unassigned_details"]}
    assert reasons == {"MM": "low_communality", "acd": "cross_loading", "dens": "cross_loading"}
    assert result["assignment"]["communality_threshold"] == 0.5


def test_directly_follows_hair_is_its_row_of_table_17(analysis):
    assert _short_groups(analysis("directly-follows", "hair")) == {
        1: {"size", "CFC", "acd", "dup"}, 2: {"dens"}, 3: set(), 4: {"sep"},
    }


def test_inductive_with_two_factors_has_no_cross_loading(analysis):
    assert analysis("inductive", "multi", n_factors=2)["cross_loadings"] == []


def test_largest_stays_the_default_and_keeps_its_groups(client, analysis):
    created = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner",
    }).json()
    default = client.post(f"/factor-analysis/datasets/{created['dataset_id']}/analyze", json=PAPER).json()
    assert default["assignment_rule"] == "largest"
    assert default["factors"] == analysis("inductive", "largest")["factors"]
    assert default["assignment"] == {
        "rule": "largest", "loading_threshold": 0.35, "loading_strict": False,
        "communality_threshold": 0.3, "cross_loading_gap": 0.15, "cross_loaded": "largest",
    }
    assert _short_groups(default) == {1: {"size", "ts", "dup"}, 2: {"mcd", "CNC"}, 3: {"CH", "acd", "dens"}, 4: {"sep"}}
    # Every used measure is in a group or unassigned, once.
    assigned = [m["measure"] for f in default["factors"] for m in f["measures"]]
    assert sorted(assigned + default["unassigned"]) == sorted(default["used_measures"])


def test_an_unknown_rule_is_a_422(client):
    created = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner",
    }).json()
    r = client.post(f"/factor-analysis/datasets/{created['dataset_id']}/analyze", json={"assignment_rule": "lieben"})
    assert r.status_code == 422


# --- the rule in the exports -------------------------------------------------------------


def test_exports_name_the_rule(client):
    created = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner",
    }).json()
    base = f"/factor-analysis/datasets/{created['dataset_id']}"
    body = {**PAPER, "assignment_rule": "multi"}

    tex = client.post(f"{base}/export", json={**body, "format": "latex"}).text
    assert "bold: the loadings by which the rule puts a measure on a factor (|loading| > 0.35 and communality >= 0.3)." in tex
    assert "% Assignment rule multi: each measure on every factor whose absolute loading exceeds" in tex
    # Bold where the rule assigned: CNC only on F2, though 0.4778 on F4 exceeds 0.35 too; acd
    # on F1 to F3, not on F4, which lies more than 0.15 below its largest loading.
    assert "Coefficient of network connectivity & $-0.4728$ & $\\mathbf{0.6628}$ & $0.2911$ & $0.4778$" in tex
    assert "Average connector degree & $\\mathbf{-0.4835}$ & $\\mathbf{0.4608}$ & $\\mathbf{0.5830}$ & $0.4128$" in tex
    assert "% In no factor: Connector Mismatch (low communality)." in tex
    hair = client.post(f"{base}/export", json={**body, "assignment_rule": "hair", "format": "latex"}).text
    assert "Average connector degree & $-0.4835$ & $0.4608$ & $0.5830$ & $0.4128$" in hair
    assert "(cross-loading)" in hair and "Density (cross-loading)" in hair
    # The CSV keeps its columns.
    csv = client.post(f"{base}/export", json={**body, "format": "csv"}).text
    assert csv.splitlines()[0] == "measure,Factor 1,Factor 2,Factor 3,Factor 4,communality"

    r = client.post(f"{base}/export/zip", json=body)
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        readme = archive.read("README.txt").decode()
        assignment = pd.read_csv(io.BytesIO(archive.read("assignment.csv")), dtype=str, keep_default_na=False)
    assert manifest["analysis_params"]["assignment_rule"] == "multi"
    assert manifest["analysis"]["assignment_rule"] == "multi"
    assert manifest["analysis"]["assignment"]["communality_threshold"] == 0.3
    assert "assignment rule multi: each measure on every factor" in readme
    rows = assignment.set_index("measure")
    assert rows.loc["Average connector degree"].to_dict() == {"factors": "1 2 3", "reason": "", "cross_loading": "3 1 2"}
    assert rows.loc["Connector Mismatch"].to_dict() == {"factors": "", "reason": "low_communality", "cross_loading": ""}
    assert rows.loc["Size"].to_dict() == {"factors": "1", "reason": "", "cross_loading": ""}
