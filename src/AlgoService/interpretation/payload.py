"""What is sent to the model: aggregated analysis results and measure definitions.

Built from the result of ``factor_analysis.core.analyze``, which describes measures only.
Observation labels, dataset and file names and the measure values never go in here.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from typing import Any

import numpy as np
import pandas as pd

from factor_analysis import catalog as cat
from factor_analysis.core import COMMUNALITY_THRESHOLDS, LOADING_THRESHOLDS, AnalysisParams

KIND_DESCRIPTIONS = {
    "model": (
        "Complexity measures of process models (Petri nets), computed with ComFy. Each "
        "observation is one net, usually discovered by a process discovery algorithm from an "
        "event log."
    ),
    "log": (
        "Complexity measures of event logs, computed with feeed and grouped as in ComFy for log "
        "measures. Each observation is one event log."
    ),
}


def _num(value: Any) -> Any:
    """Four significant digits; enough for the reading and stable across platforms."""
    if isinstance(value, float):
        return float(f"{value:.4g}") if np.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _num(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_num(v) for v in value]
    return value


def measure_definitions(kind: str, measures: list[str]) -> tuple[dict[str, str | None], dict[str, str] | None]:
    """The catalog text of each measure; None for columns of an own CSV the catalog lacks.

    Log measures share the text of their group, so for them each measure names its group and
    the second value holds the text of each group once.
    """
    if kind == "model":
        return {m: cat.MODEL_MEASURE_DESCRIPTIONS.get(m) for m in measures}, None
    definitions: dict[str, str | None] = {}
    groups: dict[str, str] = {}
    for m in measures:
        group = cat.log_group_of(m)
        if group is None:
            definitions[m] = None
            continue
        name, text = cat.LOG_GROUPS[group]
        definitions[m] = f"group: {name}"
        groups[name] = text
    return definitions, groups


def _factor_label(i: int) -> str:
    return f"Factor {i + 1}"


def build_payload(
    kind: str,
    result: dict[str, Any],
    params: AnalysisParams,
    dropped: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The aggregated result of one analysis, as sent to the model.

    ``dropped`` are the measures the dataset cleaning removed; only their names and reasons
    are kept, not the detail, which can quote a value.
    """
    used = list(result["used_measures"])
    k = int(result["n_factors"])
    labels = [_factor_label(i) for i in range(k)]
    removed_msa = [m["measure"] for m in result["msa_filter"]["removed"]]
    cleaning = [{"measure": d["measure"], "reason": d["reason"]} for d in (dropped or [])]
    involved = used + removed_msa + list(params.excluded) + [d["measure"] for d in cleaning]
    definitions, groups = measure_definitions(kind, list(dict.fromkeys(involved)))

    variance = result["variance"]
    payload: dict[str, Any] = {
        "kind": kind,
        "kind_description": KIND_DESCRIPTIONS[kind],
        "n_observations": result["n_observations"],
        "measure_definitions": definitions,
        **({"measure_groups": groups} if groups is not None else {}),
        "used_measures": used,
        "removed_measures": {
            "excluded_by_user": list(params.excluded),
            "msa_filter": result["msa_filter"]["removed"],
            "dataset_cleaning": cleaning,
        },
        "bartlett": {
            "chi_square": result["bartlett"]["chi_square"],
            "df": result["bartlett"]["df"],
            "p_value": result["bartlett"]["p_value"],
            "alpha": result["bartlett"]["alpha"],
            "passed": result["bartlett"]["passed"],
        },
        "kmo": {
            "overall": result["kmo"]["overall"],
            "threshold": result["kmo"]["threshold"],
            "passed": result["kmo"]["passed"],
            "per_measure_msa": result["kmo"]["per_measure"],
            "msa_filter_enabled": result["msa_filter"]["enabled"],
        },
        "eigenvalues": result["eigenvalues"],
        "suggested_n_factors": result["suggested_n_factors"],
        "n_factors": k,
        "factors": labels,
        "rotation": result["rotation"],
        "loadings_note": "Per measure, one value per factor in the order of 'factors'.",
        "loadings": result["loadings"],
        "communalities": result["communalities"],
        "variance": {
            "ss_loadings": dict(zip(labels, variance["ss_loadings"])),
            "proportion": None if variance["proportion"] is None else dict(zip(labels, variance["proportion"])),
            "explained_total": variance["explained"],
        },
        "assignment": {
            "loading_threshold": result["loading_threshold"],
            "communality_threshold": result["communality_threshold"],
            "factors": {
                _factor_label(f["index"]): [{"measure": m["measure"], "loading": m["loading"]} for m in f["measures"]]
                for f in result["factors"]
            },
            "unassigned": result["unassigned"],
        },
        "warnings": [w["message"] for w in result.get("warning_details", [])],
    }
    if result.get("structure_loadings") is not None:
        payload["loadings_note"] += " Oblique rotation: 'loadings' is the pattern matrix."
        payload["structure_loadings"] = result["structure_loadings"]
        payload["factor_correlations"] = result["factor_correlations"]
    return _num(payload)


def data_hash(data: pd.DataFrame) -> str:
    """Hash of the measure names and values of a cleaned matrix; row labels do not count."""
    digest = hashlib.sha256(json.dumps(list(map(str, data.columns))).encode())
    digest.update(np.ascontiguousarray(data.to_numpy(dtype=float)).tobytes())
    return digest.hexdigest()


def effective_params(params: AnalysisParams, n_factors: int) -> dict[str, Any]:
    """The parameters as they determine the result: the factor count the analysis used, the
    exclusions as a set."""
    values = dataclasses.asdict(params)
    values["n_factors"] = int(n_factors)
    values["excluded"] = sorted(values["excluded"])
    return values


def default_params(kind: str) -> AnalysisParams:
    """The parameters of an analyze request without a body; precomputed interpretations use them."""
    return AnalysisParams(
        loading_threshold=LOADING_THRESHOLDS[kind],
        communality_threshold=COMMUNALITY_THRESHOLDS[kind],
    )
