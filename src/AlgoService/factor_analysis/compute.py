"""Measure values computed from event logs or Petri nets, one row per observation.

Runs inside the dataset job. ``progress(pct, msg)`` raises to abort.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd

ProgressFn = Callable[[float, str], None]


@dataclass
class Input:
    path: str
    label: str


@dataclass
class ComputeResult:
    table: pd.DataFrame
    failures: list[tuple[str, str]] = field(default_factory=list)


def _number(value: Any) -> float:
    if value is None or isinstance(value, bool):
        return math.nan
    try:
        number = float(value)
    except (TypeError, ValueError):
        return math.nan
    return number if math.isfinite(number) else math.nan


def _short(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"[:300]


def _table(rows: dict[str, dict[str, float]], columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame.from_dict(rows, orient="index", columns=columns, dtype=float)


def model_from_logs(
    inputs: list[Input], miner_names: list[str], measure_names: list[str], progress: ProgressFn
) -> ComputeResult:
    """Discover a net per log and miner with ComFy (ProM4Py) and measure it."""
    from algorithms._log_io import read_event_log
    from algorithms._prom4py import get_prom4py
    from algorithms.comfy import MEASURES_BY_NAME, MINERS_BY_NAME, discover, measure_value

    miners = [MINERS_BY_NAME[n] for n in miner_names]
    measures = [MEASURES_BY_NAME[n] for n in measure_names]
    get_prom4py()

    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    total = len(inputs) * len(miners)
    done = 0
    for item in inputs:
        progress(100.0 * done / total, f"Reading {item.label}")
        try:
            log = read_event_log(item.path)
        except Exception as e:
            failures.append((item.label, _short(e)))
            done += len(miners)
            continue
        for miner in miners:
            label = f"{item.label} / {miner}"
            progress(100.0 * done / total, f"{label}: discovering")
            done += 1
            try:
                net, im, fm = discover(miner, log)
            except Exception as e:
                failures.append((label, f"discovery failed: {_short(e)}"))
                continue
            row: dict[str, float] = {}
            for measure in measures:
                progress(100.0 * (done - 1) / total, f"{label}: {measure}")
                try:
                    row[str(measure)] = _number(measure_value(measure, net, im, fm))
                except Exception as e:
                    row[str(measure)] = math.nan
                    failures.append((label, f"{measure}: {_short(e)}"))
            rows[label] = row
    return ComputeResult(_table(rows, measure_names), failures)


def model_from_pnml(inputs: list[Input], measure_names: list[str], progress: ProgressFn) -> ComputeResult:
    """Measure Petri nets read from PNML files, with their markings."""
    import pm4py

    from algorithms.comfy import MEASURES_BY_NAME, measure_value

    measures = [MEASURES_BY_NAME[n] for n in measure_names]
    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    for i, item in enumerate(inputs):
        progress(100.0 * i / len(inputs), f"Measuring {item.label}")
        try:
            net, im, fm = pm4py.read_pnml(item.path)
        except Exception as e:
            failures.append((item.label, f"not a readable PNML file: {_short(e)}"))
            continue
        row: dict[str, float] = {}
        for measure in measures:
            try:
                row[str(measure)] = _number(measure_value(measure, net, im, fm))
            except Exception as e:
                row[str(measure)] = math.nan
                failures.append((item.label, f"{measure}: {_short(e)}"))
        rows[item.label] = row
    return ComputeResult(_table(rows, measure_names), failures)


def log_from_logs(inputs: list[Input], features: list[str], progress: ProgressFn) -> ComputeResult:
    """feeed features per log, like ``MeasureEvaluator.collect_log_measure_data`` in ComFy for
    log measures. feeed reads the file itself and needs the ``.xes`` extension."""
    from feeed.feature_extractor import extract_features

    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    for i, item in enumerate(inputs):
        progress(100.0 * i / len(inputs), f"Extracting features of {item.label}")
        try:
            values = extract_features(item.path, features)
        except Exception as e:
            failures.append((item.label, _short(e)))
            continue
        rows[item.label] = {f: _number(values.get(f)) for f in features}
    return ComputeResult(_table(rows, features), failures)
