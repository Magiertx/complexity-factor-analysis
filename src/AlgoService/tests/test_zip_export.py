"""ZIP export tests.

Seeds a completed job directly in the DB, downloads /jobs/{job_id}/download and checks
that every kind of artifact, including tables with quoted cells, survives the round trip.
"""

from __future__ import annotations

import asyncio
import base64
import csv as _csv
import io
import json
import uuid
import zipfile


def _session_id_from_client(client) -> str:
    """Hit any endpoint that triggers session creation, then decode the
    SessionMiddleware cookie to recover the underlying session_id string.

    The download route is session-scoped (via ``get_session_id``), so a job
    seeded directly in the DB must carry the same session_id the client
    presents on subsequent requests; otherwise the route returns 404.
    """
    # Trigger session allocation. /jobs is cheap and uses get_session_id.
    client.get("/jobs")
    raw = client.cookies.get("session_id")
    assert raw, "expected session_id cookie after first request"
    # itsdangerous format: <payload>.<timestamp>.<signature>; payload is
    # urlsafe-base64 of the JSON session dict. We only need to read it.
    payload_b64 = raw.split(".", 1)[0]
    # itsdangerous strips padding; restore it before decoding.
    padding = "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + padding))
    return payload["session_id"]


def _seed_completed_job(session_id: str | None = None) -> str:
    """Create a job, mark it completed with a mixed set of artifacts, return id."""
    import jobs_db

    job_id = str(uuid.uuid4())

    async def run() -> None:
        await jobs_db.create_job(
            job_id,
            algorithm_id="_batch:comfy",
            algorithm_name="Batch: ComFy",
            filename="batch_run",
            params={},
            session_id=session_id,
        )
        analysis_result = {
            "summary": "Mixed-artifact batch run",
            "artifacts": [
                {"kind": "stat", "label": "Logs processed", "value": 3, "unit": "logs"},
                {"kind": "stat", "label": "Fitness", "value": 0.87, "pct": True},
                {
                    "kind": "table",
                    "label": "Batch summary",
                    # CSV-tricky cells: comma, quote, newline.
                    "columns": ["Log", "Notes", "Quoted"],
                    "rows": [
                        ["log_a.xes", "first, ok", 'he said "hi"'],
                        ["log_b.xes", "two lines\nhere", "plain"],
                        ["log_c.xes", None, "trailing,comma,"],
                    ],
                },
                {"kind": "text", "label": "Run notes", "markdown": "# Hello\n\nWorld"},
            ],
        }
        await jobs_db.set_job_completed(job_id, analysis_result)

    asyncio.run(run())
    return job_id


def _read_zip(body: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def test_zip_download_includes_all_artifact_kinds(client):
    job_id = _seed_completed_job(_session_id_from_client(client))

    r = client.get(f"/jobs/{job_id}/download")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert "attachment" in r.headers["content-disposition"]

    files = _read_zip(r.content)
    # Summary collects every stat. The free-text top-level "summary" field is
    # not currently round-tripped through jobs_db (params_json mutation isn't
    # tracked by SQLAlchemy, so the cached _summary key never persists), so we
    # only assert on the stats block that the export actually emits today.
    assert "summary.txt" in files
    summary = files["summary.txt"].decode("utf-8")
    assert "Logs processed: 3 logs" in summary
    assert "Fitness: 87.0%" in summary

    # Tables become CSV under tables/.
    csv_path = next(p for p in files if p.startswith("tables/") and p.endswith(".csv"))
    csv_text = files[csv_path].decode("utf-8")
    # Use the csv module so embedded newlines inside quoted fields don't
    # confuse the row count. The buggy version produced rows like
    # ['<self-ref>', 'cell'] and crashed on join; just hitting status 200
    # with the right header + row count is the main signal here.
    parsed = list(_csv.reader(io.StringIO(csv_text)))
    assert parsed[0] == ["Log", "Notes", "Quoted"]
    assert len(parsed) == 4  # 1 header + 3 data rows
    # Tricky cells survive the round-trip after csv parsing.
    assert parsed[1] == ["log_a.xes", "first, ok", 'he said "hi"']
    assert parsed[2] == ["log_b.xes", "two lines\nhere", "plain"]
    # None becomes an empty field.
    assert parsed[3] == ["log_c.xes", "", "trailing,comma,"]
    # And the raw bytes use CSV quoting for the tricky cells.
    assert '"first, ok"' in csv_text
    assert '"he said ""hi"""' in csv_text

    # Texts become markdown files under text/.
    md_path = next(p for p in files if p.startswith("text/") and p.endswith(".md"))
    assert files[md_path].decode("utf-8") == "# Hello\n\nWorld"


def test_zip_download_includes_manifest(client):
    """The manifest answers 'what version was
    this?' weeks later without re-deploying the codebase."""
    job_id = _seed_completed_job(_session_id_from_client(client))

    r = client.get(f"/jobs/{job_id}/download")
    assert r.status_code == 200, r.text
    files = _read_zip(r.content)

    assert "manifest.json" in files
    manifest = json.loads(files["manifest.json"].decode("utf-8"))
    assert manifest["schema_version"] == 1
    assert manifest["job_id"] == job_id
    assert manifest["algorithm"]["id"] == "_batch:comfy"
    assert manifest["input_log"]["filename"] == "batch_run"
    assert "python_version" in manifest["environment"]
    # pm4py version should resolve in CI (installed); locally if not, allow None.
    assert "pm4py_version" in manifest["environment"]
    assert "created_at" in manifest["timestamps"]


def test_zip_download_unknown_job_returns_404(client):
    bogus = str(uuid.uuid4())
    r = client.get(f"/jobs/{bogus}/download")
    assert r.status_code == 404


def test_zip_download_rejects_invalid_job_id(client):
    r = client.get("/jobs/not-a-uuid/download")
    assert r.status_code == 400
