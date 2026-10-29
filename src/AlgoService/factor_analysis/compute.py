"""Measure values computed from event logs or Petri nets, one row per observation.

Runs inside the dataset job. ``progress(pct, msg)`` raises to abort.

Each computation also measures itself (``Measurement``): the wall time of every stage per input
(reading, discovery per miner, each measure or feature group) and the size of each input (events,
traces, variants and activities of a log, places, transitions and arcs of a net). The sizes come
from the log or net already read, so nothing is read twice for them.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd

ProgressFn = Callable[[float, str], None]


@dataclass
class Input:
    path: str
    label: str


@dataclass
class Measurement:
    """Wall times in seconds and input sizes of one computation, as plain JSON values.

    ``inputs`` has one entry per input file: its size and the time to read it. ``observations``
    one per row of the dataset (a log and a miner, a log, or a net): the time of the discovery,
    the size of the net, and the time of each measure (model) or feature group (log) in
    ``stages``. An input or observation that failed has an ``error``.
    """

    kind: str
    source: str
    inputs: list[dict[str, Any]] = field(default_factory=list)
    observations: list[dict[str, Any]] = field(default_factory=list)
    total_s: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "source": self.source,
            "unit": "seconds",
            "clock": "wall time, time.perf_counter",
            "total_s": self.total_s,
            "inputs": self.inputs,
            "observations": self.observations,
        }


@dataclass
class ComputeResult:
    table: pd.DataFrame
    failures: list[tuple[str, str]] = field(default_factory=list)
    measurement: Measurement | None = None
    #: Feature groups left out for every log because feeed failed on one of them: per group the
    #: ``group``, its ``measures``, a ``code``, the technical ``error`` and the ``inputs`` it failed for.
    skipped: list[dict[str, Any]] = field(default_factory=list)


class DatasetError(RuntimeError):
    """A dataset cannot be computed; ``code`` and ``params`` name the cause for the UI, which
    says it in its own language. The message stays the English text of the dataset's ``error``."""

    def __init__(self, message: str, code: str, **params: Any) -> None:
        super().__init__(message)
        self.code = code
        self.params = params


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


def _seconds(started: float) -> float:
    return round(time.perf_counter() - started, 6)


def log_size_of_frame(log: pd.DataFrame) -> dict[str, Any]:
    """Events, traces, variants and activities of a log read as a pm4py DataFrame."""
    case, activity = "case:concept:name", "concept:name"
    size: dict[str, Any] = {"events": int(len(log))}
    if case in log.columns:
        size["traces"] = int(log[case].nunique())
        if activity in log.columns:
            # pm4py keeps the events of a case in the order of the file.
            size["variants"] = int(log.groupby(case, sort=False)[activity].agg(tuple).nunique())
    if activity in log.columns:
        size["activities"] = int(log[activity].nunique())
    return size


def log_size_of_eventlog(log: Any) -> dict[str, Any]:
    """The same for a pm4py EventLog, as feeed reads it."""
    sequences = [tuple(event.get("concept:name") for event in trace) for trace in log]
    return {
        "events": sum(len(s) for s in sequences),
        "traces": len(sequences),
        "variants": len(set(sequences)),
        "activities": len({a for s in sequences for a in s if a is not None}),
    }


def net_size(net: Any) -> dict[str, int] | None:
    """Places, transitions and arcs of a Petri net; None for something else."""
    try:
        return {"places": len(net.places), "transitions": len(net.transitions), "arcs": len(net.arcs)}
    except AttributeError:
        return None


