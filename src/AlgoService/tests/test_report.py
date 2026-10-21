"""The LaTeX report (factor_analysis/report.py).

Under the paper settings, the report of a bundled dataset of Important Factors prints the
numbers of ComFy's report (``report-*-miner.tex``) to the decimals that report prints them
with: four for the analysis, six for the descriptive statistics, Bartlett's chi-square and the
overall MSA rounded to four of their full digits. A snapshot keeps the whole text of one
report, and the reports compile with pdflatex where TeX is installed.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, storage
from factor_analysis.descriptives import describe
from factor_analysis.report import report_tex

SNAPSHOT = Path(__file__).parent / "snapshots" / "report-inductive-miner.tex"



def test_the_report_of_log_measures_writes_the_codes_as_the_paper_does():
    from factor_analysis.report import _Labels, tex

    label = _Labels("log", short=True)
    assert label("n_events") == "$C_{\\text{mag}}$"
    assert label("n_variants") == "$C_{\\text{DT-\\#}}$"
    assert _Labels("log", short=False)("n_events") == "n\\_\\allowbreak{}events"
    assert tex("a & b\n%c") == "a \\& b \\%c"
    assert tex("中") == "?"


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
def test_the_report_compiles(tmp_path):
    (tmp_path / "report.tex").write_text(_snapshot_report(), encoding="utf-8")
    done = subprocess.run(
        [_pdflatex(), "-interaction=nonstopmode", "-halt-on-error", "report.tex"],
        cwd=tmp_path, capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, done.stdout[-3000:]
