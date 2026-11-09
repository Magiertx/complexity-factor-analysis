"""The scree plot, the loadings heatmap and the correlation map as figures for a paper, as SVG or PNG.

Drawn in a print style whatever the theme of the UI: white background, dark text, the loadings
shaded in one blue by their absolute value (the sign of a factor is arbitrary, so it stands in the
number only) and the correlations in blue and slate, 8 pt text at the
text width of a CEUR paper (15.9 cm), so a figure set at that width keeps its type size. The SVG
keeps its text as text; the PNG has 300 dpi. Both are drawn by matplotlib, which ComFy uses for
its plots as well, without pyplot, so that a figure of one request never meets another's.

The labels are English or German (``LANGUAGES``), with the decimal comma in German. Log measures
named by their short codes are written as the papers print them, C with the code as index. A
figure is drawn once for what it shows: the next request for the same analysis and look, e.g.
the ZIP after the figure menu or the print view, gets the same bytes (``CACHE_SIZE``).
"""

from __future__ import annotations

import hashlib
import io
import json
import threading
from collections import OrderedDict
from typing import Any

import numpy as np

from .core import _computed_once
from .short_codes import short_code

FORMATS = ("svg", "png")
FIGURES = ("scree", "loadings", "correlations")
LANGUAGES = ("en", "de")
MEDIA_TYPES = {"svg": "image/svg+xml", "png": "image/png"}

#: The text width of a CEUR paper, in inches.
WIDTH_IN = 6.27
FONT_PT = 8
DPI = 300

INK = "#1f2328"
MUTED = "#6b7280"
GRID = "#e5e7eb"
BLUE = "#2563a8"
SLATE = "#475569"
#: The scree plot shows this many eigenvalues at least, as the UI does, or twice the factors.
MIN_SHOWN = 20

#: Figures kept for the next request, the most recently used ones. A figure of 120 measures is
#: some hundred kB as SVG and a few MB as PNG.
CACHE_SIZE = 32
_CACHE: OrderedDict[tuple, bytes] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_IN_FLIGHT: dict[tuple, Any] = {}

# matplotlib's rcParams are global; figures are drawn one at a time.
_LOCK = threading.Lock()

#: The words of the figures. ``{...}`` are filled in; numbers use the decimal mark of the language.
_TEXT = {
    "en": {
        "retained": "Retained factors ({k})",
        "kaiser": "Kaiser criterion (eigenvalue 1)",
        "parallel": "Parallel analysis ({p}th percentile)",
        "eigenvalues": "Eigenvalues",
        "factor": "Factor",
        "eigenvalue": "Eigenvalue",
        "loadings": "Loadings",
        "pattern": "Pattern loadings",
        "caption": "{what}, {rotation}; coloured: |λ| {compare} {threshold}, bold: assigned ({rule})",
        "correlations": "Pearson correlations r; outlined: |r| ≥ {high}; {order}",
        "order_dataset": "measures as in the dataset",
        "order_cluster": "measures clustered (average linkage on 1 − |r|)",
        "order_factor": "measures grouped by dimension",
        "no_dimension": "none",
    },
    "de": {
        "retained": "Behaltene Faktoren ({k})",
        "kaiser": "Kaiser-Kriterium (Eigenwert 1)",
        "parallel": "Parallelanalyse ({p}. Perzentil)",
        "eigenvalues": "Eigenwerte",
        "factor": "Faktor",
        "eigenvalue": "Eigenwert",
        "loadings": "Ladungen",
        "pattern": "Musterladungen",
        "caption": "{what}, {rotation}; farbig: |λ| {compare} {threshold}, fett: zugeordnet ({rule})",
        "correlations": "Pearson-Korrelationen r; umrandet: |r| ≥ {high}; {order}",
        "order_dataset": "Maße wie im Datensatz",
        "order_cluster": "Maße gruppiert (Average Linkage auf 1 − |r|)",
        "order_factor": "Maße nach Dimension",
        "no_dimension": "keine",
    },
}

