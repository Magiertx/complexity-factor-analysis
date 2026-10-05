"""Secondary files: an auxiliary upload (here a PNML) next to the event log.

The /analyze route parses every file an adapter declares in
``secondary_files``, applies the same extension and XXE checks as for the log,
and hands the adapter a temp path. Exercised through the test-only stub tool.
"""
from __future__ import annotations

import io
import time
from datetime import datetime, timedelta

import pytest


@pytest.fixture
def log_and_pnml(tmp_path):
    """A small two-variant log plus a PNML mined from it with pm4py's
    (pure-Python) inductive miner — guaranteed to have markings."""
    import pm4py
    from pm4py.objects.log.obj import Event, EventLog, Trace

    log = EventLog()
    base = datetime(2024, 1, 1)
    variants = [("register", "review", "approve")] * 4 + [("register", "review", "reject")] * 2
    for i, acts in enumerate(variants):
        trace = Trace()
        trace.attributes["concept:name"] = f"case_{i}"
        for j, act in enumerate(acts):
            ev = Event()
            ev["concept:name"] = act
            ev["time:timestamp"] = base + timedelta(hours=i * 10 + j)
            trace.append(ev)
        log.append(trace)

    log_path = tmp_path / "two_variants.xes"
    pm4py.write_xes(log, str(log_path))

    net, im, fm = pm4py.discover_petri_net_inductive(log)
    pnml_path = tmp_path / "reference.pnml"
    pm4py.write_pnml(net, im, fm, str(pnml_path))

    return log_path.read_bytes(), pnml_path.read_bytes()


def _wait_for_job(client, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}")
        if r.status_code == 200 and r.json().get("status") in {"completed", "failed", "aborted"}:
            return r.json()
        time.sleep(0.1)
    pytest.fail(f"job {job_id} did not finish within {timeout}s")


def test_uploaded_pnml_reaches_the_adapter(client, stub_algorithm, log_and_pnml):
    log_bytes, pnml_bytes = log_and_pnml
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={
            "file": ("two_variants.xes", log_bytes, "application/xml"),
            "reference_pnml": ("reference.pnml", pnml_bytes, "application/xml"),
        },
    )
    assert r.status_code == 200, r.text
    job = _wait_for_job(client, r.json()["job_id"])
    assert job["status"] == "completed", f"job failed: {job.get('error')}"

    stats = {a["label"]: a["value"] for a in job["result"]["artifacts"] if a["kind"] == "stat"}
    # The adapter sees the name the user uploaded, not the server-side temp path.
    assert stats["Reference net"] == "reference.pnml"
    assert stats["Cases"] == 6


def test_secondary_file_rejects_bad_extension(client, stub_algorithm, log_and_pnml):
    log_bytes, _ = log_and_pnml
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={
            "file": ("two_variants.xes", log_bytes, "application/xml"),
            "reference_pnml": ("model.exe", b"MZbinary", "application/octet-stream"),
        },
    )
    assert r.status_code == 400
    assert "Invalid extension" in r.json()["detail"]


def test_secondary_file_rejects_doctype(client, stub_algorithm, log_and_pnml):
    """The XXE shield applies to secondary XML files too."""
    log_bytes, _ = log_and_pnml
    xxe_pnml = (
        b"<?xml version='1.0'?>\n"
        b"<!DOCTYPE pnml [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>\n"
        b"<pnml><net/></pnml>"
    )
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={
            "file": ("two_variants.xes", log_bytes, "application/xml"),
            "reference_pnml": ("evil.pnml", xxe_pnml, "application/xml"),
        },
    )
    assert r.status_code == 400
    assert "Security validation failed" in r.json()["detail"]


def test_manifest_declares_secondary_file(client, stub_algorithm):
    r = client.get("/algorithms")
    assert r.status_code == 200
    manifest = next(a for a in r.json()["algorithms"] if a["id"] == stub_algorithm)
    secondary = manifest.get("secondary_files") or []
    assert len(secondary) == 1
    assert secondary[0]["name"] == "reference_pnml"
    assert secondary[0]["optional"] is True
