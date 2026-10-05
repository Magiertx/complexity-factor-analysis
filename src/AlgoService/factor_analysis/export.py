"""Loadings table as CSV or LaTeX."""

from __future__ import annotations

from typing import Any

import pandas as pd

from vendored.comfy_log import Constants as _C
from zip_export import csv_cell

_LATEX_SPECIAL = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def latex_escape(text: str) -> str:
    return "".join(_LATEX_SPECIAL.get(ch, ch) for ch in text)


def _factor_names(result: dict[str, Any]) -> list[str]:
    return [f"Factor {i + 1}" for i in range(result["n_factors"])]


def _csv_line(cells: list[Any]) -> str:
    return ",".join(csv_cell(c) for c in cells) + "\n"


def loadings_csv(result: dict[str, Any]) -> str:
    """One row per measure: the loading on each factor, then the communality."""
    lines = [_csv_line(["measure", *_factor_names(result), "communality"])]
    for measure, row in result["loadings"].items():
        lines.append(_csv_line([measure, *row, result["communalities"][measure]]))
    return "".join(lines)


def matrix_csv(data: pd.DataFrame) -> str:
    """A dataset matrix, observations as rows."""
    lines = [_csv_line(["observation", *data.columns])]
    for label, row in zip(data.index, data.to_numpy()):
        lines.append(_csv_line([label, *(repr(float(v)) for v in row)]))
    return "".join(lines)


def loadings_latex(result: dict[str, Any], threshold: float) -> str:
    """A booktabs ``tabular``; loadings whose absolute value reaches the threshold are bold."""
    decimals = _C.number_of_decimals
    names = _factor_names(result)

    def cell(value: float, bold: bool = False) -> str:
        number = f"{value:.{decimals}f}"
        return f"$\\mathbf{{{number}}}$" if bold else f"${number}$"

    lines = [
        "% Requires \\usepackage{booktabs}.",
        f"% {result['rotation']} rotation, {result['n_factors']} factor(s), "
        f"{result['n_observations']} observations; bold: |loading| >= {threshold}.",
        "\\begin{tabular}{l" + "r" * len(names) + "r}",
        "\\toprule",
        "Measure & " + " & ".join(names) + " & Communality \\\\",
        "\\midrule",
    ]
    for measure, row in result["loadings"].items():
        cells = [cell(v, abs(v) >= threshold) for v in row]
        cells.append(cell(result["communalities"][measure]))
        lines.append(latex_escape(measure) + " & " + " & ".join(cells) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}", ""]
    return "\n".join(lines)