_STYLE = {
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans", "Arial", "Helvetica"],
    "font.size": FONT_PT,
    "axes.titlesize": FONT_PT,
    "axes.labelsize": FONT_PT,
    "xtick.labelsize": FONT_PT - 0.5,
    "ytick.labelsize": FONT_PT - 0.5,
    "legend.fontsize": FONT_PT - 0.5,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "text.color": INK,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.facecolor": "white",
    # Text stays text in the SVG, and the same analysis gives the same file.
    "svg.fonttype": "none",
    "svg.hashsalt": "complexity-factor-analysis",
}


def _save(fig: Any, fmt: str) -> bytes:
    buffer = io.BytesIO()
    metadata = {"Date": None} if fmt == "svg" else {"Software": None}
    fig.savefig(buffer, format=fmt, dpi=DPI, bbox_inches="tight", pad_inches=0.04, metadata=metadata)
    return buffer.getvalue()


def _decimal(text: str, language: str) -> str:
    """A number as written in the language: with the decimal comma in German."""
    return text.replace(".", ",") if language == "de" else text


def _label(kind: str, measure: str, short: bool) -> str:
    """The text of a measure at its row. A log measure's code is written as the paper writes
    it (C with the code as index, in mathtext); a name or a code of a model measure is plain
    text, with the dollar sign escaped so that a name of an upload cannot start mathtext."""
    code = short_code(kind, measure) if short else None
    if code is None:
        return measure.replace("$", "\\$")
    if kind != "log":
        return code
    return "$C_{\\text{" + code.replace("#", "\\#").replace("%", "\\%") + "}}$"


def _labels(kind: str, measures: list[str], short: bool) -> list[str]:
    return [_label(kind, m, short) for m in measures]


def order_measures(result: dict[str, Any], order: str) -> list[str]:
    """The measures in the order of the UI: grouped by factor, strongest loading first, then the
    unassigned ones ("factor"), or as in the dataset ("dataset")."""
    if order == "dataset":
        return list(result["used_measures"])
    out: list[str] = []
    for factor in result["factors"]:
        for entry in factor["measures"]:
            if entry["measure"] not in out:
                out.append(entry["measure"])
    return out + [m for m in result["used_measures"] if m not in out]


def scree(result: dict[str, Any], fmt: str, language: str = "en") -> bytes:
    """Eigenvalues with the Kaiser line and parallel analysis; the retained factors shaded."""
    from matplotlib import rc_context
    from matplotlib.figure import Figure
    from matplotlib.ticker import FuncFormatter

    text = _TEXT[language]

    values = result["eigenvalues"]
    counts = result.get("factor_count") or {}
    random = counts.get("eigenvalues_random")
    k = result["n_factors"]
    largest = max(k, counts.get("kaiser", 1), counts.get("parallel_analysis", 1))
    n = min(len(values), max(MIN_SHOWN, 2 * largest))
    xs = list(range(1, n + 1))
    with _LOCK, rc_context(_STYLE):
        fig = Figure(figsize=(WIDTH_IN, 2.6))
        ax = fig.add_subplot()
        ax.axvspan(0.5, k + 0.5, color=BLUE, alpha=0.07, linewidth=0, label=text["retained"].format(k=k))
        ax.axhline(1.0, color=MUTED, linestyle=":", linewidth=1, label=text["kaiser"])
        if random:
            ax.plot(
                xs, random[:n], color=MUTED, linestyle="--", linewidth=1,
                label=text["parallel"].format(p=counts.get("percentile", 95)),
            )
        ax.plot(xs, values[:n], color=BLUE, linewidth=1.4, zorder=3, label=text["eigenvalues"])
        ax.scatter(xs[:k], values[:k], s=14, color=BLUE, zorder=4)
        ax.scatter(xs[k:], values[k:n], s=14, facecolor="white", edgecolor=BLUE, linewidth=1, zorder=4)
        ax.set_xlim(0.5, n + 0.5)
        ax.set_ylim(bottom=0)
        step = 1 if n <= 25 else 2 if n <= 50 else 5
        ax.set_xticks([x for x in xs if x == 1 or x % step == 0])
        ax.set_xlabel(text["factor"])
        ax.set_ylabel(text["eigenvalue"])
        ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: _decimal(f"{value:g}", language)))
        ax.grid(axis="y", color=GRID, linewidth=0.6)
        ax.set_axisbelow(True)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        ax.legend(frameon=False, loc="upper right")
        return _save(fig, fmt)


