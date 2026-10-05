"""Cheap descriptive statistics for the log overview card.

Reads the uploaded log with pm4py and derives a handful of counts (traces,
events, activities, variants), the trace-length distribution, the time range
and the most frequent activities.
"""

from __future__ import annotations

from typing import Any


def compute_log_stats(file_path: str) -> dict[str, Any]:
    """Compute cheap descriptive stats for an event log.

    Returns a dict with the core counts (`num_traces`, `num_events`,
    `num_activities`, `num_variants`, `variant_to_trace_ratio`,
    `avg_trace_length`), plus time range and trace-length distribution
    (`min_trace_length`, `max_trace_length`, `median_trace_length`),
    `time_range_start` / `time_range_end` as ISO strings (or None), and
    `top_activities` (a list of `[name, count]` for the most-frequent
    activities). Raises if pm4py can't parse the log — callers should
    translate that into HTTP 400.
    """
    import pm4py
    from algorithms._log_io import read_event_log

    log = read_event_log(file_path)
    num_events = int(len(log))
    has_case = "case:concept:name" in log.columns
    has_act = "concept:name" in log.columns

    num_traces = int(log["case:concept:name"].nunique()) if has_case else 0
    num_activities = int(log["concept:name"].nunique()) if has_act else 0

    try:
        variants = pm4py.get_variants(log)
        num_variants = len(variants)
    except Exception:
        if has_case and has_act:
            seqs = log.groupby("case:concept:name")["concept:name"].apply(tuple)
            num_variants = int(seqs.nunique())
        else:
            num_variants = 0

    variant_ratio = num_variants / num_traces if num_traces else 0.0
    avg_trace_length = num_events / num_traces if num_traces else 0.0

    # Trace-length distribution
    min_tl = max_tl = med_tl = 0
    if has_case:
        try:
            lengths = log.groupby("case:concept:name").size()
            min_tl = int(lengths.min())
            max_tl = int(lengths.max())
            med_tl = int(lengths.median())
        except Exception:
            pass

    # Time range
    time_start = time_end = None
    if "time:timestamp" in log.columns:
        try:
            ts = log["time:timestamp"].dropna()
            if not ts.empty:
                time_start = ts.min().isoformat()
                time_end = ts.max().isoformat()
        except Exception:
            pass

    # Top activities by occurrence
    top_activities: list[list[Any]] = []
    if has_act:
        try:
            counts = log["concept:name"].value_counts().head(5)
            top_activities = [[str(name), int(c)] for name, c in counts.items()]
        except Exception:
            pass

    return {
        "num_traces": num_traces,
        "num_events": num_events,
        "num_activities": num_activities,
        "num_variants": num_variants,
        "variant_to_trace_ratio": round(variant_ratio, 4),
        "avg_trace_length": round(avg_trace_length, 2),
        "min_trace_length": min_tl,
        "max_trace_length": max_tl,
        "median_trace_length": med_tl,
        "time_range_start": time_start,
        "time_range_end": time_end,
        "top_activities": top_activities,
    }
