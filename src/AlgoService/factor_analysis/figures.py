"""The scree plot and the loadings heatmap as figures for a paper, as SVG or PNG.

Drawn in a print style whatever the theme of the UI: white background, dark text, blue for
positive and orange for negative loadings (safe for colour-blind readers), 8 pt text at the
text width of a CEUR paper (15.9 cm), so a figure set at that width keeps its type size. The SVG
keeps its text as text; the PNG has 300 dpi. Both are drawn by matplotlib, which ComFy uses for
its plots as well, without pyplot, so that a figure of one request never meets another's.
"""

from __future__ import annotations

import io
import threading
from typing import Any

from .short_codes import short_code

FORMATS = ("svg", "png")
FIGURES = ("scree", "loadings")
MEDIA_TYPES = {"svg": "image/svg+xml", "png": "image/png"}

#: The text width of a CEUR paper, in inches.
WIDTH_IN = 6.27
FONT_PT = 8
DPI = 300

INK = "#1f2328"
MUTED = "#6b7280"
GRID = "#e5e7eb"
BLUE = "#2563a8"
ORANGE = "#d4691b"
#: The scree plot shows this many eigenvalues at least, as the UI does, or twice the factors.
MIN_SHOWN = 20

# matplotlib's rcParams are global; figures are drawn one at a time.
_LOCK = threading.Lock()

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


def _labels(kind: str, measures: list[str], short: bool) -> list[str]:
    return [(short and short_code(kind, m)) or m for m in measures]


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


def scree(result: dict[str, Any], fmt: str) -> bytes:
    """Eigenvalues with the Kaiser line and parallel analysis; the retained factors shaded."""
    from matplotlib import rc_context
    from matplotlib.figure import Figure

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
        ax.axvspan(0.5, k + 0.5, color=BLUE, alpha=0.07, linewidth=0, label=f"Retained factors ({k})")
        ax.axhline(1.0, color=MUTED, linestyle=":", linewidth=1, label="Kaiser criterion (eigenvalue 1)")
        if random:
            ax.plot(
                xs, random[:n], color=MUTED, linestyle="--", linewidth=1,
                label=f"Parallel analysis ({counts.get('percentile', 95)}th percentile)",
            )
        ax.plot(xs, values[:n], color=BLUE, linewidth=1.4, zorder=3, label="Eigenvalues")
        ax.scatter(xs[:k], values[:k], s=14, color=BLUE, zorder=4)
        ax.scatter(xs[k:], values[k:n], s=14, facecolor="white", edgecolor=BLUE, linewidth=1, zorder=4)
        ax.set_xlim(0.5, n + 0.5)
        ax.set_ylim(bottom=0)
        step = 1 if n <= 25 else 2 if n <= 50 else 5
        ax.set_xticks([x for x in xs if x == 1 or x % step == 0])
        ax.set_xlabel("Factor")
        ax.set_ylabel("Eigenvalue")
        ax.grid(axis="y", color=GRID, linewidth=0.6)
        ax.set_axisbelow(True)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        ax.legend(frameon=False, loc="upper right")
        return _save(fig, fmt)


def _cmap() -> Any:
    from matplotlib.colors import LinearSegmentedColormap

    return LinearSegmentedColormap.from_list("loadings", [ORANGE, "white", BLUE])


def loadings(result: dict[str, Any], kind: str, fmt: str, *, short: bool = False, order: str = "factor") -> bytes:
    """The loadings as a heatmap with their values, one row per measure: blue positive, orange
    negative, white for loadings that do not count under the threshold, the assigned ones in
    bold, as in the loadings table; the communality in a column of its own."""
    from matplotlib import rc_context
    from matplotlib.colors import Normalize
    from matplotlib.figure import Figure

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
    norm = Normalize(-1, 1)
    cmap = _cmap()
    with _LOCK, rc_context(_STYLE):
        fig = Figure(figsize=(WIDTH_IN, height))
        width_used = cell_w * (k + 1.4)
        # The cells take their natural width at the left; tight saving cuts the rest.
        ax = fig.add_axes((0.45, 0.5 / height, width_used / WIDTH_IN, (height - 0.75) / height))
        for i, measure in enumerate(measures):
            row = matrix[measure]
            for j, value in enumerate(row):
                shown = counts(value)
                ax.add_patch(_rect(j, i, cmap(norm(value)) if shown else "white"))
                strong = shown and abs(value) > 0.62
                ax.text(
                    j + 0.5, i + 0.5, f"{value:.2f}".replace("-", "−"), ha="center", va="center",
                    fontsize=FONT_PT - 1,
                    color="white" if strong else INK if shown else "#9ca3af",
                    fontweight="bold" if (measure, j) in assigned else "normal",
                )
            h2 = result["communalities"][measure]
            ax.add_patch(_rect(k + 0.25, i, "#f3f4f6", width=1.0))
            ax.text(k + 0.75, i + 0.5, f"{h2:.2f}", ha="center", va="center", fontsize=FONT_PT - 1, color=INK)
        ax.set_xlim(0, k + 1.25)
        ax.set_ylim(len(measures), 0)
        ax.set_xticks([j + 0.5 for j in range(k)] + [k + 0.75])
        ax.set_xticklabels([f"F{j + 1}" for j in range(k)] + ["h²"])
        ax.xaxis.tick_top()
        ax.set_yticks([i + 0.5 for i in range(len(measures))])
        ax.set_yticklabels(_labels(kind, measures, short))
        ax.tick_params(length=0, pad=3, colors=INK)
        for spine in ax.spines.values():
            spine.set_visible(False)
        compare = ">" if strict else "≥"
        ax.set_xlabel(
            f"{'Pattern loadings' if oblique else 'Loadings'}, {result['rotation']}; coloured: |λ| {compare} "
            f"{threshold:g}, bold: assigned ({result.get('assignment_rule', 'largest')})",
            color=MUTED, fontsize=FONT_PT - 1, labelpad=4,
        )
        return _save(fig, fmt)


def _rect(x: float, y: int, color: Any, width: float = 1.0) -> Any:
    from matplotlib.patches import Rectangle

    return Rectangle((x, y), width, 1, facecolor=color, edgecolor="white", linewidth=0.8)


def figure(name: str, fmt: str, result: dict[str, Any], kind: str, *, short: bool = False, order: str = "factor") -> bytes:
    """One of ``FIGURES`` in one of ``FORMATS``."""
    if name == "scree":
        return scree(result, fmt)
    return loadings(result, kind, fmt, short=short, order=order)
