"""The figures in print style (factor_analysis/figures.py)."""

from __future__ import annotations

import struct
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
