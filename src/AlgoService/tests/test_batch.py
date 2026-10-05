"""Batch endpoint tests.

The batch endpoint runs one algorithm over N logs and aggregates per-log
stats into a single table, while individual failures are captured in a
"Failed logs" table without stopping the batch. Both behaviors need
explicit coverage; they were unguarded before this file landed.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

import pytest


def _build_log_bytes(tmp_path, name: str, num_traces: int) -> bytes:
    import pm4py
    from pm4py.objects.log.obj import Event, EventLog, Trace

    log = EventLog()
    base = datetime(2024, 1, 1)
    for i in range(num_traces):
        trace = Trace()
        trace.attributes["concept:name"] = f"{name}_case_{i}"
        for j, act in enumerate(["register", "review", "approve"]):
            ev = Event()
            ev["concept:name"] = act
            ev["time:timestamp"] = base + timedelta(hours=i * 10 + j)
            trace.append(ev)
        log.append(trace)

    path = tmp_path / f"{name}.xes"
    pm4py.write_xes(log, str(path))
    return path.read_bytes()


@pytest.fixture
def two_logs(tmp_path) -> list[tuple[str, bytes]]:
    return [
        ("log_a.xes", _build_log_bytes(tmp_path, "log_a", 6)),
        ("log_b.xes", _build_log_bytes(tmp_path, "log_b", 4)),
    ]


def _wait_for_job(client, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}")
        if r.status_code == 200 and r.json().get("status") in {"completed", "failed", "aborted"}:
            return r.json()
        time.sleep(0.1)
    pytest.fail(f"job {job_id} did not finish within {timeout}s")


def test_batch_runs_over_two_logs(client, stub_algorithm, two_logs):
    """Two logs, single algorithm. The batch summary table should hold one
    row per log; per-log artifacts get prefixed with [filename]."""
    r = client.post(
        f"/algorithms/{stub_algorithm}/batch",
        files=[("files", (name, data, "application/xml")) for name, data in two_logs],
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    job = _wait_for_job(client, job_id)
    assert job["status"] == "completed", f"batch failed: {job.get('error')}"

    artifacts = job["result"]["artifacts"]
    # Match the summary table by label prefix only.
    summary = next(
        (a for a in artifacts if a["kind"] == "table" and a.get("label", "").startswith("Batch summary")),
        None,
    )
    assert summary is not None, "Batch summary table missing"
    # One row per log + header is in `columns`.
    assert len(summary["rows"]) == 2
    log_names_in_rows = {row[0] for row in summary["rows"]}
    assert log_names_in_rows == {"log_a.xes", "log_b.xes"}

    # Per-log artifacts must carry [filename] prefix so users can tell them apart.
    per_log_labels = [a.get("label", "") for a in artifacts if a["kind"] != "stat"]
    assert any("[log_a.xes]" in lbl for lbl in per_log_labels), "log_a artifacts unprefixed"
    assert any("[log_b.xes]" in lbl for lbl in per_log_labels), "log_b artifacts unprefixed"


def test_batch_rejects_empty_input(client, stub_algorithm):
    """No files, no sample ids, no recent ids → 400, not a stuck job."""
    r = client.post(f"/algorithms/{stub_algorithm}/batch", data={})
    assert r.status_code == 400
    assert "at least one log" in r.json()["detail"].lower()


def test_batch_rejects_unknown_algorithm(client, two_logs):
    """Wrong algorithm_id in URL → 404, no DB job created."""
    r = client.post(
        "/algorithms/not_a_real_algo/batch",
        files=[("files", (name, data, "application/xml")) for name, data in two_logs[:1]],
    )
    assert r.status_code == 404


def test_batch_failed_log_does_not_kill_run(client, stub_algorithm, two_logs):
    """If one log inside a batch fails parsing, the rest must still complete
    and the failed log shows up in the 'Failed logs' table."""
    # Construct a file that survives the upload-side lxml validator (must be
    # well-formed XML) but crashes once the tool tries to interpret it as
    # an XES log. Plain garbage gets rejected at upload; empty XES is treated
    # as a zero-trace log. Valid XML in a non-XES shape is the right wedge.
    bad_bytes = b'<?xml version="1.0"?><root><not-a-trace/></root>'

    files = [("files", ("ok.xes", two_logs[0][1], "application/xml")),
             ("files", ("broken.xes", bad_bytes, "application/xml"))]

    r = client.post(
        f"/algorithms/{stub_algorithm}/batch",
        files=files,
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    job = _wait_for_job(client, job_id, timeout=90.0)
    # Even with one failure inside, the batch as a whole completes.
    assert job["status"] == "completed", f"batch crashed instead of capturing failure: {job.get('error')}"

    artifacts = job["result"]["artifacts"]
    failed_tbl = next(
        (a for a in artifacts if a["kind"] == "table" and a.get("label") == "Failed logs"),
        None,
    )
    # The "Failed logs" table is the contract for per-log failure containment.
    assert failed_tbl is not None, "Failed logs table missing despite a known-broken input"
    failed_names = {row[0] for row in failed_tbl["rows"]}
    assert "broken.xes" in failed_names
