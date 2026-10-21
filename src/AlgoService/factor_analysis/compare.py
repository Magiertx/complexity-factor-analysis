"""Factor structures of several analyses side by side, like Tab. 17 of Important Factors.

A column is the analysis of one bundled dataset: with the settings its paper published (or the
standard ones of its kind, if it has none), optionally changed, e.g. to another factor count.
All columns share one assignment rule, so that a difference between two columns is one of the
data, not of the rule.

The numbering of factors is arbitrary in every analysis, so the factors of the columns are
matched first: the first column keeps its numbers, and the factors of each further column are
matched one to one to the dimensions of the columns before it by the measures they share
(the Hungarian method on the number of shared measures; ``align``). Each measure counts for the
factor of its largest absolute loading, whatever the rule, so that switching the rule never
renumbers the dimensions. Important Factors renumbered its dimensions by hand for Tab. 17; the
tool's numbers can differ from the paper's, the groups do not.

``build`` turns the analyses into what the API returns: a header per column, a matrix with one
row per measure and the dimensions of the measure in every column, and the dimensions per
column as Tab. 17 lists them. ``membership_csv``, ``dimensions_latex`` and ``comparison_zip``
are its exports.
"""

from __future__ import annotations

import dataclasses
import io
import json
import zipfile
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

import provenance
from config import APP_NAME

from . import catalog as cat
from .core import CROSS_LOADING_GAP, AnalysisParams, clean_matrix
from .short_codes import short_code

MIN_COLUMNS = 2
MAX_COLUMNS = 8

#: How the dimensions of the columns are matched, for the result and the manifest.
ALIGNMENT = {
    "method": "shared_measures",
    "reference": 0,
    "description": (
        "The first column keeps the numbers of its factors. The factors of each further column are "
        "matched one to one to the dimensions of the columns before it, so that the most measures "
        "fall into the same dimension (Hungarian method on the number of shared measures); each "
        "measure counts for the factor of its largest absolute loading, whatever the rule."
    ),
}

#: Two columns whose loadings differ by no more than this are the same analysis.
SAME_TOLERANCE = 1e-9


# --- the data of a column -----------------------------------------------------------------


@lru_cache(maxsize=16)
def bundled_data(dataset_id: str) -> tuple[pd.DataFrame, tuple[str, ...], tuple[tuple[str, str], ...]]:
    """The matrix of a bundled dataset as the API has it once the dataset is opened with all its
    measures, so that its fits are those of the cache (``precompute.bundled_matrix``), shared
    and never changed; the measures of its CSV; the measures cleaning dropped, with the reason."""
    from .precompute import bundled_matrix

    entry = cat.bundled_entry(dataset_id)
    if entry is None:
        raise KeyError(dataset_id)
    table = pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)
    dropped = tuple((d["measure"], d["reason"]) for d in clean_matrix(table).dropped)
    return bundled_matrix(entry), tuple(str(c) for c in table.columns), dropped


def column_params(entry: dict[str, Any], settings: str, changes: dict[str, Any], rule: str) -> tuple[AnalysisParams, str]:
    """The parameters of a column and the settings they start from: the published ones of the
    dataset ("paper"; the standard ones of its kind if it has none) or the standard ones, with
    ``changes`` on top and the comparison's ``rule``."""
    from interpretation.payload import default_params

    published = entry.get("published_options")
    used = "paper" if settings == "paper" and published else "standard"
    base = dict(published) if used == "paper" else dataclasses.asdict(default_params(entry["kind"]))
    return AnalysisParams(**{**base, **changes, "assignment_rule": rule}), used


# --- matching the factors -----------------------------------------------------------------


def primary_groups(loadings: dict[str, list[float]], n_factors: int) -> list[set[str]]:
    """The measures of each factor when every measure counts for the factor of its largest
    absolute loading; the lower factor wins a tie."""
    groups: list[set[str]] = [set() for _ in range(n_factors)]
    for measure, row in loadings.items():
        if row:
            groups[int(np.argmax(np.abs(np.asarray(row, dtype=float))))].add(measure)
    return groups


