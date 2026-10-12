"""What can be analysed: measures, miners, feature groups and the bundled data."""

from __future__ import annotations

import csv
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from vendored.comfy_log import Constants as _LogConstants

KINDS = ("model", "log")
DATASETS_DIR = Path(__file__).resolve().parent.parent / "datasets"

MODEL_MEASURE_DESCRIPTIONS = {
    "Size": "Number of places and transitions.",
    "Connector Mismatch": "Imbalance between opening and closing parallel and choice connectors.",
    "Connector Heterogeneity": "Entropy of the connector types (parallel or choice); undefined without connectors.",
    "Cross-Connectivity": "How strongly pairs of nodes are connected over their paths.",
    "Token split": "Arcs leaving transitions minus the number of transitions.",
    "Control flow complexity": "Parallel splits plus the arcs leaving choice splits.",
    "Separability": "Share of nodes that are not articulation points of the undirected net.",
    "Average connector degree": "Mean number of arcs at a connector.",
    "Maximum connector degree": "Largest number of arcs at a connector.",
    "Sequentiality": "Share of arcs between two nodes that are not connectors.",
    "Depth": "Largest nesting depth of splits and joins; needs the markings.",
    "Diameter": "Longest acyclic path from an initially to a finally marked place.",
    "Cyclicity": "Share of nodes that lie on a cycle.",
    "Coefficient of network connectivity": "Arcs per node.",
    "Density": "Arcs divided by the largest possible number of arcs, 2·|T|·|P|.",
    "Number of duplicate tasks": "Repetitions of transition labels; silent transitions count as repetitions of one label.",
    "Number of empty sequence flows": "Places between a parallel split and a parallel join.",
}

LOG_GROUPS: dict[str, tuple[str, str]] = {
    "simple_stats": ("Simple statistics", "Number of traces, variants and events."),
    "trace_length": ("Trace length", "Distribution of the number of events per trace."),
    "trace_variant": ("Trace variants", "How the traces spread over their variants."),
    "activities": ("Activities", "Distribution of activity occurrences."),
    "start_activities": ("Start activities", "Distribution of the first activity of each trace."),
    "end_activities": ("End activities", "Distribution of the last activity of each trace."),
    "eventropies": ("Entropies", "Entropy measures of the traces, prefixes and k-blocks."),
    "epa_based": ("Extended prefix automaton", "Variant and sequence entropy on the extended prefix automaton."),
    "trace_diversity": ("Trace diversity", "Simple and advanced trace diversity."),
    "distinct_activities": ("Distinct activities", "Distinct activities per trace, event density, complexity factor."),
    "repetitions": ("Repetitions", "Loops and repeated activities within traces."),
    "comparison_based": ("Trace comparison", "Measures that compare traces pairwise, e.g. edit distance."),
    "dfg_based": ("Directly-follows graph", "Structure of the directly-follows graph of the log."),
}

# Pairwise trace comparisons: tens of seconds per log of 1000 traces.
SLOW_LOG_GROUPS = {"distinct_activities", "comparison_based"}


def log_features(groups: list[str]) -> list[str]:
    """feeed feature names of the given groups, in the order of ComFy for log measures."""
    out: list[str] = []
    for group in groups:
        for name in _LogConstants.all_measures[group]:
            if name not in out:
                out.append(name)
    return out


def log_group_of(feature: str) -> str | None:
    for group, names in _LogConstants.all_measures.items():
        if feature in names:
            return group
    return None


def _model_parts() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    from algorithms.comfy import MEASURES_BY_NAME, MINERS_BY_NAME, SLOW_MEASURES, SLOW_MINERS

    measures = []
    for name in MEASURES_BY_NAME:
        entry: dict[str, Any] = {
            "key": name,
            "name": name,
            "description": MODEL_MEASURE_DESCRIPTIONS.get(name, ""),
        }
        if name in SLOW_MEASURES:
            entry["slow"] = True
        measures.append(entry)
    miners = [
        {"key": name, "name": name, **({"slow": True} if name in SLOW_MINERS else {})}
        for name in MINERS_BY_NAME
    ]
    defaults = [m for m in MEASURES_BY_NAME if m not in SLOW_MEASURES]
    return measures, miners, defaults


def model_measure_keys() -> list[str]:
    from algorithms.comfy import MEASURES_BY_NAME

    return list(MEASURES_BY_NAME)


def model_miner_keys() -> list[str]:
    from algorithms.comfy import MINERS_BY_NAME

    return list(MINERS_BY_NAME)


DEFAULT_MINERS = ["Inductive miner"]


def default_log_groups() -> list[str]:
    return [g for g in _LogConstants.all_measures if g not in SLOW_LOG_GROUPS]


# --- bundled data -------------------------------------------------------------------------


@lru_cache(maxsize=1)
def manifest() -> dict[str, Any]:
    with open(DATASETS_DIR / "manifest.json", encoding="utf-8") as f:
        return json.load(f)


