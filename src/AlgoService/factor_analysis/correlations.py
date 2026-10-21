"""The correlations of the measures of a dataset: the correlation map of the suitability step, its
figure and the closest partners of a measure in its fact sheet.

The matrix is the Pearson correlation the factor analysis starts from (``core.correlation_matrix``),
over the measures of a cleaned dataset or of the rows of one miner, so no measure is constant. Its
order only changes what is shown: the analysis always gets the columns as stored (``core.analyze``).

Three orders:

- ``dataset``: as the columns are stored;
- ``cluster``: average linkage on 1 - |r|, leaves in the optimal order (scipy), so that measures
  that move together stand together whatever the factor analysis makes of them;
- ``factor``: by the dimension of an analysis, as the loadings heatmap groups them (strongest
  loading first), then the measures without one: those the analysis kept but no factor has, and
  those the MSA filter removed.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy.cluster import hierarchy
from scipy.spatial.distance import squareform

from .core import correlation_matrix

ORDERS = ("dataset", "cluster", "factor")

#: Pairs with at least this |r| are outlined on the map and listed.
HIGH = 0.95
#: Partners listed per measure in ``top``.
CLOSEST = 5
#: Pairs listed at most; ``high["count"]`` says how many there are.
MAX_PAIRS = 200
DECIMALS = 6


def correlation(data: pd.DataFrame) -> np.ndarray:
    """The correlations of the columns of ``data``, symmetric, 1 on the diagonal. A measure
    without variance, which a cleaned matrix has none of, correlates with nothing."""
    r = np.nan_to_num(correlation_matrix(data), nan=0.0, posinf=0.0, neginf=0.0)
    r = np.clip((r + r.T) / 2, -1.0, 1.0)
    np.fill_diagonal(r, 1.0)
    return r


def cluster_order(r: np.ndarray) -> list[int]:
    """The columns in the leaf order of an average-linkage tree on 1 - |r|."""
    p = r.shape[0]
    if p < 3:
        return list(range(p))
    distance = 1.0 - np.abs(r)
    np.fill_diagonal(distance, 0.0)
    condensed = squareform(distance, checks=False)
    tree = hierarchy.linkage(condensed, method="average")
    return [int(i) for i in hierarchy.leaves_list(hierarchy.optimal_leaf_ordering(tree, condensed))]


def factor_groups(result: dict[str, Any], measures: list[str]) -> list[dict[str, Any]]:
    """``measures`` by the dimensions of an analysis: a group per factor with its measures,
    strongest loading first, and a last group (factor null) of the measures without one, those
    the MSA filter removed at its end. A measure that loads on several factors stands in the
    first one. A factor none of the ``measures`` loads on has no group."""
    available = set(measures)
    seen: set[str] = set()
    groups: list[dict[str, Any]] = []
    for factor in result["factors"]:
        members = []
        for entry in factor["measures"]:
            measure = entry["measure"]
            if measure in available and measure not in seen:
                seen.add(measure)
                members.append(measure)
        if members:
            groups.append({"factor": int(factor["index"]), "measures": members})
    rest = [m for m in result["used_measures"] if m in available and m not in seen]
    rest += [r["measure"] for r in result["msa_filter"]["removed"] if r["measure"] in available and r["measure"] not in rest]
    # What the analysis does not know at all, e.g. a measure that has no variance within a miner.
    rest += [m for m in measures if m not in seen and m not in rest]
    if rest:
        groups.append({"factor": None, "measures": rest})
    return groups


def build(data: pd.DataFrame, order: str = "dataset", result: dict[str, Any] | None = None) -> dict[str, Any]:
    """The correlation map of the columns of ``data``: measures and matrix in the ``order``, the
    pairs with |r| of ``HIGH`` or more, and for every measure its ``CLOSEST`` partners by |r|.

    ``order="factor"`` needs the ``result`` of the analysis of the same measures and says in
    ``groups`` where its dimensions begin; else ``groups`` is null.
    """
    if order not in ORDERS:
        raise ValueError(f"Unknown order '{order}'.")
    columns = [str(c) for c in data.columns]
    r = correlation(data)
    groups: list[dict[str, Any]] | None = None
    if order == "cluster":
        positions = cluster_order(r)
    elif order == "factor":
        if result is None:
            raise ValueError("The order 'factor' needs the result of an analysis.")
        groups = factor_groups(result, columns)
        index = {m: i for i, m in enumerate(columns)}
        positions = [index[m] for g in groups for m in g["measures"]]
    else:
        positions = list(range(len(columns)))
    measures = [columns[i] for i in positions]
    ordered = r[np.ix_(positions, positions)]

    pairs = []
    count = 0
    p = len(measures)
    absolute = np.abs(r)
    for i in range(p):
        for j in range(i + 1, p):
            if absolute[i, j] >= HIGH:
                count += 1
                pairs.append((columns[i], columns[j], float(r[i, j])))
    pairs.sort(key=lambda pair: (-abs(pair[2]), pair[0], pair[1]))

    top: dict[str, list[dict[str, Any]]] = {}
    for i, measure in enumerate(columns):
        # Strongest first; equal |r| in the order of the columns.
        others = sorted((j for j in range(p) if j != i), key=lambda j: (-absolute[i, j], j))
        top[measure] = [{"measure": columns[j], "r": round(float(r[i, j]), DECIMALS)} for j in others[:CLOSEST]]

    return {
        "n_observations": int(len(data)),
        "order": order,
        "measures": measures,
        "r": np.round(ordered, DECIMALS).tolist(),
        "groups": groups,
        "high": {
            "threshold": HIGH,
            "count": count,
            "pairs": [{"a": a, "b": b, "r": round(v, DECIMALS)} for a, b, v in pairs[:MAX_PAIRS]],
        },
        "top": top,
    }