def model_from_logs(
    inputs: list[Input], miner_names: list[str], measure_names: list[str], progress: ProgressFn
) -> ComputeResult:
    """Discover a net per log and miner with ComFy (ProM4Py) and measure it."""
    from algorithms._log_io import read_event_log
    from algorithms._prom4py import get_prom4py
    from algorithms.comfy import MEASURES_BY_NAME, MINERS_BY_NAME, discover, measure_value

    started_all = time.perf_counter()
    miners = [MINERS_BY_NAME[n] for n in miner_names]
    measures = [MEASURES_BY_NAME[n] for n in measure_names]
    get_prom4py()

    measurement = Measurement("model", "logs")
    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    total = len(inputs) * len(miners)
    done = 0
    for item in inputs:
        progress(100.0 * done / total, f"Reading {item.label}")
        started = time.perf_counter()
        try:
            log = read_event_log(item.path)
        except Exception as e:
            failures.append((item.label, _short(e)))
            measurement.inputs.append({"input": item.label, "read_s": _seconds(started), "error": _short(e)})
            done += len(miners)
            continue
        measurement.inputs.append({"input": item.label, "read_s": _seconds(started), **log_size_of_frame(log)})
        for miner in miners:
            label = f"{item.label} / {miner}"
            pct = 100.0 * done / total
            progress(pct, f"{label}: discovering")
            done += 1
            observed: dict[str, Any] = {"observation": label, "input": item.label, "miner": str(miner)}
            measurement.observations.append(observed)
            started = time.perf_counter()
            timing: dict[str, float] = {}
            try:
                net, im, fm = discover(
                    miner, log, item.label, on_wait=lambda msg: progress(pct, f"{label}: {msg}"), timing=timing
                )
            except Exception as e:
                failures.append((label, f"discovery failed: {_short(e)}"))
                observed.update(discovery_s=_seconds(started), error=f"discovery failed: {_short(e)}")
                continue
            # The wall time includes waiting for ProM4Py, which other jobs may hold; run_s is the
            # discovery call alone.
            observed.update(discovery_s=_seconds(started), discovery_run_s=round(timing.get("run_s", 0.0), 6))
            observed["net"] = net_size(net)
            row: dict[str, float] = {}
            stages: dict[str, float] = {}
            for measure in measures:
                progress(100.0 * (done - 1) / total, f"{label}: {measure}")
                started = time.perf_counter()
                try:
                    row[str(measure)] = _number(measure_value(measure, net, im, fm))
                except Exception as e:
                    row[str(measure)] = math.nan
                    failures.append((label, f"{measure}: {_short(e)}"))
                stages[str(measure)] = _seconds(started)
            observed["stages"] = stages
            observed["measures_s"] = round(sum(stages.values()), 6)
            rows[label] = row
    measurement.total_s = _seconds(started_all)
    return ComputeResult(_table(rows, measure_names), failures, measurement)


def model_from_pnml(inputs: list[Input], measure_names: list[str], progress: ProgressFn) -> ComputeResult:
    """Measure Petri nets read from PNML files, with their markings."""
    import pm4py

    from algorithms.comfy import MEASURES_BY_NAME, measure_value

    started_all = time.perf_counter()
    measures = [MEASURES_BY_NAME[n] for n in measure_names]
    measurement = Measurement("model", "pnml")
    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    for i, item in enumerate(inputs):
        progress(100.0 * i / len(inputs), f"Measuring {item.label}")
        started = time.perf_counter()
        try:
            net, im, fm = pm4py.read_pnml(item.path)
        except Exception as e:
            failures.append((item.label, f"not a readable PNML file: {_short(e)}"))
            measurement.inputs.append({"input": item.label, "read_s": _seconds(started), "error": _short(e)})
            continue
        measurement.inputs.append({"input": item.label, "read_s": _seconds(started), "net": net_size(net)})
        row: dict[str, float] = {}
        stages: dict[str, float] = {}
        for measure in measures:
            started = time.perf_counter()
            try:
                row[str(measure)] = _number(measure_value(measure, net, im, fm))
            except Exception as e:
                row[str(measure)] = math.nan
                failures.append((item.label, f"{measure}: {_short(e)}"))
            stages[str(measure)] = _seconds(started)
        measurement.observations.append({
            "observation": item.label,
            "input": item.label,
            "net": net_size(net),
            "stages": stages,
            "measures_s": round(sum(stages.values()), 6),
        })
        rows[item.label] = row
    measurement.total_s = _seconds(started_all)
    return ComputeResult(_table(rows, measure_names), failures, measurement)


