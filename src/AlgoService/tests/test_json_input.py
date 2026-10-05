"""JSON event logs: the reader itself and an end-to-end run through the API.

pm4py 2.x has no JSON reader, so ``algorithms/_log_io.read_event_log``
converts the JSON shape (a list of traces with ``attributes`` and
``events``) into a pm4py EventLog. The end-to-end test uses the stub tool
because it needs no ProM4Py.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

SAMPLE = Path(__file__).resolve().parent.parent / "sample_logs" / "small_example.xes"


def _build_json_log_bytes() -> bytes:
    """Convert the sample log to the JSON shape the reader expects."""
    import pm4py

    log = pm4py.read_xes(str(SAMPLE), return_legacy_log_object=True)
    traces = []
    for trace in log:
        events = []
        for ev in trace:
            event = {k: v for k, v in ev.items() if isinstance(v, (str, int, float))}
            if "time:timestamp" in ev:
                event["time:timestamp"] = ev["time:timestamp"].isoformat()
            events.append(event)
        traces.append({"attributes": {"concept:name": trace.attributes["concept:name"]}, "events": events})
    return json.dumps(traces).encode("utf-8")


@pytest.fixture
def json_log_bytes() -> bytes:
    return _build_json_log_bytes()


def _expected_counts() -> tuple[int, int]:
    import pm4py

    log = pm4py.read_xes(str(SAMPLE), return_legacy_log_object=True)
    return len(log), sum(len(t) for t in log)


def test_json_reader_matches_the_xes_original(tmp_path, json_log_bytes):
    from algorithms._log_io import read_event_log

    path = tmp_path / "log.json"
    path.write_bytes(json_log_bytes)

    log = read_event_log(str(path), return_legacy=True)
    assert (len(log), sum(len(t) for t in log)) == _expected_counts()

    df = read_event_log(str(path))
    assert {"case:concept:name", "concept:name", "time:timestamp"} <= set(df.columns)


@pytest.mark.parametrize("content", [b"{not json", b"[]", b'[{"events": []}]'])
def test_json_reader_rejects_unusable_input(tmp_path, content):
    from algorithms._log_io import read_event_log

    path = tmp_path / "bad.json"
    path.write_bytes(content)
    with pytest.raises(ValueError):
        read_event_log(str(path))


def _wait_for_job(client, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}")
        if r.status_code == 200 and r.json().get("status") in {"completed", "failed", "aborted"}:
            return r.json()
        time.sleep(0.1)
    pytest.fail(f"job {job_id} did not finish within {timeout}s")


def test_json_upload_runs_end_to_end(client, stub_algorithm, json_log_bytes):
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("sample.json", json_log_bytes, "application/json")},
    )
    assert r.status_code == 200, r.text
    submission = r.json()
    assert submission["filename"] == "sample.json"

    job = _wait_for_job(client, submission["job_id"])
    assert job["status"] == "completed", f"job failed: {job.get('error')}"

    stats = {a["label"]: a["value"] for a in job["result"]["artifacts"] if a["kind"] == "stat"}
    assert (stats["Cases"], stats["Events"]) == _expected_counts()
