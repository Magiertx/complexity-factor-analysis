"""Numbers the bundled datasets were published with.

``datasets/published/<dataset id>.json`` holds what the upstream reports print, extracted
once by ``scripts/extract_published.py``:

- ``source``: repository, commit and file of the report;
- ``reproduce_with``: the analysis parameters under which the tool reproduces the numbers,
  or None if it cannot yet;
- ``verified``: the fields ``tests/test_published_numbers.py`` checks; only these may be
  compared at runtime;
- ``platform_dependent``: fields that are published but were computed with linear algebra
  that depends on the platform (and on units and column order), which the tool does
  differently, so they are kept for reference and never compared;
- the values themselves (``bartlett``, ``kmo``, ``msa_filter``, ``loadings``, ...), rounded
  as the report prints them (``decimals``), and ``notes`` on how they were read.

``match`` compares an analysis that ran with the ``published_options`` of the manifest with
these numbers.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .catalog import DATASETS_DIR, bundled_entry, paper_tables_note

PUBLISHED_DIR = DATASETS_DIR / "published"
SCHEMA_VERSION = 1


@lru_cache(maxsize=None)
def published(dataset_id: str) -> dict[str, Any] | None:
    """The published numbers of a bundled dataset, or None if there are none."""
    path = PUBLISHED_DIR / f"{dataset_id}.json"
    if "/" in dataset_id or "\\" in dataset_id or not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- comparing an analysis with them ------------------------------------------------------

#: A number matches if it differs by at most this, times its size for numbers above 1 (such as
#: Bartlett's chi-square); the reports print most values with four decimals.
TOLERANCE = 1e-4

#: What is compared, in this order; never the dimensions, which depend on the assignment rule.
COMPARED = ("bartlett", "kmo", "msa", "loadings")

#: The parameters an analysis must have run with to be compared, beside ``published_options``.
_OPTION_FIELDS = (
    "excluded", "auto_msa_filter", "msa_threshold", "bartlett_alpha", "n_factors", "rotation",
    "loading_threshold", "communality_threshold", "assignment_rule",
)


def _close(actual: float | None, expected: float) -> bool:
    return actual is not None and abs(actual - expected) <= TOLERANCE * max(1.0, abs(expected))


def uses_published_options(options: dict[str, Any], params: dict[str, Any]) -> bool:
    """Whether ``params`` (``core.AnalysisParams`` as a dict, with the factor count the analysis
    used) are the published options."""
    for name in _OPTION_FIELDS:
        expected, actual = options.get(name), params.get(name)
        if name == "excluded":
            if sorted(expected or []) != sorted(actual or []):
                return False
        elif isinstance(expected, float) or isinstance(actual, float):
            if expected is None or actual is None or abs(float(expected) - float(actual)) > 1e-12:
                return False
        elif expected != actual:
            return False
    return True


def _differences(numbers: dict[str, Any], result: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    verified = set(numbers["verified"])
    compared: list[str] = []
    out: list[dict[str, Any]] = []

    # ``code`` names the value for a client that words it itself; ``what`` says it in English.
    def check(key: str, code: str, what: str, actual: float | None, expected: float, **where: Any) -> None:
        if not _close(actual, expected):
            out.append({"key": key, "code": code, "what": what, **where, "expected": expected, "actual": actual})

    if "bartlett" in verified:
        compared.append("bartlett")
        check("bartlett", "bartlett_chi_square", "Bartlett's chi-square", result["bartlett"]["chi_square"], numbers["bartlett"]["chi_square"])
        check("bartlett", "bartlett_p_value", "Bartlett's p-value", result["bartlett"]["p_value"], numbers["bartlett"]["p_value"])
    if "kmo" in verified:
        compared.append("kmo")
        check("kmo", "kmo", "overall MSA (KMO)", result["kmo"]["overall"], numbers["kmo"]["overall"])
    if {"kmo", "msa_filter"} <= verified:
        compared.append("msa")
        expected_msa, actual_msa = numbers["kmo"]["per_measure"], result["kmo"]["per_measure"]
        if set(expected_msa) != set(actual_msa):
            out.append({
                "key": "msa", "code": "msa_measures", "what": "measures left after the MSA filter",
                "expected": sorted(expected_msa), "actual": sorted(actual_msa),
            })
        else:
            for measure, value in expected_msa.items():
                check("msa", "msa", f"MSA of {measure}", actual_msa[measure], value, measure=measure)
        expected_removed = {r["measure"]: r for r in numbers["msa_filter"]["removed"]}
        actual_removed = {r["measure"]: r for r in result["msa_filter"]["removed"]}
        if {m: r["round"] for m, r in expected_removed.items()} != {m: r["step"] for m, r in actual_removed.items()}:
            out.append({
                "key": "msa", "code": "msa_removed", "what": "measures removed by the MSA filter, with their step",
                "expected": {m: r["round"] for m, r in expected_removed.items()},
                "actual": {m: r["step"] for m, r in actual_removed.items()},
            })
        else:
            for measure, entry in expected_removed.items():
                check("msa", "msa_at_removal", f"MSA of {measure} when it was removed", actual_removed[measure]["msa"], entry["msa"],
                      measure=measure)
    if "loadings" in verified:
        compared.append("loadings")
        k = result["n_factors"]
        printed = numbers["loadings"]
        columns = len(next(iter(printed.values())))
        # Heuristics: the report fits one factor more than its measures allow and prints that
        # column as 0.0; the tool fits p - 1 (test_published_numbers.py).
        extra_empty = all(all(v == 0.0 for v in row[k:]) for row in printed.values())
        if set(printed) != set(result["loadings"]) or k > columns or not extra_empty:
            out.append({
                "key": "loadings", "code": "loadings_shape", "what": "measures and factors of the loadings",
                "expected": {"measures": sorted(printed), "factors": columns},
                "actual": {"measures": sorted(result["loadings"]), "factors": k},
            })
        else:
            for measure, row in printed.items():
                for j, value in enumerate(row[:k]):
                    check("loadings", "loading", f"loading of {measure} on factor {j + 1}", result["loadings"][measure][j], value,
                          measure=measure, factor=j)
            if "communalities" in verified:
                for measure, value in numbers["communalities"].items():
                    check("loadings", "communality", f"communality of {measure}", result["communalities"].get(measure), value,
                          measure=measure)
    return compared, out


def match(bundled_id: str | None, params: dict[str, Any], result: dict[str, Any]) -> dict[str, Any] | None:
    """How an analysis of a bundled dataset compares with its published numbers, or None if
    the dataset has no published options and verified numbers, or the analysis ran with other
    parameters than the published ones.

    ``params`` are the parameters of the analysis (``core.AnalysisParams`` as a dict) with the
    factor count it used. Only numbers are compared, never the dimensions.
    """
    if not bundled_id:
        return None
    entry = bundled_entry(bundled_id)
    numbers = published(bundled_id)
    if not entry or not entry.get("published_options") or not numbers or numbers.get("reproduce_with") is None:
        return None
    if not uses_published_options(entry["published_options"], params):
        return None
    compared, differences = _differences(numbers, result)
    source = numbers["source"]
    tables = entry.get("paper_tables") or {}
    return {
        "status": "differs" if differences else "match",
        "compared": compared,
        "differences": differences,
        "tolerance": TOLERANCE,
        "source": f"{source['file']} of ComFy, commit {source['commit'][:7]}",
        "report": source,
        "paper_tables": tables.get("key"),
        "paper_tables_ref": tables.get("tables"),
        "paper_tables_note": paper_tables_note(tables),
    }
