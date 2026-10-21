"""The names of the factors of a dataset's analyses, kept per solution.

A name belongs to the factor of one solution: the rows of a miner (or all rows), the factor count,
the rotation and the assignment rule. Names are kept for each solution a dataset has been named
for, so that a comparison of the dataset's own analyses can head each column with the names of
exactly its solution (``for_solution``).
"""

from __future__ import annotations

from typing import Iterable

#: Solutions per dataset whose names are kept; the one saved longest ago goes first.
MAX_SOLUTIONS = 40

Names = list[str | None]


def solution_key(n_factors: int, rotation: str, rule: str, miner: str | None) -> str:
    """The key of a solution, as the frontend keys the names on screen."""
    return f"{n_factors}|{rotation}|{rule}|{miner or ''}"


def remember(store: dict[str, Names] | None, key: str, names: Iterable[str | None] | None) -> dict[str, Names]:
    """``store`` with the names of the solution ``key`` set; without names the solution is
    forgotten. The solution saved last is the newest."""
    kept = {k: v for k, v in (store or {}).items() if k != key}
    given = list(names or [])
    if any(given):
        kept[key] = given
    while len(kept) > MAX_SOLUTIONS:
        kept.pop(next(iter(kept)))
    return kept


def for_solution(
    store: dict[str, Names] | None, n_factors: int, rotation: str, rule: str, miner: str | None
) -> Names | None:
    """The names of a solution, one entry per factor (None where a factor has none); None when
    no factor of it is named."""
    names = (store or {}).get(solution_key(n_factors, rotation, rule, miner))
    if not names:
        return None
    padded = (list(names) + [None] * n_factors)[:n_factors]
    return padded if any(padded) else None