def _cmap() -> Any:
    """Slate for a negative r, white at 0, blue for a positive r."""
    from matplotlib.colors import LinearSegmentedColormap

    return LinearSegmentedColormap.from_list("correlations", [SLATE, "white", BLUE])


def _shade() -> Any:
    """One blue, from white at |loading| 0 to full at 1: the sign of a loading is not coloured."""
    from matplotlib.colors import LinearSegmentedColormap

    return LinearSegmentedColormap.from_list("loadings", ["white", BLUE])


def _factor_label(j: int, names: dict[int, str] | None) -> str:
    """The heading of factor ``j`` (from 0): its name, else "F1"; a dollar sign stays text."""
    name = (names or {}).get(j)
    return name.replace("$", "\\$") if name else f"F{j + 1}"


def loadings(
    result: dict[str, Any],
    kind: str,
    fmt: str,
    *,
    short: bool = False,
    order: str = "factor",
    language: str = "en",
    names: dict[int, str] | None = None,
) -> bytes:
    """The loadings as a heatmap with their values, one row per measure: shaded in one blue by
    the absolute value (the sign is in the number), white for loadings that do not count under
    the threshold, the assigned ones in bold, as in the loadings table; the communality in a column of its own. Factors with
    ``names`` are headed by them, set at a slant so that they keep the width of a cell."""
    from matplotlib import rc_context
    from matplotlib.colors import Normalize
    from matplotlib.figure import Figure

    text = _TEXT[language]
    measures = order_measures(result, order)
    k = result["n_factors"]
    assignment = result.get("assignment") or {"loading_threshold": result["loading_threshold"], "loading_strict": False}
    threshold, strict = assignment["loading_threshold"], assignment["loading_strict"]
    assigned = {(m["measure"], f["index"]) for f in result["factors"] for m in f["measures"]}
    matrix = result["loadings"]
    oblique = result.get("structure_loadings") is not None

    def counts(value: float) -> bool:
        return abs(value) > threshold if strict else abs(value) >= threshold

    cell_w, cell_h = 0.42, 0.17
    height = 0.75 + cell_h * len(measures)
    norm = Normalize(0, 1)
    cmap = _shade()
    with _LOCK, rc_context(_STYLE):
        fig = Figure(figsize=(WIDTH_IN, height))
        width_used = cell_w * (k + 1.4)
        # The cells take their natural width at the left; tight saving cuts the rest.
        ax = fig.add_axes((0.45, 0.5 / height, width_used / WIDTH_IN, (height - 0.75) / height))
        for i, measure in enumerate(measures):
            row = matrix[measure]
            for j, value in enumerate(row):
                shown = counts(value)
                ax.add_patch(_rect(j, i, cmap(norm(abs(value))) if shown else "white"))
                strong = shown and abs(value) > 0.62
                ax.text(
                    j + 0.5, i + 0.5, _decimal(f"{value:.2f}".replace("-", "−"), language), ha="center", va="center",
                    fontsize=FONT_PT - 1,
                    color="white" if strong else INK if shown else "#9ca3af",
                    fontweight="bold" if (measure, j) in assigned else "normal",
                )
            h2 = result["communalities"][measure]
            ax.add_patch(_rect(k + 0.25, i, "#f3f4f6", width=1.0))
            ax.text(k + 0.75, i + 0.5, _decimal(f"{h2:.2f}", language), ha="center", va="center", fontsize=FONT_PT - 1, color=INK)
        ax.set_xlim(0, k + 1.25)
        ax.set_ylim(len(measures), 0)
        ax.set_xticks([j + 0.5 for j in range(k)] + [k + 0.75])
        named = any((names or {}).get(j) for j in range(k))
        ax.set_xticklabels([_factor_label(j, names) for j in range(k)] + ["h²"])
        ax.xaxis.tick_top()
        if named:
            for tick in ax.get_xticklabels():
                tick.set_rotation(40)
                tick.set_horizontalalignment("left")
                tick.set_rotation_mode("anchor")
        ax.set_yticks([i + 0.5 for i in range(len(measures))])
        ax.set_yticklabels(_labels(kind, measures, short))
        ax.tick_params(length=0, pad=3, colors=INK)
        for spine in ax.spines.values():
            spine.set_visible(False)
        compare = ">" if strict else "≥"
        ax.set_xlabel(
            text["caption"].format(
                what=text["pattern" if oblique else "loadings"], rotation=result["rotation"], compare=compare,
                threshold=_decimal(f"{threshold:g}", language), rule=result.get("assignment_rule", "largest"),
            ),
            color=MUTED, fontsize=FONT_PT - 1, labelpad=4,
        )
        return _save(fig, fmt)