def align(columns: list[list[set[str]]]) -> tuple[list[list[int]], list[list[int]]]:
    """The dimension of each factor of each column, and the number of measures each factor
    shares with the dimension it was matched to (over the columns before it).

    ``columns`` holds the groups of each column (``primary_groups``); a column that failed has
    none. The dimensions are as many as the most factors of a column. The first column with
    factors keeps their numbers; each further column is matched to the measures the columns
    before it put into each dimension, so that the shared measures add up to the most. Among
    equally good matches a factor keeps its own number.
    """
    n_dimensions = max((len(groups) for groups in columns), default=0)
    counts: list[Counter[str]] = [Counter() for _ in range(n_dimensions)]
    dimensions: list[list[int]] = []
    shared: list[list[int]] = []
    for groups in columns:
        if not groups:
            dimensions.append([])
            shared.append([])
            continue
        overlap = np.array(
            [[sum(counts[d][m] for m in group) for d in range(n_dimensions)] for group in groups], dtype=float
        )
        # Integers scaled up, plus 1 where a factor keeps its own number: that wins only a tie.
        keep = np.zeros_like(overlap)
        for f in range(len(groups)):
            keep[f, f] = 1.0
        rows, cols = linear_sum_assignment(overlap * (len(groups) + 1) + keep, maximize=True)
        mapping = [0] * len(groups)
        for f, d in zip(rows, cols):
            mapping[int(f)] = int(d)
        dimensions.append(mapping)
        shared.append([int(overlap[f, mapping[f]]) for f in range(len(groups))])
        for f, group in enumerate(groups):
            counts[mapping[f]].update(group)
    return dimensions, shared


# --- the comparison -----------------------------------------------------------------------


