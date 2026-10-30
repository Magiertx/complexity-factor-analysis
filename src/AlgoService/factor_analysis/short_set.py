"""The short set of a solution: one representative measure per dimension.

A dimension's representative is the measure assigned to it with the highest purity, its absolute
loading on the dimension minus its largest absolute loading on any other. A pure measure stands
for its dimension and for no other, so the short set names few measures that do not repeat each
other, as Important Factors motivates: fewer measures to report, without redundancy. Ties go to
the higher absolute loading; a dimension without an assigned measure has no representative.
"""

from __future__ import annotations

from typing import Any

#: Purities this close count as equal; keeps a tie from turning on the last bit.
_TIE_TOLERANCE = 1e-12


def purity(row: list[float], factor: int) -> float:
    """|loading on ``factor``| - the largest |loading| on any other factor; a single factor has
    no other, so its purity is its absolute loading."""
    others = [abs(v) for j, v in enumerate(row) if j != factor]
    return abs(row[factor]) - (max(others) if others else 0.0)


def representatives(loadings: dict[str, list[float]], factors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per factor of the assignment (``core.Assignment.factors``) with a measure, its
    representative: ``index`` of the factor, the ``measure``, its ``loading`` on the factor and
    its ``purity``, in the order of the factors."""
    out: list[dict[str, Any]] = []
    for factor in factors:
        best: dict[str, Any] | None = None
        # The members come largest absolute loading first, so among equal purities and loadings
        # the first stays.
        for member in factor["measures"]:
            measure = member["measure"]
            value = float(loadings[measure][factor["index"]])
            score = purity(loadings[measure], factor["index"])
            if (
                best is None
                or score > best["purity"] + _TIE_TOLERANCE
                or (abs(score - best["purity"]) <= _TIE_TOLERANCE and abs(value) > abs(best["loading"]) + _TIE_TOLERANCE)
            ):
                best = {"index": factor["index"], "measure": measure, "loading": value, "purity": score}
        if best is not None:
            out.append(best)
    return out
