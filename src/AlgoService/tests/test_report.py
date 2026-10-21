"""The LaTeX report (factor_analysis/report.py).

Under the paper settings, the report of a bundled dataset of Important Factors prints the
numbers of ComFy's report (``report-*-miner.tex``) to the decimals that report prints them
with: four for the analysis, six for the descriptive statistics, Bartlett's chi-square and the
overall MSA rounded to four of their full digits. A snapshot keeps the whole text of one
report, and the reports compile with pdflatex where TeX is installed.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, storage
from factor_analysis.descriptives import STATISTICS, describe
from factor_analysis.published import published
from factor_analysis.report import report_tex
from tests.test_factor_analysis_api import _post

MODEL_DATASETS = [d["id"] for d in cat.manifest()["datasets"] if d["kind"] == "model"]
SNAPSHOT = Path(__file__).parent / "snapshots" / "report-inductive-miner.tex"

_NUMBER = r"-?\d+(?:\.\d+)?"


def _report(client, dataset_id: str, **extra) -> str:
    created = _post(client, kind="model", source="bundled", bundled_id=dataset_id).json()["dataset_id"]
    body = {**cat.bundled_entry(dataset_id)["published_options"], **extra}
    r = client.post(f"/factor-analysis/datasets/{created}/export/report", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/x-latex")
    assert r.headers["content-disposition"].endswith('-report.tex"')
    return r.text


def _report_of_the_log_dataset(client, **extra) -> str:
    """The report of the 123 measures of the bundled log dataset: long tables, many eigenvalues."""
    created = _post(client, kind="log", source="bundled", bundled_id="comfy-log-pdc-training-logs").json()["dataset_id"]
    r = client.post(f"/factor-analysis/datasets/{created}/export/report", json=extra)
    assert r.status_code == 200, r.text
    return r.text


def _items_after(lines: list[str], text: str) -> list[str]:
    start = next(i for i, line in enumerate(lines) if text in line)
    begin = next(i for i in range(start, len(lines)) if lines[i].startswith("\\begin{compactitem}"))
    end = next(i for i in range(begin, len(lines)) if lines[i].startswith("\\end{compactitem}"))
    return [line[len("\\item "):] for line in lines[begin + 1:end]]


def _rows_after(lines: list[str], header: str) -> list[list[str]]:
    """The cells of the rows of the table whose header starts with ``header``, up to its end."""
    start = next(i for i, line in enumerate(lines) if line.startswith(header))
    rows = []
    for line in lines[start + 2:]:
        if line.startswith(("\\bottomrule", "\\midrule", "\\end{")):
            break
        rows.append([c.strip() for c in line.removesuffix("\\\\").split("&")])
    return rows


def _value(cell: str) -> float:
    return float(re.findall(_NUMBER, cell)[-1])


@pytest.mark.parametrize("dataset_id", MODEL_DATASETS)
def test_the_report_prints_the_published_numbers(client, dataset_id):
    numbers = published(dataset_id)
    lines = _report(client, dataset_id).splitlines()
    text = "\n".join(lines)

    assert f"The sample size in this analysis was ${numbers['n_observations']}$." in text
    chi_square, p = re.search(r"\$\\chi\^2\$ value of \$(" + _NUMBER + r")\$.*?\$p\$-value of \$(" + _NUMBER + r")\$", text).groups()
    assert float(chi_square) == round(numbers["bartlett"]["chi_square"], 4)
    assert float(p) == numbers["bartlett"]["p_value"]

    msa = dict(item.rsplit(": ", 1) for item in _items_after(lines, "The measure of sampling adequacy"))
    assert _value(msa.pop("overall MSA")) == round(numbers["kmo"]["overall"], 4)
    assert {m: _value(v) for m, v in msa.items()} == numbers["kmo"]["per_measure"]

    removed = numbers["msa_filter"]["removed"]
    if removed:
        items = _items_after(lines, "were too low")
        ours = {}
        for item in items:
            name, rest = item.rsplit(": ", 1)
            value, round_ = re.match(r"\$(" + _NUMBER + r")\$ \(round (\d+)\)", rest).groups()
            ours[name] = (float(value), int(round_))
        assert ours == {r["measure"]: (r["msa"], r["round"]) for r in removed}

    shares = [_value(row[2]) for row in _rows_after(lines, "Factor & Eigenvalue & Share of variance")]
    assert shares == numbers["explained_variance_ratio"][: len(shares)]

    descriptives = {row[0]: row[1:] for row in _rows_after(lines, " & Mean & Median & Std & Min & Max")}
    assert list(descriptives) == list(numbers["descriptives"])
    for measure, printed in numbers["descriptives"].items():
        assert descriptives[measure] == [f"{printed[s]:.6f}" for s in STATISTICS], measure

    k = numbers["reproduce_with"]["n_factors"]
    loadings = {row[0]: [_value(c) for c in row[1:]] for row in _rows_after(lines, " & Factor 1")}
    assert set(loadings) == set(numbers["loadings"])
    for measure, printed in numbers["loadings"].items():
        # Heuristics: the report has a fourth column of zeros the tool does not fit.
        assert loadings[measure][:k] == printed[:k], measure
        assert loadings[measure][k] == numbers["communalities"][measure], measure


def test_the_report_marks_the_assigned_loadings_and_greys_those_that_do_not_count(client):
    lines = _report(client, "comfy-paper-inductive-miner").splitlines()
    rows = {row[0]: row[1:] for row in _rows_after(lines, " & Factor 1")}
    # Tab. 12 of Important Factors: under "multi", acd belongs to factors 1, 2 and 3.
    assert [c.startswith("$\\mathbf") for c in rows["Average connector degree"][:4]] == [True, True, True, False]
    assert rows["Average connector degree"][3] == "$0.4128$"
    assert rows["Size"][1] == "\\textcolor{lightgray}{$-0.1515$}"
    text = "\n".join(lines)
    assert "\\section*{Dimensions}" in text and "Connector Mismatch: low communality" in text
    assert "Separability ($0.63$)" in text


def test_short_codes_name_the_measures_and_the_list_says_what_they_stand_for(client):
    text = _report(client, "comfy-paper-inductive-miner", short_codes=True)
    assert "\\item CNC (Coefficient of network connectivity)" in text
    assert "\nCNC & " in text and "\nCoefficient of network connectivity & " not in text
    assert "Measure names & short codes of the papers" in text


def test_the_report_of_log_measures_writes_the_codes_as_the_paper_does():
    from factor_analysis.report import _Labels, tex

    label = _Labels("log", short=True)
    assert label("n_events") == "$C_{\\text{mag}}$"
    assert label("n_variants") == "$C_{\\text{DT-\\#}}$"
    assert _Labels("log", short=False)("n_events") == "n\\_\\allowbreak{}events"
    assert tex("a & b\n%c") == "a \\& b \\%c"
    assert tex("中") == "?"


def test_straight_quotes_become_quotation_marks():
    from factor_analysis.report import tex

    assert tex('the paper "Important Factors" (ATAED)') == "the paper ``Important Factors'' (ATAED)"
    assert tex('"x"') == "``x''" and tex('("y")') == "(``y'')"


def test_the_report_starts_with_the_hint_to_compile_it_twice_and_names_the_software_in_full():
    from factor_analysis.report import COMPILE_HINT

    text = SNAPSHOT.read_text(encoding="utf-8")
    assert text.splitlines()[0] == f"% {COMPILE_HINT}" and "twice" in COMPILE_HINT
    assert "Software & Complexity Factor Analysis (version v0.0.0, commit 000000000000);" in text


def test_the_scree_plot_of_many_eigenvalues_labels_every_fifth_factor(client):
    text = _report_of_the_log_dataset(client)
    assert "xtick={1,5,10,...," in text and "xtick=data" not in text
    assert "xtick=data" in SNAPSHOT.read_text(encoding="utf-8")


def test_headings_stay_with_their_tables():
    text = SNAPSHOT.read_text(encoding="utf-8")
    assert "\\usepackage{needspace}" in text
    for heading in ("Dimensions", "Settings and Provenance"):
        assert f"\\needspace{{12\\baselineskip}}\n\\section*{{{heading}}}" in text


def _paper_analysis() -> tuple[dict, dict, dict, dict]:
    entry = cat.bundled_entry("comfy-paper-inductive-miner")
    raw = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)
    cleaned = core.clean_matrix(raw)
    params = dict(entry["published_options"])
    result = core.analyze(storage.as_stored(cleaned.data), core.AnalysisParams(**params))
    dataset = {
        "name": entry["name"], "kind": "model", "source": "bundled", "bundled_id": entry["id"],
        "citation": entry["citation"], "inputs": {"files": 0}, "measures": list(cleaned.data.columns),
        "dropped": [{"name": d["measure"], "reason": d["reason"]} for d in cleaned.dropped],
        "provenance": {
            "kind": "model", "source": "bundled",
            "bundled": {"id": entry["id"], "file": "datasets/x.csv",
                        "copied_from": {"repository": entry["source_url"], "commit": entry["source_commit"]}},
        },
    }
    return dataset, params, result, describe(raw)


def _snapshot_report() -> str:
    dataset, params, result, descriptives = _paper_analysis()
    return report_tex(
        dataset=dataset, params=params, result=result, descriptives=descriptives,
        tool={"version": "v0.0.0", "commit": "0" * 40}, libraries={"factor_analyzer": "0.5.1"},
        created_at="2026-10-21T00:00:00+00:00",
    )


def test_the_report_text_is_as_kept():
    """The whole text of one report, so that a change of the wording or the layout is a
    decision; regenerate the snapshot by writing _snapshot_report() to it."""
    assert _snapshot_report() == SNAPSHOT.read_text(encoding="utf-8")


def _pdflatex() -> str | None:
    return shutil.which("pdflatex")


@pytest.mark.skipif(_pdflatex() is None, reason="no pdflatex; the report is compiled where TeX is installed")
def test_the_reports_compile(client, tmp_path):
    reports = {"inductive": _snapshot_report()}
    reports["inductive-short"] = _report(client, "comfy-paper-inductive-miner", short_codes=True)
    # Names of an upload with every character LaTeX treats specially, and a long table.
    rows = 40
    # Two latent factors, so that the measures correlate in pairs.
    columns = {
        "a_b & c%": [i + (i % 3) for i in range(rows)],
        "x^2 {y} $z ~#": [2 * i + (i % 5) for i in range(rows)],
        "back\\slash ü 中": [(i * 7) % 13 + (i % 2) for i in range(rows)],
        "plain": [1.5 * ((i * 7) % 13) + (i % 4) * 0.3 for i in range(rows)],
        "constant": [1.0] * rows,
    }
    csv = "observation," + ",".join(f'"{c}"' for c in columns) + "\n" + "\n".join(
        f"r{i}," + ",".join(str(v[i]) for v in columns.values()) for i in range(rows)
    )
    dataset_id = _post(client, kind="model", source="csv", files=[("files", ("own.csv", csv.encode(), "text/csv"))]).json()["dataset_id"]
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/export/report", json={"n_factors": 2, "rotation": "oblimin", "auto_msa_filter": False})
    assert r.status_code == 200, r.text
    assert "\\section*{Factor Correlations}" in r.text
    reports["upload"] = r.text
    for name, text in reports.items():
        _compile(tmp_path, name, text)
        assert (tmp_path / f"{name}.pdf").stat().st_size > 10_000


def _compile(directory: Path, name: str, text: str) -> str:
    """Run pdflatex on a report once; the text of its log."""
    (directory / f"{name}.tex").write_text(text, encoding="utf-8")
    done = subprocess.run(
        [_pdflatex(), "-interaction=nonstopmode", "-halt-on-error", f"{name}.tex"],
        cwd=directory, capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, (name, done.stdout[-3000:])
    return (directory / f"{name}.log").read_text(encoding="utf-8", errors="replace")


@pytest.mark.skipif(_pdflatex() is None, reason="no pdflatex; the report is compiled where TeX is installed")
def test_a_report_with_long_tables_is_settled_by_the_second_run(client, tmp_path):
    """The hint in the first line of the report says to compile twice: the tables of 123
    measures (longtable) then keep their widths and nothing asks for another run."""
    text = _report_of_the_log_dataset(client, short_codes=True)
    assert "\\begin{longtable}" in text
    _compile(tmp_path, "log", text)
    second = _compile(tmp_path, "log", text)
    assert "Rerun LaTeX" not in second and "Table widths have changed" not in second