def extract_features_timed(
    path: str, features: list[str]
) -> tuple[dict[str, Any], float, dict[str, float], Any, dict[str, str]]:
    """feeed's ``extract_features(path, features)``, step by step so that each step is timed:
    the values, the time to read the log, the time of each feature, the log as read, and the
    error of each feature group that failed (a group stops at its first failing feature).

    The same calls in the same order as feeed 2.2 makes them: read the log with feeed's reader,
    check it, then each feature on its own with the class feeed picks for it. Unlike feeed, a
    group that fails does not end the log: the caller decides what to do with it.
    """
    from feeed import feature_extractor as fx
    from feeed.feature import Feature

    from .catalog import log_group_of

    started = time.perf_counter()
    log = fx.read_pm4py_log(path)
    read_s = _seconds(started)
    Feature.check_log(log, path.replace("\\", "/").rsplit("/", 1)[-1])
    values: dict[str, Any] = {}
    seconds: dict[str, float] = {}
    failed: dict[str, str] = {}
    for name in features:
        group = log_group_of(name) or "other"
        if group in failed:
            continue
        started = time.perf_counter()
        ft_type = fx.feature_type(name)
        kwargs = {"tz": None} if ft_type == "time_based" else {}
        try:
            values.update(getattr(fx, ft_type)(feature_names=[name], **kwargs).extract(log))
        except Exception as e:
            failed[group] = _short(e)
            continue
        seconds[name] = _seconds(started)
    return values, read_s, seconds, log, failed


def _skipped_groups(
    features: list[str], failed_in: dict[str, dict[str, str]]
) -> list[dict[str, Any]]:
    """The groups feeed failed on for some log, as ``ComputeResult.skipped`` has them."""
    from .catalog import log_group_of

    out = []
    for group, errors in failed_in.items():
        error = next(iter(errors.values()))
        out.append({
            "group": group,
            "measures": [f for f in features if (log_group_of(f) or "other") == group],
            # feeed's neighbour-based features index past a log that has too few traces.
            "code": "too_few_traces" if error.startswith("IndexError") else "group_failed",
            "error": error,
            "inputs": list(errors),
        })
    return out


def log_from_logs(inputs: list[Input], features: list[str], progress: ProgressFn) -> ComputeResult:
    """feeed features per log, like ``MeasureEvaluator.collect_log_measure_data`` in ComFy for
    log measures. feeed reads the file itself and needs the ``.xes`` extension. The time of
    each feature is summed per feature group of the catalog.

    A feature group that fails for a log is left out for all logs, so that every log has every
    column; ``skipped`` says which and why. Logs that cannot be read are failures as before."""
    from .catalog import log_group_of

    started_all = time.perf_counter()
    measurement = Measurement("log", "logs")
    rows: dict[str, dict[str, float]] = {}
    failures: list[tuple[str, str]] = []
    failed_in: dict[str, dict[str, str]] = {}
    for i, item in enumerate(inputs):
        progress(100.0 * i / len(inputs), f"Extracting features of {item.label}")
        started = time.perf_counter()
        try:
            values, read_s, seconds, log, failed = extract_features_timed(item.path, features)
        except Exception as e:
            failures.append((item.label, _short(e)))
            measurement.inputs.append({"input": item.label, "error": _short(e)})
            measurement.observations.append({
                "observation": item.label, "input": item.label, "features_s": _seconds(started), "error": _short(e),
            })
            continue
        measurement.inputs.append({"input": item.label, "read_s": read_s, **log_size_of_eventlog(log)})
        for group, error in failed.items():
            failed_in.setdefault(group, {})[item.label] = error
        groups: dict[str, float] = {}
        for name, s in seconds.items():
            group = log_group_of(name) or "other"
            groups[group] = round(groups.get(group, 0.0) + s, 6)
        measurement.observations.append({
            "observation": item.label,
            "input": item.label,
            "stages": groups,
            "features_s": round(sum(seconds.values()), 6),
        })
        rows[item.label] = {f: _number(values.get(f)) for f in features}
    measurement.total_s = _seconds(started_all)
    skipped = _skipped_groups(features, failed_in)
    left_out = {m for group in skipped for m in group["measures"]}
    kept = [f for f in features if f not in left_out]
    return ComputeResult(_table(rows, kept), failures, measurement, skipped)
