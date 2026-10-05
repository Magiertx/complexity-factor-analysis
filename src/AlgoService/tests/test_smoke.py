"""Liveness and algorithm-registry smoke tests.

Confirm the app boots, the registry loads cleanly, and each manifest matches
the schema the frontend expects.
"""

from __future__ import annotations

import pytest


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_algorithms_listing(client):
    r = client.get("/algorithms")
    assert r.status_code == 200
    body = r.json()
    assert {a["id"] for a in body["algorithms"]} == {"comfy"}
    assert [c["id"] for c in body["categories"]] == ["complexity"]


def test_algorithm_manifest_shape(client):
    r = client.get("/algorithms")
    category_ids = {c["id"] for c in r.json()["categories"]}
    for algo in r.json()["algorithms"]:
        assert {"id", "name", "description", "tool_type", "parameters_schema", "citation"} <= set(algo)
        assert algo["tool_type"] in category_ids
        assert isinstance(algo["parameters_schema"], list)
        for spec in algo["parameters_schema"]:
            assert {"name", "label", "type", "default"} <= set(spec)
            assert spec["type"] in {"int", "float", "bool", "enum", "multi_enum", "string"}


def test_app_title_comes_from_config(client):
    import config

    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert r.json()["info"]["title"] == config.APP_NAME


def test_unknown_algorithm_returns_404(client):
    r = client.post(
        "/algorithms/nonexistent/analyze",
        files={"file": ("x.xes", b"<?xml version='1.0'?><log/>", "application/xml")},
    )
    assert r.status_code == 404


def test_invalid_job_id_validation(client):
    # UUID format is expected. Any non-UUID format should return 400
    r = client.get("/jobs/invalid-id")
    assert r.status_code == 400
    assert "Invalid job ID format" in r.json()["detail"]

    r = client.post("/progress/invalid-id/abort")
    assert r.status_code == 400


def test_run_context():
    from algorithms.base import RunContext

    progresses = []

    def progress_cb(pct, msg):
        progresses.append((pct, msg))

    aborted_calls = 0

    def check_aborted_cb():
        nonlocal aborted_calls
        aborted_calls += 1
        return aborted_calls > 1  # Abort on second check

    ctx = RunContext("test_run", progress_cb, check_aborted_cb)
    ctx.progress(10.0, "Test progress")
    assert progresses == [(10.0, "Test progress")]

    ctx.check_aborted()  # Should pass first check
    with pytest.raises(RuntimeError, match="Task aborted by user"):
        ctx.check_aborted()  # Should raise on second check


def test_sample_logs_endpoint(client):
    r = client.get("/sample-logs")
    assert r.status_code == 200
    logs = r.json()
    assert isinstance(logs, list)
    assert [log["id"] for log in logs] == ["sepsis_cases_mini"]
    for log in logs:
        assert {"id", "name", "description", "filename", "size_bytes"} <= set(log)


def test_log_stats_for_sample_log(client):
    r = client.post("/log-stats", data={"sample_log_id": "sepsis_cases_mini"})
    assert r.status_code == 200, r.text
    stats = r.json()["stats"]
    assert stats["num_traces"] > 0
    assert stats["num_events"] >= stats["num_traces"]
    assert "recommendations" not in r.json()


def test_analyze_with_sample_log(client, stub_algorithm):
    r = client.post(f"/algorithms/{stub_algorithm}/analyze", data={"sample_log_id": "sepsis_cases_mini"})
    assert r.status_code == 200, r.text
    submission = r.json()
    assert submission["algorithm"] == stub_algorithm
    assert submission["filename"] == "sepsis_cases_mini.xes"
    assert submission["status"] == "pending"


def test_recent_logs_flow(client, stub_algorithm):
    # 1. Initially recent logs should be empty (or at least check it responds)
    r = client.get("/recent-logs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    # 2. Upload a file to populate recent logs history
    sample_xes = b"<?xml version='1.0'?><log><trace><event><string key='concept:name' value='A'/></event></trace></log>"
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("test_uploaded.xes", sample_xes, "application/xml")},
    )
    assert r.status_code == 200, r.text

    # 3. Check /recent-logs endpoint now contains our uploaded file
    r = client.get("/recent-logs")
    assert r.status_code == 200
    logs = r.json()
    assert any(log["id"] == "test_uploaded.xes" for log in logs)

    # 4. Trigger analysis again using the recent_log_id
    r = client.post(f"/algorithms/{stub_algorithm}/analyze", data={"recent_log_id": "test_uploaded.xes"})
    assert r.status_code == 200, r.text
    submission = r.json()
    assert submission["algorithm"] == stub_algorithm
    assert submission["filename"] == "test_uploaded.xes"
    assert submission["status"] == "pending"

