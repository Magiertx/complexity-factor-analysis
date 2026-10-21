"""Descriptive statistics of the measures, as ComFy's report prints them.

ComFy (``FactorAnalysis.perform_factor_analysis``) and ComFy for log measures describe the data
as collected, before any measure is dropped: pandas' mean, median, standard deviation (ddof=1),
minimum and maximum of every measure over every observation, with missing values left out. The
tool does the same on the table a dataset is made from, so constant and duplicate measures are
described too, and adds the number of values each statistic rests on and the histogram of the
values, which the fact sheet of a measure draws.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .core import clean_matrix

#: The statistics of each measure, in the order of ComFy's table.
STATISTICS = ("mean", "median", "std", "min", "max")

#: Bins of the histogram of a measure at most; a measure with fewer distinct values gets one
#: bin per value.
BINS = 12


def _number(value: Any) -> float | None:
    value = float(value)
    return value if math.isfinite(value) else None


def histogram(values: pd.Series) -> dict[str, Any] | None:
    """The distribution of the values as counts in equal-width bins from the minimum to the
    maximum (the maximum is in the last bin); ``None`` without values. A measure with a single
    value has one bin."""
    if len(values) == 0:
        return None
    low, high = float(values.min()), float(values.max())
    bins = max(1, min(BINS, int(values.nunique())))
    counts, _ = np.histogram(values.to_numpy(dtype=float), bins=bins, range=(low, high) if high > low else (low - 0.5, high + 0.5))
    return {"min": low, "max": high, "counts": [int(c) for c in counts]}


def describe(raw: pd.DataFrame, dropped: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The statistics of every measure of ``raw`` (rows = observations) with numeric values.

    A measure that cleaning drops for a non-numeric value is left out, like ComFy for log
    measures leaves it out of its analysis; one dropped for another reason is described, with
    the reason. ``dropped`` is what ``clean_matrix`` dropped of ``raw``, if known already.
    ``basis`` says what the numbers describe: "input", the table before cleaning.
    """
    if dropped is None:
        dropped = clean_matrix(raw).dropped
    reasons = {d["measure"]: d["reason"] for d in dropped}
    rows = []
    for column in raw.columns:
        name = str(column)
        if reasons.get(name) == "non_numeric":
            continue
        values = pd.to_numeric(raw[column], errors="coerce").astype(float).replace([np.inf, -np.inf], np.nan)
        present = values.dropna()
        row: dict[str, Any] = {"measure": name, "n": int(len(present))}
        for statistic in STATISTICS:
            row[statistic] = _number(getattr(present, statistic)()) if len(present) else None
        row["dropped"] = reasons.get(name)
        row["histogram"] = histogram(present)
        rows.append(row)
    return {"basis": "input", "n_rows": int(len(raw)), "measures": rows}


def describe_cleaned(data: pd.DataFrame) -> dict[str, Any]:
    """The same for a cleaned matrix, for datasets stored before the statistics were kept: their
    input is gone, so only the measures that were kept can be described."""
    return {**describe(data, []), "basis": "cleaned"}

