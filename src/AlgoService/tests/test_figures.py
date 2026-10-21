"""The figures in print style (factor_analysis/figures.py)."""

from __future__ import annotations

import struct
import time
import xml.etree.ElementTree as ET

import pandas as pd
import pytest

from factor_analysis import catalog as cat
from factor_analysis import core, figures, storage


@pytest.fixture(scope="module")
def paper_result() -> dict:
    entry = cat.bundled_entry("comfy-paper-inductive-miner")
    data = storage.as_stored(core.clean_matrix(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)).data)
    return core.analyze(data, core.AnalysisParams(**entry["published_options"]))


def _svg_texts(svg: bytes) -> list[str]:
    root = ET.fromstring(svg)
    return ["".join(t.itertext()) for t in root.iter("{http://www.w3.org/2000/svg}text")]


def test_the_scree_figure_is_svg_with_text(paper_result):
    svg = figures.figure("scree", "svg", paper_result, "model")
    texts = _svg_texts(svg)
    assert "Eigenvalue" in texts and "Factor" in texts
    assert any("Parallel analysis" in t for t in texts)
    assert "Retained factors (4)" in texts
    # The same analysis gives the same file.
    assert figures.figure("scree", "svg", paper_result, "model") == svg


def test_the_loadings_figure_names_the_measures_or_their_codes(paper_result):
    texts = _svg_texts(figures.figure("loadings", "svg", paper_result, "model"))
    assert "Coefficient of network connectivity" in texts and "F4" in texts and "0.97" in texts
    short = _svg_texts(figures.figure("loadings", "svg", paper_result, "model", short=True))
    assert "CNC" in short and "Coefficient of network connectivity" not in short
    # Grouped by factor as the UI shows them, or in the order of the dataset.
    order = figures.order_measures(paper_result, "factor")
    assert order[0] == "Number of duplicate tasks" and figures.order_measures(paper_result, "dataset")[0] == "Size"


def test_the_png_has_300_dpi(paper_result):
    png = figures.figure("loadings", "png", paper_result, "model")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    at = png.index(b"pHYs")
    per_metre = struct.unpack(">I", png[at + 4:at + 8])[0]
    assert round(per_metre * 0.0254) == 300


def _compact(svg: bytes) -> list[str]:
    """The texts of an SVG without the whitespace between the glyphs of a mathtext label."""
    return ["".join(t.split()) for t in _svg_texts(svg)]


def _as_log(result: dict) -> dict:
    """The paper's analysis with log measures in place of its model measures, to draw log figures."""
    names = dict(zip(result["used_measures"], ["n_events", "n_variants", "trace_len_q1", "n_traces", "trace_len_mean",
                                               "ratio_variants_per_number_of_traces", "x_unknown", "a$b$c", "trace_len_std", "n_events_2"]))
    renamed = {**result, "used_measures": [names[m] for m in result["used_measures"]]}
    renamed["loadings"] = {names[m]: v for m, v in result["loadings"].items()}
    renamed["communalities"] = {names[m]: v for m, v in result["communalities"].items()}
    renamed["factors"] = [
        {**f, "measures": [{**m, "measure": names[m["measure"]]} for m in f["measures"]]} for f in result["factors"]
    ]
    return renamed


def test_log_measures_are_written_as_the_paper_writes_them(paper_result):
    log = _as_log(paper_result)
    # C with the code as index: "C" and then the code, each glyph a text of its own in the SVG.
    short = _compact(figures.figure("loadings", "svg", log, "log", short=True))
    assert {"Cmag", "CDT-#", "CTL-Q1", "CDT-%"} <= set(short)
    # A measure without a code, and the dollar signs of a name, stay as they are.
    assert "x_unknown" in short and "a$b$c" in short
    plain = _compact(figures.figure("loadings", "svg", log, "log", short=False))
    assert "n_events" in plain and not any(t.startswith("C") and "mag" in t for t in plain)


def test_the_labels_are_english_or_german(paper_result):
    english = _svg_texts(figures.figure("scree", "svg", paper_result, "model"))
    german = _svg_texts(figures.figure("scree", "svg", paper_result, "model", language="de"))
    assert "Eigenvalue" in english and "Factor" in english
    assert {"Eigenwert", "Faktor", "Behaltene Faktoren (4)", "Kaiser-Kriterium (Eigenwert 1)"} <= set(german)
    assert any(t.startswith("Parallelanalyse (") and "95. Perzentil" in t for t in german)
    assert any(t.startswith("Eigenwerte") for t in german)

    loadings = _svg_texts(figures.figure("loadings", "svg", paper_result, "model", language="de"))
    # The decimal comma of the UI in the cells and the caption; the English figure keeps the point.
    assert "0,97" in loadings and "0.97" not in loadings
    assert "Ladungen, varimax; farbig: |λ| > 0,35, fett: zugeordnet (multi)" in loadings
    english_loadings = _svg_texts(figures.figure("loadings", "svg", paper_result, "model"))
    assert "Loadings, varimax; coloured: |λ| > 0.35, bold: assigned (multi)" in english_loadings


def test_the_same_figure_is_drawn_once(paper_result):
    figures._CACHE.clear()
    started = time.perf_counter()
    first = figures.figure("loadings", "svg", paper_result, "model", short=True, order="dataset")
    drawn = time.perf_counter() - started
    started = time.perf_counter()
    second = figures.figure("loadings", "svg", paper_result, "model", short=True, order="dataset")
    again = time.perf_counter() - started
    assert second is first and again < drawn / 4 and again < 0.05
    # Another look is another figure; a scree plot has no short codes and no order.
    assert figures.figure("loadings", "svg", paper_result, "model", short=True, order="factor") != first
    assert figures.figure("loadings", "svg", paper_result, "model", short=True, order="dataset", language="de") != first
    scree = figures.figure("scree", "svg", paper_result, "model")
    assert figures.figure("scree", "svg", paper_result, "model", short=True, order="dataset") is scree
    # Another analysis is another figure, even with the same options.
    changed = {**paper_result, "loadings": {m: [v + 0.01 for v in row] for m, row in paper_result["loadings"].items()}}
    assert figures.figure("loadings", "svg", changed, "model", short=True, order="dataset") != first


def test_the_cache_keeps_the_latest_figures(paper_result):
    figures._CACHE.clear()
    for k in range(figures.CACHE_SIZE + 3):
        figures.figure("scree", "svg", {**paper_result, "n_factors": 1 + k % 4, "eigenvalues": [v + k for v in paper_result["eigenvalues"]]}, "model")
    assert len(figures._CACHE) == figures.CACHE_SIZE