def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Whether two analyses are the same: the same measures, factors and loadings."""
    if a["used_measures"] != b["used_measures"] or a["n_factors"] != b["n_factors"]:
        return False
    if a["rotation"] != b["rotation"]:
        return False
    return all(
        np.allclose(a["loadings"][m], b["loadings"][m], rtol=0.0, atol=SAME_TOLERANCE) for m in a["used_measures"]
    )


def _column_header(spec: dict[str, Any], result: dict[str, Any] | None) -> dict[str, Any]:
    entry = spec["entry"]
    header: dict[str, Any] = {
        "bundled_id": entry["id"],
        "label": spec.get("label") or entry.get("label") or entry["name"],
        "name": entry["name"],
        "collection": entry.get("collection"),
        "settings": spec["settings"],
        "options": spec["options"],
        "published_source": entry.get("published_source") if spec["settings"] == "paper" else None,
        "paper_tables": (entry.get("paper_tables") or {}).get("key"),
        "n_measures": len(spec["measures"]),
    }
    if result is None:
        return header
    cumulative = result["variance"]["cumulative"]
    header.update({
        "n_observations": result["n_observations"],
        "used_measures": result["used_measures"],
        "msa_removed": [r["measure"] for r in result["msa_filter"]["removed"]],
        "kmo": result["kmo"]["overall"],
        "n_factors": result["n_factors"],
        "rotation": result["rotation"],
        "cumulative_variance": cumulative[-1] if cumulative else None,
        "explained_variance": result["variance"]["explained"],
        "factor_count": {
            "kaiser": result["factor_count"]["kaiser"],
            "parallel_analysis": result["factor_count"]["parallel_analysis"],
        },
        "warnings": result["warning_details"],
        "timings": result["timings"],
    })
    return header


def _cell(measure: str, spec: dict[str, Any], result: dict[str, Any] | None, dimension_of: list[int]) -> dict[str, Any]:
    """What a column says about a measure."""
    if measure not in spec["measures"]:
        return {"status": "absent"}
    if measure in spec["options"]["excluded"]:
        return {"status": "excluded"}
    dropped = spec["dropped"].get(measure)
    if dropped:
        return {"status": "dropped", "reason": dropped}
    if result is None:
        return {"status": "failed"}
    removed = {r["measure"]: r for r in result["msa_filter"]["removed"]}
    if measure in removed:
        return {"status": "msa_removed", "msa": removed[measure]["msa"], "step": removed[measure]["step"]}
    if measure not in result["loadings"]:
        return {"status": "absent"}
    row = result["loadings"][measure]
    communality = result["communalities"][measure]
    cross = next((c for c in result["cross_loadings"] if c["measure"] == measure), None)
    assigned = [
        (f["index"], m["loading"]) for f in result["factors"] for m in f["measures"] if m["measure"] == measure
    ]
    # The dimensions and loadings of a cross-loading, largest absolute loading first.
    crossed = (
        {"cross_dimensions": [dimension_of[f] for f in cross["factors"]], "cross_loadings": cross["loadings"]}
        if cross
        else {}
    )
    if assigned:
        assigned.sort(key=lambda fl: -abs(fl[1]))
        return {
            "status": "assigned",
            "factors": [f for f, _ in assigned],
            "dimensions": [dimension_of[f] for f, _ in assigned],
            "loadings": [v for _, v in assigned],
            "communality": communality,
            "cross_loading": cross is not None,
            **crossed,
        }
    largest = int(np.argmax(np.abs(np.asarray(row, dtype=float))))
    reason = next((u["reason"] for u in result["unassigned_details"] if u["measure"] == measure), None)
    return {
        "status": "unassigned",
        "reason": reason,
        # Where it loads most, for a client that shows it faded.
        "factor": largest,
        "dimension": dimension_of[largest],
        "loading": row[largest],
        "communality": communality,
        "cross_loading": cross is not None,
        **crossed,
    }


def build(specs: list[dict[str, Any]], rule: str) -> dict[str, Any]:
    """The comparison of analysed columns.

    Each spec has the bundled ``entry``, the ``settings`` its parameters start from, the
    ``options`` (the parameters as a dict), the ``measures`` of its dataset, the measures
    cleaning ``dropped`` (by name, with the reason), an optional ``label``, and either the
    ``result`` of the analysis or the ``error`` that stopped it (``code``, ``message``,
    ``params``).
    """
    results = [spec.get("result") for spec in specs]
    groups = [primary_groups(r["loadings"], r["n_factors"]) if r else [] for r in results]
    dimension_of, shared = align(groups)
    n_dimensions = max((len(d) for d in dimension_of), default=0)
    kind = specs[0]["entry"]["kind"]

    columns = []
    for i, (spec, result) in enumerate(zip(specs, results)):
        header = _column_header(spec, result)
        if result is None:
            header["error"] = spec.get("error")
        else:
            header["factor_dimensions"] = dimension_of[i]
            header["shared_measures"] = shared[i]
            header["same_as"] = next(
                (j for j in range(i) if results[j] is not None and _same(results[j], result)), None
            )
        columns.append(header)

    # Every measure of any column, in the order of the first column that has it.
    order: list[str] = []
    for spec in specs:
        order += [m for m in spec["measures"] if m not in order]
    rows = []
    for position, measure in enumerate(order):
        cells = [_cell(measure, spec, result, dimension_of[i]) for i, (spec, result) in enumerate(zip(specs, results))]
        firsts = [c["dimensions"][0] for c in cells if c["status"] == "assigned"]
        counted = Counter(firsts)
        # The dimension most columns put it in first; of those, the one of the leftmost column.
        dimension = min(counted, key=lambda d: (-counted[d], firsts.index(d))) if counted else None
        rows.append({
            "measure": measure,
            "short": short_code(kind, measure),
            "dimension": dimension,
            "agreement": counted[dimension] if dimension is not None else 0,
            "cells": cells,
            "_position": position,
        })
    # Grouped by dimension, those in no dimension last; within a group the measures most
    # columns agree on first, then in the order of the data.
    rows.sort(key=lambda r: (r["dimension"] is None, r["dimension"] or 0, -r["agreement"], r["_position"]))
    for row in rows:
        del row["_position"]

    dimensions = []
    for d in range(n_dimensions):
        per_column = []
        for i, result in enumerate(results):
            if result is None:
                per_column.append(None)
                continue
            factor = dimension_of[i].index(d) if d in dimension_of[i] else None
            # In the order of the data, as Tab. 17 lists them.
            rank = {m: p for p, m in enumerate(specs[i]["measures"])}
            members = sorted(
                (
                    {"measure": m["measure"], "loading": m["loading"]}
                    for m in (result["factors"][factor]["measures"] if factor is not None else [])
                ),
                key=lambda m: rank.get(m["measure"], len(rank)),
            )
            per_column.append({"factor": factor, "measures": members})
        dimensions.append({"index": d, "columns": per_column})

    return {
        "kind": kind,
        "assignment_rule": rule,
        "cross_loading_gap": CROSS_LOADING_GAP,
        "alignment": {**ALIGNMENT, "dimensions": n_dimensions},
        "columns": columns,
        "measures": rows,
        "dimensions": dimensions,
        "unassigned": [
            None if result is None else [
                {"measure": u["measure"], "reason": u["reason"]} for u in result["unassigned_details"]
            ]
            for result in results
        ],
    }


# --- exports ------------------------------------------------------------------------------


def _csv_line(cells: list[Any]) -> str:
    from zip_export import csv_cell

    return ",".join(csv_cell(c) for c in cells) + "\n"


def cell_text(cell: dict[str, Any]) -> str:
    """A cell of the matrix as the CSV writes it: the dimensions, counted from 1, or why the
    measure is in none."""
    status = cell["status"]
    if status == "assigned":
        return " ".join(f"D{d + 1}" for d in cell["dimensions"])
    if status == "unassigned":
        return f"unassigned:{cell['reason']}" if cell.get("reason") else "unassigned"
    if status == "dropped":
        return f"dropped:{cell['reason']}"
    return "" if status == "absent" else status


def membership_csv(comparison: dict[str, Any]) -> str:
    """One row per measure, one column per analysis: the dimensions the rule put the measure in
    (D1, or D1 D3 under "multi"), else ``unassigned:<reason>``, ``msa_removed``, ``excluded``,
    ``dropped:<reason>``, ``failed``, or nothing for a measure the dataset does not have."""
    labels = [c["label"] for c in comparison["columns"]]
    lines = [_csv_line(["measure", "code", "dimension", *labels])]
    for row in comparison["measures"]:
        dimension = "" if row["dimension"] is None else f"D{row['dimension'] + 1}"
        lines.append(_csv_line([row["measure"], row["short"] or "", dimension, *(cell_text(c) for c in row["cells"])]))
    return "".join(lines)


_UNASSIGNED = {"low_communality": "low communality", "low_loading": "no loading counts", "cross_loading": "cross-loading"}


def dimensions_latex(comparison: dict[str, Any], short: bool = True) -> str:
    """The dimensions of each analysis as a booktabs tabular in the layout of Tab. 17 of
    Important Factors: one row per analysis, one column per dimension. Comments name the rule,
    how the dimensions were matched, and the measures in no dimension."""
    from .export import ASSIGNMENT_RULE_TEXTS
    from .report import _RAGGED, _Labels, tex

    label = _Labels(comparison["kind"], short)
    rule = comparison["assignment_rule"]
    n = comparison["alignment"]["dimensions"]
    width = max(1.6, round(11.0 / max(n, 1), 1))
    lines = [
        "% Requires \\usepackage{booktabs} and \\usepackage{array}.",
        f"% Assignment rule {rule}: {ASSIGNMENT_RULE_TEXTS[rule]}.",
        "% Dimensions matched across the analyses by shared measures; the first analysis keeps the numbers of its factors.",
    ]
    for column, unassigned in zip(comparison["columns"], comparison["unassigned"]):
        if unassigned:
            listed = "; ".join(
                f"{' '.join(u['measure'].split())} ({_UNASSIGNED.get(u['reason'], u['reason'])})" for u in unassigned
            )
            lines.append(f"% In no dimension, {' '.join(column['label'].split())}: {listed}.")
        if column.get("error"):
            lines.append(f"% {' '.join(column['label'].split())} could not be analysed: {' '.join(column['error']['message'].split())}")
    lines += [
        f"\\begin{{tabular}}{{l{(_RAGGED + f'p{{{width}cm}}') * n}}}",
        "\\toprule",
        " & " + " & ".join(f"Dimension {d + 1}" for d in range(n)) + " \\\\",
        "\\midrule",
    ]
    for i, column in enumerate(comparison["columns"]):
        cells = []
        for dimension in comparison["dimensions"]:
            entry = dimension["columns"][i]
            cells.append(", ".join(label(m["measure"]) for m in entry["measures"]) if entry else "--")
        lines.append(f"{tex(column['label'])} & " + " & ".join(cells) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}", ""]
    return "\n".join(lines)


def _readme(comparison: dict[str, Any], files: list[dict[str, str]], created_at: str) -> str:
    width = max(len(f["name"]) for f in files) + 2
    labels = ", ".join(c["label"] for c in comparison["columns"])
    return "\n".join([
        f"Factor structures of {labels}, compared in {APP_NAME} on {created_at}.",
        "",
        "Files",
        *(f"  {f['name']:<{width}}{f['description']}" for f in files),
        "",
        "Reproduce",
        "  POST the request of manifest.json to /factor-analysis/compare. Each column is the",
        "  analysis of a bundled dataset with the parameters manifest.json lists for it; the same",
        "  parameters on the dataset's own page give the same loadings.",
        "",
        f"  {ALIGNMENT['description']}",
        "",
    ])


def comparison_zip(comparison: dict[str, Any], request: dict[str, Any], short: bool = True) -> bytes:
    """The comparison as a ZIP: the full result, the matrix as CSV, the dimensions as LaTeX, a
    README and a manifest with the request, the parameters of each column, where the data come
    from, the tool and the library versions."""
    from .export import library_versions

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    files: list[tuple[str, str, str]] = [
        ("comparison.json", json.dumps(comparison, ensure_ascii=False, indent=2),
         "The full result, as POST /factor-analysis/compare returns it."),
        ("membership.csv", membership_csv(comparison),
         "One row per measure: the dimensions each analysis puts it in, or why none."),
        ("dimensions.tex", dimensions_latex(comparison, short),
         "The dimensions of each analysis as a booktabs tabular, laid out like Tab. 17 of Important Factors."),
    ]
    listing = [
        {"name": "manifest.json", "description": "What was compared, with which parameters, code and libraries."},
        {"name": "README.txt", "description": "This overview and how to reproduce the comparison."},
        *({"name": name, "description": description} for name, _, description in files),
    ]
    datasets = []
    for column in comparison["columns"]:
        entry = cat.bundled_entry(column["bundled_id"]) or {}
        datasets.append({
            "bundled_id": column["bundled_id"],
            "label": column["label"],
            "settings": column["settings"],
            "analysis_params": column["options"],
            "published_source": column.get("published_source"),
            "citation": entry.get("citation"),
            "license": entry.get("license"),
            "source_url": entry.get("source_url"),
            "source_commit": entry.get("source_commit"),
        })
    manifest = {
        "app": APP_NAME,
        "created_at": created_at,
        "tool": provenance.tool(),
        "request": request,
        "assignment_rule": comparison["assignment_rule"],
        "alignment": comparison["alignment"],
        "columns": datasets,
        "measure_labels": "short_codes" if short else "names",
        "libraries": library_versions(),
        "files": listing,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("README.txt", _readme(comparison, listing, created_at))
        for name, content, _ in files:
            archive.writestr(name, content)
    return buffer.getvalue()
