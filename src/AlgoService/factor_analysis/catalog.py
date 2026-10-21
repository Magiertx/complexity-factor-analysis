"""What can be analysed: measures, miners, feature groups and the bundled data."""

from __future__ import annotations

import ast
import csv
import importlib.util
import inspect
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import provenance
from vendored.comfy_log import Constants as _LogConstants

from .short_codes import LOG_CODES, MODEL_CODES

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


#: The file of ComFy that implements the measures of a model, in its repository.
COMFY_MEASURES_FILE = "modelcomplexity/ModelComplexity.py"
_CALLED_FUNCTION = re.compile(r"\bModelComplexity\.(\w+)\(")


def _source(repository: dict[str, Any], file: str, function: str) -> dict[str, Any]:
    """Where a measure is implemented: the tool, the function in its file, the commit and a link
    to the file at that commit. What the sheet of a measure points to instead of a definition
    of its own."""
    commit = str(repository["commit"])[:7]
    return {
        "name": repository["name"],
        "function": function,
        "file": file,
        "commit": commit,
        "url": f"{repository['repository']}/blob/{commit}/{file}",
    }


def model_measure_source(measure: Any) -> dict[str, Any] | None:
    """ComFy's function behind a model measure: the one its ``calculate_for`` calls."""
    try:
        called = _CALLED_FUNCTION.search(inspect.getsource(type(measure).calculate_for))
    except (OSError, TypeError):
        return None
    return _source(provenance.COMFY, COMFY_MEASURES_FILE, called.group(1)) if called else None


@lru_cache(maxsize=1)
def feeed_functions() -> dict[str, tuple[str, str]]:
    """For each feeed feature, the file of the feeed repository and the method ("Class.name")
    that computes it, read from the installed package without importing it (which takes seconds,
    with pm4py)."""
    spec = importlib.util.find_spec("feeed")
    if spec is None or not spec.submodule_search_locations:
        return {}
    package = Path(next(iter(spec.submodule_search_locations)))
    out: dict[str, tuple[str, str]] = {}
    for path in sorted(package.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError, UnicodeDecodeError):
            continue
        file = f"{package.name}/{path.relative_to(package).as_posix()}"
        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            for member in node.body:
                if isinstance(member, ast.FunctionDef) and any(
                    isinstance(d, ast.Name) and d.id == "classmethod" for d in member.decorator_list
                ):
                    out.setdefault(member.name, (file, f"{node.name}.{member.name}"))
    return out


def log_measure_source(feature: str) -> dict[str, Any] | None:
    found = feeed_functions().get(feature)
    return _source(provenance.FEEED, found[0], found[1]) if found else None


def _model_parts() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    from algorithms.comfy import MEASURES_BY_NAME, MINERS_BY_NAME, SLOW_MEASURES, SLOW_MINERS

    measures = []
    for name in MEASURES_BY_NAME:
        entry: dict[str, Any] = {
            "key": name,
            "name": name,
            "description": MODEL_MEASURE_DESCRIPTIONS.get(name, ""),
        }
        if name in MODEL_CODES:
            entry["short"] = MODEL_CODES[name]
        source = model_measure_source(MEASURES_BY_NAME[name])
        if source:
            entry["source"] = source
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
    "msa_only": (
        "{tables} of the paper prints only the MSA values, and its text Bartlett's p-value and the "
        "overall MSA; the paper does not describe the factor analysis and refers to the report in "
        "the ComFy repository, whose numbers these are."
    ),
    "extra_dup_column": (
        "{tables} of the paper also have the measure dup without τ, which the bundled data lack; "
        "Bartlett's chi-square (10,965.18 in Tab. 7, 8,244.33 here), the overall MSA (0.81 and "
        "0.73), the MSA of each measure and the loadings (by up to 0.06) therefore differ from "
        "the paper. The groups of Tab. 9 stay the same."
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
        "published_options", "published_source", "published_scope",
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
            if name in LOG_CODES:
                entry["short"] = LOG_CODES[name]
            source = log_measure_source(name)
            if source:
                entry["source"] = source
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