def _truncated(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def correlation_map(
    corr: dict[str, Any],
    kind: str,
    fmt: str,
    *,
    short: bool = False,
    language: str = "en",
    names: dict[int, str] | None = None,
) -> bytes:
    """The correlation map of ``correlations.build``: one cell per pair of measures, blue for a
    positive and slate for a negative r, the pairs with |r| of ``correlations.HIGH`` or more
    outlined. Under the order "factor" a line separates the dimensions, each named at the right
    (its name, else F1, F2, ...). The cells are as many as the measures: up to 17 measures have
    their r written in them, more are read from the colour and the labels, which are as small as
    they must be to keep every measure named; the SVG keeps them as text."""
    from matplotlib import rc_context
    from matplotlib.colors import Normalize
    from matplotlib.figure import Figure
    from matplotlib.patches import Rectangle

    from .correlations import HIGH

    text = _TEXT[language]
    measures = corr["measures"]
    n = len(measures)
    r = np.asarray(corr["r"], dtype=float)
    groups = corr.get("groups")
    cell = min(0.30, 4.6 / max(n, 1))
    side = cell * n
    fontsize = min(FONT_PT - 0.5, max(2.5, cell * 72 * 0.9))
    labels = _labels(kind, measures, short)
    # The longest label at its font size decides the margin it needs; an estimate, not a measurement.
    reach = max((len(m) for m in measures), default=1) * fontsize * 0.55 / 72 + 0.1
    left = min(2.0, max(0.5, reach))
    top = min(1.8, max(0.5, reach)) + 0.05
    right = 0.9 if groups else 0.15
    side = min(side, WIDTH_IN - left - right)
    cell = side / max(n, 1)
    bottom = 0.8
    width, height = left + side + right, top + side + bottom
    norm = Normalize(-1, 1)
    order = text[f"order_{corr['order']}"]
    with _LOCK, rc_context(_STYLE):
        fig = Figure(figsize=(width, height))
        ax = fig.add_axes((left / width, bottom / height, side / width, side / height))
        mesh = ax.pcolormesh(
            np.arange(n + 1), np.arange(n + 1), r, cmap=_cmap(), norm=norm,
            edgecolors="white", linewidth=0.15, rasterized=False,
        )
        ax.set_xlim(0, n)
        ax.set_ylim(n, 0)
        ax.set_aspect("auto")
        ticks = [i + 0.5 for i in range(n)]
        ax.set_xticks(ticks)
        ax.set_yticks(ticks)
        ax.set_xticklabels(labels, rotation=90, fontsize=fontsize)
        ax.set_yticklabels(labels, fontsize=fontsize)
        ax.xaxis.tick_top()
        ax.tick_params(length=0, pad=1.5, colors=INK)
        for spine in ax.spines.values():
            spine.set_visible(False)
        if cell * 72 >= 19:
            for i in range(n):
                for j in range(n):
                    value = r[i, j]
                    ax.text(
                        j + 0.5, i + 0.5, _decimal(f"{value:.2f}".replace("-", "−"), language),
                        ha="center", va="center", fontsize=FONT_PT - 2,
                        color="white" if abs(value) > 0.62 else INK,
                    )
        outline = 0.7 if n <= 40 else 0.4
        for i in range(n):
            for j in range(i + 1, n):
                if abs(r[i, j]) >= HIGH:
                    for y, x in ((i, j), (j, i)):
                        ax.add_patch(Rectangle((x, y), 1, 1, fill=False, edgecolor=INK, linewidth=outline))
        if groups:
            edge = 0
            for group in groups:
                size = len(group["measures"])
                if edge:
                    ax.axhline(edge, color=INK, linewidth=0.5)
                    ax.axvline(edge, color=INK, linewidth=0.5)
                factor = group["factor"]
                label = text["no_dimension"] if factor is None else _factor_label(factor, names)
                ax.text(
                    n + 0.4, edge + size / 2, _truncated(label, 16), ha="left", va="center",
                    fontsize=FONT_PT - 1, color=MUTED if factor is None else INK,
                )
                edge += size
        colorbar_axes = fig.add_axes((left / width, 0.5 / height, min(1.4, side) / width, 0.07 / height))
        bar = fig.colorbar(mesh, cax=colorbar_axes, orientation="horizontal", ticks=[-1, 0, 1])
        bar.ax.set_xticklabels(["−1", "0", "1"], fontsize=FONT_PT - 1)
        bar.ax.tick_params(length=2, pad=1, colors=MUTED)
        bar.outline.set_visible(False)
        fig.text(
            left / width, 0.05 / height,
            text["correlations"].format(high=_decimal(f"{HIGH:g}", language), order=order),
            ha="left", va="bottom", fontsize=FONT_PT - 1, color=MUTED,
        )
        return _save(fig, fmt)


def _rect(x: float, y: int, color: Any, width: float = 1.0) -> Any:
    from matplotlib.patches import Rectangle

    return Rectangle((x, y), width, 1, facecolor=color, edgecolor="white", linewidth=0.8)


#: What a figure is drawn from, besides the options: the parts of the analysis it shows.
_SCREE_PARTS = ("n_factors", "eigenvalues", "factor_count")
_LOADINGS_PARTS = (
    "n_factors", "used_measures", "factors", "loadings", "communalities", "rotation", "assignment",
    "assignment_rule", "loading_threshold",
)


def _fingerprint(result: dict[str, Any], parts: tuple[str, ...]) -> str:
    shown = {part: result.get(part) for part in parts}
    shown["oblique"] = result.get("structure_loadings") is not None
    return hashlib.sha1(json.dumps(shown, sort_keys=True, default=repr).encode()).hexdigest()


def _correlation_fingerprint(corr: dict[str, Any]) -> str:
    shown = {part: corr.get(part) for part in ("order", "measures", "r", "groups")}
    return hashlib.sha1(json.dumps(shown, sort_keys=True, default=repr).encode()).hexdigest()


def figure(
    name: str, fmt: str, result: dict[str, Any], kind: str, *,
    short: bool = False, order: str = "factor", language: str = "en", names: dict[int, str] | None = None,
    correlations: dict[str, Any] | None = None,
) -> bytes:
    """One of ``FIGURES`` in one of ``FORMATS``, with the labels in one of ``LANGUAGES``; the
    loadings and the correlation map with the ``names`` of the factors where given. The
    correlation map is drawn from ``correlations``, the map ``correlations.build`` made. The same
    analysis with the same options gives the same bytes, drawn once."""
    if name == "scree":
        key = (name, fmt, language, _fingerprint(result, _SCREE_PARTS))
        return _computed_once(
            key, _CACHE, _CACHE_LOCK, _IN_FLIGHT, CACHE_SIZE, lambda _: scree(result, fmt, language), None
        )
    titled = tuple(sorted((names or {}).items()))
    if name == "correlations":
        if correlations is None:
            raise ValueError("The correlation map is drawn from its correlations.")
        key = (name, fmt, language, kind, short, titled, _correlation_fingerprint(correlations))
        return _computed_once(
            key, _CACHE, _CACHE_LOCK, _IN_FLIGHT, CACHE_SIZE,
            lambda _: correlation_map(correlations, kind, fmt, short=short, language=language, names=names), None,
        )
    key = (name, fmt, language, kind, short, order, titled, _fingerprint(result, _LOADINGS_PARTS))
    return _computed_once(
        key, _CACHE, _CACHE_LOCK, _IN_FLIGHT, CACHE_SIZE,
        lambda _: loadings(result, kind, fmt, short=short, order=order, language=language, names=names), None,
    )
