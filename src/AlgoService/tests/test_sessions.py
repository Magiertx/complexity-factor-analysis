"""Tests for session-based user isolation and scoping."""

from __future__ import annotations

from fastapi.testclient import TestClient
from srv_main import app


def test_session_isolation(tmp_path, monkeypatch, stub_algorithm):
    """Test that two separate API clients have completely isolated job lists,
    recent log files, and cannot read, delete, abort, or download each other's jobs."""
    import jobs_db
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", tmp_path)

    # We create two distinct clients to simulate two separate users/browsers (different cookies)
    with TestClient(app) as client_a:
        with TestClient(app) as client_b:
            # 1. Verify initial states are empty
            r = client_a.get("/jobs")
            assert r.status_code == 200
            assert len(r.json()["jobs"]) == 0

            r = client_b.get("/jobs")
            assert r.status_code == 200
            assert len(r.json()["jobs"]) == 0

            # 2. Client A uploads a log and triggers analysis
            sample_xes = b"<?xml version='1.0'?><log><trace><event><string key='concept:name' value='A'/></event></trace></log>"
            r = client_a.post(
                f"/algorithms/{stub_algorithm}/analyze",
                files={"file": ("log_a.xes", sample_xes, "application/xml")}
            )
            assert r.status_code == 200, r.text
            job_a_id = r.json()["job_id"]

            # 3. Client B uploads a different log and triggers analysis
            r = client_b.post(
                f"/algorithms/{stub_algorithm}/analyze",
                files={"file": ("log_b.xes", sample_xes, "application/xml")}
            )
            assert r.status_code == 200, r.text
            job_b_id = r.json()["job_id"]

            # 4. Verify list jobs isolation
            r = client_a.get("/jobs")
            jobs_a = r.json()["jobs"]
            assert len(jobs_a) == 1
            assert jobs_a[0]["id"] == job_a_id

            r = client_b.get("/jobs")
            jobs_b = r.json()["jobs"]
            assert len(jobs_b) == 1
            assert jobs_b[0]["id"] == job_b_id

            # 5. Verify recent logs listing isolation
            r = client_a.get("/recent-logs")
            logs_a = r.json()
            assert any(log["id"] == "log_a.xes" for log in logs_a)
            assert not any(log["id"] == "log_b.xes" for log in logs_a)

            r = client_b.get("/recent-logs")
            logs_b = r.json()
            assert any(log["id"] == "log_b.xes" for log in logs_b)
            assert not any(log["id"] == "log_a.xes" for log in logs_b)

            # 6. Verify cross-client job detail access rejection
            r = client_a.get(f"/jobs/{job_b_id}")
            assert r.status_code == 404

            r = client_b.get(f"/jobs/{job_a_id}")
            assert r.status_code == 404

            # Verify Client A can view their own job
            r = client_a.get(f"/jobs/{job_a_id}")
            assert r.status_code == 200

            # 7. Verify cross-client deletion rejection
            r = client_a.delete(f"/jobs/{job_b_id}")
            assert r.status_code == 404

            # 8. Verify cross-client abort rejection
            r = client_a.post(f"/progress/{job_b_id}/abort")
            assert r.status_code == 404

            # 9. Verify cross-client download rejection
            r = client_a.get(f"/jobs/{job_b_id}/download")
            assert r.status_code == 404


def _session_of(client: TestClient) -> str:
    """The session id inside the signed cookie of the client: base64 of the JSON, then the signature."""
    import base64
    import json

    return json.loads(base64.b64decode(client.cookies["session_id"].split(".")[0]))["session_id"]


def test_session_endpoint_starts_a_session_once():
    """The frontend asks for the cookie before its page sends anything, so that the requests
    a page fires at once do not each start a session of their own."""
    import uuid

    with TestClient(app) as client:
        r = client.get("/session")
        assert r.status_code == 204 and r.content == b""
        assert "session_id" in r.headers["set-cookie"] and "httponly" in r.headers["set-cookie"].lower()
        first = _session_of(client)
        uuid.UUID(first)

        # Asked again with the cookie, it keeps the session; so do the requests of the page.
        assert client.get("/session").status_code == 204
        assert client.get("/jobs").status_code == 200
        assert client.get("/factor-analysis/datasets").status_code == 200
        assert _session_of(client) == first


def test_session_endpoint_replaces_a_cookie_the_server_cannot_read():
    """A cookie signed with another key (the secret changed) counts as none."""
    with TestClient(app) as client:
        client.cookies.set("session_id", "e30=.AAAAAA.not-a-signature", domain="testserver.local")
        r = client.get("/session")
        assert r.status_code == 204 and "session_id=" in r.headers["set-cookie"]
        assert len(_session_of(client)) == 36


def test_session_endpoint_does_not_touch_the_database(monkeypatch):
    import jobs_db

    async def _fail(_session_id):
        raise AssertionError("the session is not stored before its first real request")

    monkeypatch.setattr(jobs_db, "get_or_create_session", _fail)
    with TestClient(app) as client:
        assert client.get("/session").status_code == 204

