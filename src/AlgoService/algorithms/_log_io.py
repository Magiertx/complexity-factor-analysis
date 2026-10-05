"""Shared event-log reader supporting .xes / .xes.gz / .xml and .json.

pm4py 2.x no longer ships ``read_json``, so JSON logs are converted here
into a pm4py EventLog. The expected shape is a list of traces, each with
``attributes`` (containing ``concept:name`` as the case id) and a list of
``events``.
"""
from __future__ import annotations

import json
import os
from typing import Any

CASE_KEY = "concept:name"
TIMESTAMP_KEY = "time:timestamp"


def _json_to_eventlog(file_path: str):
    """Read a JSON event log into a pm4py legacy EventLog."""
    from dateutil import parser as date_parser
    from pm4py.objects.log.obj import EventLog, Trace, Event

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON event log could not be parsed: {e}") from None

    log = EventLog()
    if isinstance(data, list):
        for raw_trace in data:
            if not isinstance(raw_trace, dict):
                continue
            case_id = (raw_trace.get("attributes") or {}).get(CASE_KEY)
            if not case_id:
                continue
            trace = Trace()
            trace.attributes[CASE_KEY] = case_id
            for raw_event in raw_trace.get("events") or []:
                if not isinstance(raw_event, dict):
                    continue
                event = {k: v for k, v in raw_event.items() if not k.startswith("case:")}
                ts = event.get(TIMESTAMP_KEY)
                if isinstance(ts, str):
                    try:
                        event[TIMESTAMP_KEY] = date_parser.parse(ts)
                    except (ValueError, OverflowError):
                        del event[TIMESTAMP_KEY]
                trace.append(Event(event))
            if len(trace):
                log.append(trace)

    if not log:
        raise ValueError(
            "JSON event log is empty or malformed. Expected a list of traces, each "
            "with 'attributes' (containing 'concept:name') and 'events'."
        )
    return log


def _log_suffix(file_path: str) -> str:
    lower = file_path.lower()
    if lower.endswith(".xes.gz"):
        return ".xes.gz"
    return os.path.splitext(lower)[1]


# Cap on the decompressed size of a .xes.gz. The upload limit counts compressed bytes, and
# XES compresses 200:1 or more, so a 100 MB upload could expand to tens of gigabytes.
MAX_DECOMPRESSED_BYTES = 1_000 * 1024 * 1024  # 1 GB


def _decompress_to_temp(file_path: str) -> str:
    """Expand a .xes.gz to a temp file, refusing to write more than the cap.

    Returns the temp file's path; the caller deletes it. Decompressing here instead of in
    pm4py enforces the limit and lets the plain-XES checks run on the expanded content.
    """
    import gzip
    import tempfile

    written = 0
    fd, tmp_path = tempfile.mkstemp(suffix=".xes")
    try:
        with gzip.open(file_path, "rb") as src, os.fdopen(fd, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_DECOMPRESSED_BYTES:
                    raise ValueError(
                        f"Compressed log expands beyond the "
                        f"{MAX_DECOMPRESSED_BYTES // (1024 * 1024)} MB limit. "
                        "Upload it uncompressed, or filter it down first."
                    )
                dst.write(chunk)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
    return tmp_path


def read_event_log(file_path: str, *, return_legacy: bool = False) -> Any:
    """Read an event log from disk regardless of format.

    Returns the same object pm4py would for the .xes path:
    a DataFrame by default, or a legacy EventLog when ``return_legacy=True``.
    For .json input we always build the legacy EventLog and coerce to a
    DataFrame on demand so the adapter contract stays consistent.
    """
    import pm4py

    suffix = _log_suffix(file_path)
    if suffix == ".xes.gz":
        expanded = _decompress_to_temp(file_path)
        try:
            if return_legacy:
                return pm4py.read_xes(expanded, return_legacy_log_object=True)
            return pm4py.read_xes(expanded)
        finally:
            try:
                os.remove(expanded)
            except OSError:
                pass
    if suffix in {".xes", ".xml"}:
        if return_legacy:
            return pm4py.read_xes(file_path, return_legacy_log_object=True)
        return pm4py.read_xes(file_path)
    if suffix == ".json":
        log = _json_to_eventlog(file_path)
        if return_legacy:
            return log
        return pm4py.convert_to_dataframe(log)
    raise ValueError(
        f"Unsupported file type '{suffix}'. Use .xes, .xes.gz, .xml, or .json."
    )
