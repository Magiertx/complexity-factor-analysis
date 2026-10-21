"""The comparison of factor structures (factor_analysis/compare.py, POST /factor-analysis/compare).

The reference is Tab. 17 of "Important Factors: Complexity Dimensions for Petri Nets" (ATAED
2026): the dimensions of the Alpha, Directly Follows, Inductive and Hybrid ILP miner with the
paper settings (k = 4, varimax) under Hair et al. (communality >= 0.5, cross-loaded measures
left out), which is the rule "hair". On the bundled data:

- Directly Follows and Inductive: the groups are those of Tab. 17. The bundled CSV has one dup
  column, Tab. 17 lists dup and dup with tau for the Directly Follows miner.
- Alpha: Tab. 17 also lists MM (communality 0.37) and the cross-loaded CH, which the rule
  leaves out; the other groups are those of Tab. 17.
- Hybrid ILP: Tab. 14-16 rest on other data than the bundled CSV (the descriptive statistics
  differ for 11 of 12 measures). The groups differ by MM (in dimension 1 here), sep (with size
  here; removed by the MSA filter in the paper) and CH (low communality here).

The dimension numbers are the tool's own: Tab. 17 renumbered its dimensions by hand "for easier
comparability", the tool matches the factors of the columns by the measures they share. Both
line up the dimension of size, ts and CFC, the dimension of sep, and that of acd and dens with
the dens of the Directly Follows miner. They differ for the Inductive miner, whose CH loads
together with acd and dens on its factor 3: the tool puts that factor with acd and dens of the
Alpha miner (dimension 2) and mcd and CNC into a dimension of their own, Tab. 17 puts mcd and
CNC into dimension 2 and CH with the CH of the Alpha miner. Hybrid ILP: the tool puts its
factor of size and sep with sep, the paper its seq.
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import zipfile

import pytest

from factor_analysis import compare

SHORT = {
    "Size": "size", "Connector Mismatch": "MM", "Connector Heterogeneity": "CH", "Token split": "ts",
    "Control flow complexity": "CFC", "Separability": "sep", "Average connector degree": "acd",
    "Maximum connector degree": "mcd", "Sequentiality": "seq",
    "Coefficient of network connectivity": "CNC", "Density": "dens",
    "Number of duplicate tasks": "dup", "Number of empty sequence flows": "esf",
}

FOUR = ["alpha", "directly-follows", "inductive", "hybrid-ilp"]
SEVEN = [*FOUR, "heuristics", "alpha-plus", "alpha-dollar"]

# Tab. 17, dimensions 1 to 4 per miner, with the paper's dup and dup with tau as one dup.
TAB_17 = {
    "alpha": [{"size", "MM", "ts", "CFC", "mcd", "CNC", "esf"}, {"acd", "dens"}, {"CH"}, {"sep", "seq"}],
    "directly-follows": [{"size", "CFC", "acd", "dup"}, {"dens"}, set(), {"sep"}],
    "inductive": [{"size", "ts", "dup"}, {"mcd", "CNC"}, {"CH"}, {"sep"}],
    "hybrid-ilp": [{"ts", "CFC", "acd", "mcd", "CNC", "esf"}, {"size"}, set(), {"seq"}],
}


def _body(miners: list[str], rule: str = "hair", **extra) -> dict:
    return {"columns": [{"bundled_id": f"comfy-paper-{m}-miner"} for m in miners], "assignment_rule": rule, **extra}


_RESULTS: dict[str, dict] = {}


@pytest.fixture
def compared(client):
    """The comparison through the API, computed once per request body."""

    def run(body: dict) -> dict:
        key = json.dumps(body, sort_keys=True)
        if key not in _RESULTS:
            r = client.post("/factor-analysis/compare", json=body)
            assert r.status_code == 200, r.text
            _RESULTS[key] = r.json()
        return _RESULTS[key]

    return run


def _groups(comparison: dict, column: int) -> list[set[str]]:
    """The measures of each dimension of a column, by short name."""
    return [{SHORT[m["measure"]] for m in (d["columns"][column] or {}).get("measures", [])} for d in comparison["dimensions"]]


def _partition(groups: list[set[str]]) -> set[frozenset[str]]:
    return {frozenset(g) for g in groups if g}


# --- matching the factors -----------------------------------------------------------------


def test_primary_groups_put_each_measure_on_its_largest_loading():
    loadings = {"a": [0.9, 0.1], "b": [-0.2, -0.8], "c": [0.4, 0.4], "d": [0.0, 0.0]}
    assert compare.primary_groups(loadings, 2) == [{"a", "c", "d"}, {"b"}]


def test_align_keeps_the_first_column_and_finds_a_permutation():
    first = [{"a", "b"}, {"c"}, {"d", "e"}]
    permuted = [{"d", "e"}, {"a", "b"}, {"c"}]
    dimensions, shared = compare.align([first, permuted])
    assert dimensions == [[0, 1, 2], [2, 0, 1]]
    assert shared == [[0, 0, 0], [2, 2, 1]]


def test_align_counts_the_columns_before_and_keeps_numbers_in_a_tie():
    columns = [
        [{"a", "b"}, {"c", "d"}],
        [{"c", "d"}, {"a", "b"}],
        # "x" shares nothing: it keeps its own number where that is free.
        [{"c"}, {"a"}, {"x"}],
    ]
    dimensions, _ = compare.align(columns)
    assert dimensions == [[0, 1], [1, 0], [1, 0, 2]]


def test_align_with_unequal_factor_counts_and_a_failed_column():
    columns = [[{"a"}, {"b"}, {"c"}], [], [{"c", "b"}, {"a"}], [{"b"}, {"a"}, {"c"}, {"z"}]]
    dimensions, shared = compare.align(columns)
    # Four dimensions, as the column with the most factors has.
    assert dimensions[1] == [] and shared[1] == []
    assert dimensions[0] == [0, 1, 2]
    assert dimensions[2][1] == 0
    assert dimensions[3] == [1, 0, 2, 3]


# --- Tab. 17 ------------------------------------------------------------------------------


def test_four_miners_under_hair_have_the_groups_of_table_17(compared):
    comparison = compared(_body(FOUR))
    assert [c["label"] for c in comparison["columns"]] == [
        "Alpha miner", "Directly Follows miner", "Inductive miner", "Hybrid ILP miner",
    ]
    assert comparison["assignment_rule"] == "hair"
    assert comparison["alignment"]["dimensions"] == 4
    groups = {m: _groups(comparison, i) for i, m in enumerate(FOUR)}

    assert _partition(groups["directly-follows"]) == _partition(TAB_17["directly-follows"])
    assert _partition(groups["inductive"]) == _partition(TAB_17["inductive"])

    # Documented deviation: MM (communality below 0.5) and the cross-loaded CH are left out.
    alpha = [g - {"MM", "CH"} for g in TAB_17["alpha"]]
    assert _partition(groups["alpha"]) == _partition(alpha)
    reasons = {SHORT[u["measure"]]: u["reason"] for u in comparison["unassigned"][0]}
    assert reasons == {"MM": "low_communality", "CH": "cross_loading"}

    # Documented deviations, other data than the paper's: MM in dimension 1, sep with size,
    # CH of low communality.
    hybrid = [TAB_17["hybrid-ilp"][0] | {"MM"}, {"size", "sep"}, {"seq"}]
    assert _partition(groups["hybrid-ilp"]) == _partition(hybrid)
    assert {SHORT[u["measure"]]: u["reason"] for u in comparison["unassigned"][3]} == {"CH": "low_communality"}


def test_four_miners_line_up_like_table_17_where_its_dimensions_share_measures(compared):
    comparison = compared(_body(FOUR))
    rows = {SHORT[r["measure"]]: r for r in comparison["measures"]}

    def dims(measure: str) -> list[int | None]:
        return [c["dimensions"][0] if c["status"] == "assigned" else None for c in rows[measure]["cells"]]

    # Dimension 1 holds size, ts and CFC in every column that has them, as in Tab. 17 ...
    assert dims("size")[:3] == [0, 0, 0]
    assert dims("ts") == [0, None, 0, 0]
    assert dims("CFC") == [0, 0, None, 0]
    # ... sep has one dimension wherever it is assigned, and dens that of acd of the Alpha miner.
    sep = [d for d in dims("sep") if d is not None]
    assert len(sep) == 4 and len(set(sep)) == 1
    assert dims("dens")[:2] == [1, 1] and dims("acd")[0] == 1
    # The documented difference: the Inductive miner's CH goes with acd and dens of the Alpha
    # miner, its mcd and CNC into a dimension of their own.
    assert dims("CH")[2] == 1
    assert dims("mcd")[2] == dims("CNC")[2] == 3
    # The factors of the first column keep their numbers.
    assert comparison["columns"][0]["factor_dimensions"] == [0, 1, 2, 3]


def test_the_findings_of_section_6_can_be_read_off(compared):
    """ts and CFC always share a dimension, mcd and CNC always appear together, CH is alone
    (IF, section 6), in every column under the two rules of the paper. Under "largest" the
    cross-loaded mcd and CNC of the Directly Follows miner go to their two factors."""
    for rule in ("hair", "multi"):
        comparison = compared(_body(FOUR, rule))
        for i in range(len(FOUR)):
            groups = _groups(comparison, i)
            for a, b in (("ts", "CFC"), ("mcd", "CNC")):
                with_a = [d for d, g in enumerate(groups) if a in g]
                with_b = [d for d, g in enumerate(groups) if b in g]
                if with_a and with_b:
                    assert with_a == with_b, (rule, FOUR[i], a, b)
            for g in groups:
                if "CH" in g and rule == "hair":
                    assert g == {"CH"}, (rule, FOUR[i])


def test_the_dimensions_do_not_change_with_the_rule(compared):
    numbers = {rule: [c["factor_dimensions"] for c in compared(_body(FOUR, rule))["columns"]] for rule in ("hair", "multi", "largest")}
    assert numbers["hair"] == numbers["multi"] == numbers["largest"]


def test_column_headers(compared):
    columns = compared(_body(FOUR))["columns"]
    alpha, dfm, inductive, hybrid = columns
    for column in columns:
        assert column["n_observations"] == 288
        assert column["n_measures"] == 13
        assert column["n_factors"] == 4
        assert column["rotation"] == "varimax"
        assert column["settings"] == "paper"
        assert column["options"]["assignment_rule"] == "hair"
        assert column["options"]["communality_threshold"] == 0.3
    assert alpha["kmo"] == pytest.approx(0.8339, abs=1e-4)
    assert alpha["cumulative_variance"] == pytest.approx(0.8603, abs=1e-4)
    assert len(alpha["used_measures"]) == 12 and alpha["msa_removed"] == []
    assert {SHORT[m] for m in dfm["msa_removed"]} == {"seq", "MM"}
    assert {SHORT[m] for m in inductive["msa_removed"]} == {"seq", "CFC"}
    assert {SHORT[m] for m in hybrid["msa_removed"]} == {"dens"}
    assert alpha["published_source"].startswith("Important Factors")
    assert hybrid["paper_tables"] == "other_data"


def test_cells_say_why_a_measure_is_in_no_dimension(compared):
    rows = {SHORT[r["measure"]]: r["cells"] for r in compared(_body(FOUR))["measures"]}
    alpha, dfm, inductive, hybrid = range(4)
    assert rows["CH"][alpha]["status"] == "unassigned" and rows["CH"][alpha]["reason"] == "cross_loading"
    assert rows["CH"][alpha]["cross_loading"] is True
    # CH loads 0.62 on factor 4 and -0.49 on factor 2 of the Alpha miner.
    assert rows["CH"][alpha]["cross_dimensions"] == [3, 1]
    assert rows["CH"][alpha]["cross_loadings"] == pytest.approx([0.62, -0.49], abs=0.01)
    assert "cross_dimensions" not in rows["size"][alpha]
    assert rows["MM"][dfm] == {"status": "msa_removed", "msa": pytest.approx(rows["MM"][dfm]["msa"]), "step": 1}
    assert rows["MM"][dfm]["msa"] < 0.6
    assert rows["ts"][dfm] == {"status": "dropped", "reason": "constant"}
    assert rows["size"][inductive]["status"] == "assigned" and rows["size"][inductive]["cross_loading"] is False
    assert rows["seq"][hybrid]["status"] == "assigned"


def test_multi_puts_a_cross_loaded_measure_into_several_dimensions(compared):
    rows = {SHORT[r["measure"]]: r["cells"] for r in compared(_body(FOUR, "multi"))["measures"]}
    acd = rows["acd"][2]
    assert acd["status"] == "assigned" and acd["cross_loading"] is True
    assert len(acd["dimensions"]) == 3 and len(set(acd["dimensions"])) == 3
    # Largest absolute loading first.
    assert [abs(v) for v in acd["loadings"]] == sorted((abs(v) for v in acd["loadings"]), reverse=True)


def test_rows_are_grouped_by_dimension(compared):
    rows = compared(_body(FOUR))["measures"]
    order = [r["dimension"] for r in rows]
    assigned = [d for d in order if d is not None]
    assert assigned == sorted(assigned)
    assert all(d is None for d in order[len(assigned):])
    assert {SHORT[r["measure"]] for r in rows} == set(SHORT.values())


def test_alpha_dollar_is_named_the_same_as_alpha_and_heuristics_has_three_factors(compared):
    comparison = compared(_body(SEVEN))
    columns = comparison["columns"]
    assert columns[SEVEN.index("alpha-dollar")]["same_as"] == 0
    assert all(c["same_as"] is None for c in columns[:-1])
    heuristics = columns[SEVEN.index("heuristics")]
    assert heuristics["n_factors"] == 3 and len(heuristics["factor_dimensions"]) == 3
    assert comparison["alignment"]["dimensions"] == 4


def test_a_second_comparison_with_another_rule_reuses_the_fits(client):
    body = _body(["inductive", "alpha"], "largest")
    client.post("/factor-analysis/compare", json=body)
    again = client.post("/factor-analysis/compare", json={**body, "assignment_rule": "multi"}).json()
    assert [c["timings"]["fit_cached"] for c in again["columns"]] == [True, True]


def test_a_comparison_needs_no_dataset_of_the_session(client):
    assert client.post("/factor-analysis/compare", json=_body(["alpha", "inductive"])).status_code == 200
    assert client.get("/factor-analysis/datasets").json() == {"datasets": []}


# --- columns with their own settings ------------------------------------------------------


def test_the_same_dataset_with_four_and_six_factors(client):
    body = {
        "columns": [
            {"bundled_id": "comfy-paper-inductive-miner"},
            {"bundled_id": "comfy-paper-inductive-miner", "options": {"n_factors": 6}, "label": "Inductive, k = 6"},
        ],
        "assignment_rule": "hair",
    }
    comparison = client.post("/factor-analysis/compare", json=body).json()
    first, second = comparison["columns"]
    assert (first["n_factors"], second["n_factors"]) == (4, 6)
    assert second["label"] == "Inductive, k = 6"
    assert comparison["alignment"]["dimensions"] == 6
    # The factors of the six-factor solution find those of the four-factor one.
    assert second["factor_dimensions"][:4] == [0, 2, 1, 3]
    # IF, section 6: with six factors only MM has its largest loading beyond the fourth, and its
    # communality (0.33) keeps it out of the interpretation.
    rows = {SHORT[r["measure"]]: r["cells"] for r in comparison["measures"]}
    mm = rows["MM"][1]
    assert mm["status"] == "unassigned" and mm["reason"] == "low_communality"
    assert mm["factor"] == 4 and mm["communality"] == pytest.approx(0.33, abs=0.01)
    assert [d["columns"][1]["measures"] for d in comparison["dimensions"][4:]] == [[], []]


def test_standard_settings_and_kaiser(client):
    body = {
        "columns": [
            {"bundled_id": "comfy-paper-alpha-miner", "settings": "standard"},
            {"bundled_id": "comfy-paper-alpha-miner", "options": {"n_factors": None, "rotation": "promax"}},
        ],
    }
    comparison = client.post("/factor-analysis/compare", json=body).json()
    standard, kaiser = comparison["columns"]
    assert comparison["assignment_rule"] == "largest"
    assert standard["settings"] == "standard" and standard["published_source"] is None
    assert standard["options"]["communality_threshold"] == 0.0
    assert standard["n_factors"] == kaiser["n_factors"] == standard["factor_count"]["kaiser"] == 3
    assert kaiser["rotation"] == "promax" and kaiser["cumulative_variance"] is None


def test_a_column_that_cannot_be_analysed_carries_its_error(client):
    body = {
        "columns": [
            {"bundled_id": "comfy-paper-inductive-miner"},
            {"bundled_id": "comfy-paper-inductive-miner", "options": {"n_factors": 12}},
        ],
    }
    r = client.post("/factor-analysis/compare", json=body)
    assert r.status_code == 200
    comparison = r.json()
    failed = comparison["columns"][1]
    assert failed["error"]["code"] == "n_factors_range"
    assert "factor_dimensions" not in failed
    assert comparison["dimensions"][0]["columns"][1] is None
    # What cleaning dropped is known without the analysis.
    assert {r["cells"][1]["status"] for r in comparison["measures"]} == {"failed", "dropped"}


@pytest.mark.parametrize(
    "body, status, code",
    [
        ({"columns": [{"bundled_id": "comfy-paper-alpha-miner"}]}, 422, None),
        ({"columns": [{"bundled_id": "comfy-paper-alpha-miner"}] * 9}, 422, None),
        ({"columns": [{"bundled_id": "comfy-paper-alpha-miner"}, {"bundled_id": "nope"}]}, 400, "compare_unknown_dataset"),
        (
            {"columns": [{"bundled_id": "comfy-paper-alpha-miner"}, {"bundled_id": "comfy-log-pdc-training-logs"}]},
            400,
            "compare_mixed_kinds",
        ),
        ({**_body(["alpha", "inductive"]), "assignment_rule": "lieben"}, 422, None),
        ({"columns": [{"bundled_id": "comfy-paper-alpha-miner", "options": {"assignment_rule": "multi"}}] * 2}, 422, None),
    ],
)
def test_bad_requests(client, body, status, code):
    r = client.post("/factor-analysis/compare", json=body)
    assert r.status_code == status, r.text
    if code:
        assert r.json()["code"] == code


# --- exports ------------------------------------------------------------------------------


def test_csv_has_a_row_per_measure_and_a_column_per_analysis(client):
    r = client.post("/factor-analysis/compare/export", json={**_body(FOUR), "format": "csv"})
    assert r.status_code == 200
    assert 'filename="factor-structures.csv"' in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert lines[0] == "measure,code,dimension,Alpha miner,Directly Follows miner,Inductive miner,Hybrid ILP miner"
    assert "Separability,sep,D3,D3,D3,D3,D3" in lines
    assert "Connector Heterogeneity,CH,D2,unassigned:cross_loading,dropped:constant,D2,unassigned:low_communality" in lines
    assert len(lines) == 14


def test_latex_is_laid_out_like_table_17(client):
    r = client.post("/factor-analysis/compare/export", json={**_body(FOUR), "format": "latex"})
    assert r.status_code == 200
    tex = r.text
    assert " & Dimension 1 & Dimension 2 & Dimension 3 & Dimension 4 \\\\" in tex
    # Codes in the order of the data, as Tab. 17 lists them.
    assert "Inductive miner & size, ts, dup & CH & sep & mcd, CNC \\\\" in tex
    assert "Directly Follows miner & size, CFC, acd, dup & dens & sep &  \\\\" in tex
    assert "% Assignment rule hair:" in tex
    assert "% In no dimension, Alpha miner: Connector Mismatch (low communality); Connector Heterogeneity (cross-loading)." in tex
    names = client.post("/factor-analysis/compare/export", json={**_body(FOUR), "format": "latex", "short_codes": False}).text
    assert "Inductive miner & Size, Token split, Number of duplicate tasks &" in names


def test_zip_has_the_request_and_the_parameters_of_every_column(client):
    body = _body(FOUR)
    r = client.post("/factor-analysis/compare/export", json={**body, "format": "zip"})
    assert r.status_code == 200
    with zipfile.ZipFile(io.BytesIO(r.content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
        comparison = json.loads(archive.read("comparison.json"))
        readme = archive.read("README.txt").decode()
    assert names == {"manifest.json", "README.txt", "comparison.json", "membership.csv", "dimensions.tex"}
    # The request as sent, with the rule and the labels it used.
    assert manifest["request"] == {**body, "short_codes": True}
    assert manifest["assignment_rule"] == "hair"
    assert manifest["alignment"]["method"] == "shared_measures"
    assert [c["bundled_id"] for c in manifest["columns"]] == [f"comfy-paper-{m}-miner" for m in FOUR]
    assert manifest["columns"][0]["analysis_params"]["n_factors"] == 4
    assert manifest["columns"][0]["citation"].startswith("Data of the paper")
    assert manifest["libraries"]["factor_analyzer"]
    assert manifest["measure_labels"] == "short_codes"
    assert comparison["columns"][2]["label"] == "Inductive miner"
    assert "POST the request of manifest.json to /factor-analysis/compare" in readme


def _pdflatex() -> str | None:
    return shutil.which("pdflatex")


def _document(table: str) -> str:
    return "\n".join([
        "\\documentclass{article}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{booktabs}",
        "\\usepackage{array}",
        "\\usepackage{amsmath}",
        "\\begin{document}",
        table,
        "\\end{document}",
        "",
    ])


@pytest.mark.skipif(_pdflatex() is None, reason="no pdflatex; the table is compiled where TeX is installed")
def test_the_latex_tables_compile(client, tmp_path):
    tables = {
        "codes": client.post("/factor-analysis/compare/export", json={**_body(FOUR), "format": "latex"}).text,
        "names": client.post(
            "/factor-analysis/compare/export", json={**_body(FOUR), "format": "latex", "short_codes": False}
        ).text,
    }
    # Log measures as C with the code as index, a label with characters LaTeX treats specially.
    log = {
        "kind": "log",
        "assignment_rule": "largest",
        "alignment": {"dimensions": 2},
        "columns": [{"label": "PDC 2020 & 2021 (k = 2) 100%"}, {"label": "x_y #2"}],
        "unassigned": [[{"measure": "a_b & c%", "reason": "low_loading"}], []],
        "dimensions": [
            {"columns": [{"measures": [{"measure": "n_events"}, {"measure": "trace_len_iqr"}]}, None]},
            {"columns": [{"measures": [{"measure": "activities_iqr"}]}, None]},
        ],
    }
    tables["log"] = compare.dimensions_latex(log, short=True)
    assert "$C_{\\text{mag}}$" in tables["log"]
    for name, table in tables.items():
        (tmp_path / f"{name}.tex").write_text(_document(table), encoding="utf-8")
        done = subprocess.run(
            [_pdflatex(), "-interaction=nonstopmode", "-halt-on-error", f"{name}.tex"],
            cwd=tmp_path, capture_output=True, text=True, timeout=300,
        )
        assert done.returncode == 0, (name, done.stdout[-3000:])
