"""The rows of one miner in a model dataset discovered with several miners.

A model dataset computed from event logs has one row per log and miner, labelled
``<log> / <miner>`` (``compute.model_from_logs``; the bundled ComFy tables read the same way).
Important Factors analyses every miner on its own. Analysing all rows together mixes the
differences between the miners into the dimensions and counts every log once per miner.

The analysis option ``miner`` keeps the rows of one miner without making a dataset of them:
nothing is stored, nothing pushes out an upload, and the rate limit of new datasets is not
touched. The rows keep their values and the columns their stored order, on which the KMO of
singular data depends (``core.analyze``). Within one miner a measure can be constant, or
perfectly correlated with another, although it is not over all rows; it is dropped for that
miner as cleaning drops it from a dataset (``core.clean_matrix``), and the selection says so.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

import pandas as pd

from .core import clean_matrix

#: Between the log and the miner in the label of a row.
SEPARATOR = " / "


def miner_of(label: str) -> str | None:
    """The miner a row label names, or None for a label without one."""
    text = str(label)
    if SEPARATOR not in text:
        return None
    return text.rsplit(SEPARATOR, 1)[1]


def known_miners() -> list[str]:
    """The miners the tool can discover with, by the names the rows carry."""
    from . import catalog as cat

    return cat.model_miner_keys()


def miners_of(observations: Iterable[str], known: Iterable[str], order: Iterable[str] = ()) -> list[str]:
    """The miners of the rows, if every row names one of ``known``; else none. In the order of
    ``order`` (the miners a dataset was computed with), the others as the rows bring them."""
    names = [miner_of(label) for label in observations]
    allowed = set(known)
    if not names or any(name is None or name not in allowed for name in names):
        return []
    present = list(dict.fromkeys(names))
    first = [m for m in order if m in present]
    return first + [m for m in present if m not in first]


def dataset_miners(meta: dict[str, Any]) -> list[str]:
    """The miners of a stored model dataset, by the labels of its rows; none for a log dataset
    or rows of another kind."""
    if meta.get("kind") != "model":
        return []
    order = (meta.get("inputs") or {}).get("miners") or (meta.get("params") or {}).get("miners") or []
    return miners_of(meta.get("observations") or [], known_miners(), order)


@dataclass
class Selection:
    """The rows of one miner, ready for the analysis."""

    miner: str
    #: The rows of the miner, cleaned as a dataset of them alone would be, columns in stored order.
    data: pd.DataFrame
    #: Measures cleaning dropped within the miner: ``measure``, ``reason`` (constant or
    #: duplicate) and, for a duplicate, ``detail`` and ``params``.
    dropped: list[dict[str, Any]] = field(default_factory=list)

    def describe(self) -> dict[str, Any]:
        """What the result of an analysis says about the selection."""
        return {
            "name": self.miner,
            "n_observations": int(len(self.data)),
            "n_measures": int(self.data.shape[1]),
            "dropped": self.dropped,
        }


def select(data: pd.DataFrame, miner: str) -> Selection:
    """The rows of ``miner`` in ``data``, with the measures that vary within them.

    The values are those of ``data``: a row of the selection equals the row of the same label.
    """
    rows = [label for label in data.index if miner_of(label) == miner]
    cleaned = clean_matrix(data.loc[rows])
    # Every value is a number already; only measures without variance or with a twin go.
    dropped = [d for d in cleaned.dropped if d["reason"] in ("constant", "duplicate")]
    return Selection(miner=miner, data=cleaned.data, dropped=dropped)


def summary(data: pd.DataFrame, miners: list[str]) -> list[dict[str, Any]]:
    """Per miner: its rows and the measures that vary within them, for choosing one."""
    counts = Counter(miner_of(label) for label in data.index)
    out = []
    for miner in miners:
        selection = select(data, miner) if counts[miner] > 1 else None
        out.append({
            "name": miner,
            "n_observations": int(counts[miner]),
            "n_measures": int(selection.data.shape[1]) if selection is not None else 0,
            "dropped": [d["measure"] for d in selection.dropped] if selection is not None else list(data.columns),
        })
    return out