def bundled_entry(dataset_id: str) -> dict[str, Any] | None:
    return next((d for d in manifest()["datasets"] if d["id"] == dataset_id), None)


def sample_entry(sample_id: str) -> dict[str, Any] | None:
    return next((s for s in manifest()["samples"] if s["id"] == sample_id), None)


def sample_paths(sample: dict[str, Any]) -> list[Path]:
    return [DATASETS_DIR / f for f in sample["files"]]


@lru_cache(maxsize=None)
def _csv_shape(file: str) -> tuple[int, int]:
    with open(DATASETS_DIR / file, encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = sum(1 for _ in reader)
    return rows, len(header) - 1


_TUPLE_LABEL = re.compile(r"^\((.+),([^,]+)\)$")


def format_row_label(label: str, style: str | None) -> str:
    """ComFy writes rows as ``(log.xes,Miner)``; shown as ``log.xes / Miner``."""
    if style == "comfy_tuple":
        match = _TUPLE_LABEL.match(label)
        if match:
            return f"{match.group(1)} / {match.group(2)}"
    return label


#: How the tables of a paper relate to the numbers of the report a bundled dataset reproduces,
#: by the key ``paper_tables.key`` of the manifest; ``{tables}`` names the tables. Kept here so
#: that the wording can change without touching the data.
PAPER_TABLE_NOTES = {
    "matches": "{tables} of the paper print the same numbers, rounded.",
    "extra_dup_column": (
        "{tables} of the paper also have the measure dup without τ, which the bundled data lack; "
        "their loadings therefore differ from the report by up to 0.06."
    ),
    "other_data": (
        "{tables} of the paper rest on other data than the bundled ones: the descriptive "
        "statistics differ for 11 of 12 measures."
    ),
    "not_in_paper": "The paper does not analyse this dataset; the numbers are those of the report in the ComFy repository.",
}


def paper_tables_note(tables: dict[str, Any]) -> str | None:
    """The note of ``PAPER_TABLE_NOTES`` for the ``paper_tables`` entry of the manifest."""
    text = PAPER_TABLE_NOTES.get(tables.get("key") or "")
    return text.format(tables=tables.get("tables") or "") if text else None


def _public(entry: dict[str, Any], **extra: Any) -> dict[str, Any]:
    out = {"id": entry["id"], "name": entry["name"], "description": entry["description"], **extra}
    for key in (
        "citation", "license", "label", "collection", "venue", "note", "source_url",
        "published_options", "published_source",
    ):
        if entry.get(key):
            out[key] = entry[key]
    if entry.get("paper_tables"):
        out["paper_tables"] = {**entry["paper_tables"], "note": paper_tables_note(entry["paper_tables"])}
    return out


@lru_cache(maxsize=None)
def bundled_columns(file: str) -> tuple[str, ...]:
    """The measures of a bundled CSV, in its order."""
    with open(DATASETS_DIR / file, encoding="utf-8", newline="") as f:
        return tuple(next(csv.reader(f))[1:])


def collections(kind: str) -> list[dict[str, Any]]:
    """Papers the bundled datasets come from; the UI lists each paper's datasets together."""
    return [_public(c) for c in manifest().get("collections", []) if c["kind"] == kind]


def catalog(kind: str) -> dict[str, Any]:
    bundled = []
    for entry in manifest()["datasets"]:
        if entry["kind"] != kind:
            continue
        rows, columns = _csv_shape(entry["file"])
        bundled.append(_public(entry, observations=rows, measures=columns))
    samples = [
        _public(s, source=s["source"], files=[Path(f).name for f in s["files"]])
        for s in manifest()["samples"]
        if kind in s["kinds"]
    ]

    if kind == "model":
        measures, miners, default_measures = _model_parts()
        return {
            "kind": kind,
            "measures": measures,
            "miners": miners,
            "defaults": {"measures": default_measures, "miners": list(DEFAULT_MINERS)},
            "bundled": bundled,
            "collections": collections(kind),
            "samples": samples,
            "sources": ["bundled", "csv", "logs", "pnml"],
        }

    measures = []
    for group, names in _LogConstants.all_measures.items():
        for name in names:
            entry: dict[str, Any] = {
                "key": name,
                "name": name,
                "description": f"{LOG_GROUPS[group][0]} (feeed).",
                "group": group,
            }
            if group in SLOW_LOG_GROUPS:
                entry["slow"] = True
            measures.append(entry)
    groups = [
        {
            "key": g,
            "name": LOG_GROUPS[g][0],
            "description": LOG_GROUPS[g][1],
            **({"slow": True} if g in SLOW_LOG_GROUPS else {}),
        }
        for g in _LogConstants.all_measures
    ]
    defaults = default_log_groups()
    return {
        "kind": kind,
        "measures": measures,
        "groups": groups,
        "defaults": {"measures": log_features(defaults), "groups": defaults},
        "bundled": bundled,
        "collections": collections(kind),
        "samples": samples,
        "sources": ["bundled", "csv", "logs"],
    }
