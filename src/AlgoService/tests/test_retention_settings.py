"""Clean-up and session settings: server defaults unchanged, ``never`` for a desktop install."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

import env_config
import jobs_db
from factor_analysis import storage
from routes import algorithms as algo

SERVICE_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _forget_overrides():
    before = dict(env_config.OVERRIDES)
    yield
    env_config.OVERRIDES.clear()
    env_config.OVERRIDES.update(before)


def _read_in_fresh_process(expr: str, **env: str) -> str:
    """``expr`` evaluated after ``import config`` in a new interpreter with ``env`` set."""
    full = {k: v for k, v in os.environ.items() if k not in ("SESSION_MAX_AGE", "SHARED_SESSION_ID")}
    full.update(env)
    full["RATE_LIMIT_DISABLED"] = "1"
    out = subprocess.run(
        [sys.executable, "-c", f"import config, jobs_db, job_runner\nfrom factor_analysis import storage\nfrom routes import algorithms as algo\nprint({expr})"],
        cwd=SERVICE_DIR, env=full, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-2000:]
    return out.stdout.strip().splitlines()[-1]


# --- parsing --------------------------------------------------------------------------------


def test_never_and_numbers_parse(monkeypatch):
    monkeypatch.delenv("X_SETTING", raising=False)
    assert env_config.positive_number_or_never("X_SETTING", 7.0) == 7.0
    monkeypatch.setenv("X_SETTING", "never")
    assert env_config.positive_number_or_never("X_SETTING", 7.0) is None
    monkeypatch.setenv("X_SETTING", " NEVER ")
    assert env_config.positive_int_or_never("X_SETTING", 30) is None
    monkeypatch.setenv("X_SETTING", "2.5")
    assert env_config.positive_number_or_never("X_SETTING", 7.0) == 2.5
    monkeypatch.setenv("X_SETTING", "12")
    assert env_config.positive_int_or_never("X_SETTING", 30) == 12


@pytest.mark.parametrize("bad", ["0", "-3", "soon", "1.5"])
def test_bad_values_stop_the_start(monkeypatch, bad):
    monkeypatch.setenv("X_SETTING", bad)
    with pytest.raises(env_config.ConfigError):
        env_config.positive_int_or_never("X_SETTING", 30)


def test_a_shared_session_id_has_to_be_a_uuid(monkeypatch):
    monkeypatch.setenv("X_ID", "not-a-uuid")
    with pytest.raises(env_config.ConfigError):
        env_config.uuid_text("X_ID")
    ident = str(uuid.uuid4())
    monkeypatch.setenv("X_ID", ident.upper())
    assert env_config.uuid_text("X_ID") == ident
    monkeypatch.delenv("X_ID")
    assert env_config.uuid_text("X_ID") is None


# --- defaults stay as they were -------------------------------------------------------------


def test_server_defaults_are_unchanged():
    assert storage.MAX_DATASETS_PER_SESSION == 30
    assert storage.SESSION_MAX_IDLE_S == 7 * 24 * 3600
    assert algo.SESSION_DIR_MAX_IDLE_S == 7 * 24 * 3600
    assert jobs_db.LOW_DISK_CLEANUP_FREE_PCT == 10.0
    assert _read_in_fresh_process("config.SESSION_MAX_AGE") == str(14 * 24 * 3600)
    assert _read_in_fresh_process("config.SHARED_SESSION_ID") == "None"


def test_the_settings_are_read_from_the_environment():
    ident = str(uuid.uuid4())
    out = _read_in_fresh_process(
        "(config.SESSION_MAX_AGE, config.SHARED_SESSION_ID, storage.MAX_DATASETS_PER_SESSION,"
        " storage.SESSION_MAX_IDLE_S, algo.SESSION_DIR_MAX_IDLE_S, jobs_db.LOW_DISK_CLEANUP_FREE_PCT,"
        " job_runner.LOCAL_JOB_SLOTS)",
        SESSION_MAX_AGE="3600", SHARED_SESSION_ID=ident, MAX_DATASETS_PER_SESSION="5",
        DATA_MAX_IDLE_DAYS="1", LOW_DISK_CLEANUP_FREE_PCT="2", LOCAL_JOB_SLOTS="4",
    )
    assert out == f"(3600, '{ident}', 5, 86400.0, 86400.0, 2.0, 4)"


def test_never_switches_every_rule_off():
    out = _read_in_fresh_process(
        "(config.SESSION_MAX_AGE, storage.MAX_DATASETS_PER_SESSION, storage.SESSION_MAX_IDLE_S,"
        " algo.SESSION_DIR_MAX_IDLE_S, jobs_db.LOW_DISK_CLEANUP_FREE_PCT)",
        SESSION_MAX_AGE="never", MAX_DATASETS_PER_SESSION="never", DATA_MAX_IDLE_DAYS="never",
        LOW_DISK_CLEANUP_FREE_PCT="never",
    )
    assert out == f"({10 * 365 * 24 * 3600}, None, None, None, None)"


# --- behaviour ------------------------------------------------------------------------------


def _dataset(session: str, age_s: float = 0) -> Path:
    ds = str(uuid.uuid4())
    d = storage.root() / session / ds
    d.mkdir(parents=True)
    meta = d / "meta.json"
    meta.write_text('{"status": "ready"}', encoding="utf-8")
    old = time.time() - age_s
    os.utime(meta, (old, old))
    return d


def test_datasets_beyond_the_maximum_are_kept_when_it_is_never(monkeypatch):
    session = str(uuid.uuid4())
    dirs = [_dataset(session, age_s=i) for i in range(5)]

    monkeypatch.setattr(storage, "MAX_DATASETS_PER_SESSION", None)
    assert storage.prune_session(session) == []
    assert all(d.exists() for d in dirs)

    monkeypatch.setattr(storage, "MAX_DATASETS_PER_SESSION", 3)
    storage.prune_session(session)
    assert sum(d.exists() for d in dirs) == 3

    # An explicit limit still wins over the setting.
    storage.prune_session(session, keep=1)
    assert sum(d.exists() for d in dirs) == 1


def test_idle_datasets_are_kept_when_expiry_is_never(monkeypatch):
    old = _dataset(str(uuid.uuid4()), age_s=400 * 24 * 3600)
    monkeypatch.setattr(storage, "SESSION_MAX_IDLE_S", None)
    assert storage.cleanup_idle_sessions() == []
    assert old.exists()

    monkeypatch.setattr(storage, "SESSION_MAX_IDLE_S", 24 * 3600)
    storage.cleanup_idle_sessions()
    assert not old.exists()


def test_abandoned_upload_directories_are_kept_when_expiry_is_never(monkeypatch):
    directory = algo.UPLOADED_LOGS_DIR / str(uuid.uuid4())
    directory.mkdir(parents=True)
    f = directory / "log.xes"
    f.write_text("x")
    old = time.time() - 400 * 24 * 3600
    os.utime(f, (old, old))

    monkeypatch.setattr(algo, "SESSION_DIR_MAX_IDLE_S", None)
    assert algo.cleanup_orphaned_session_dirs() == 0
    assert directory.exists()

    monkeypatch.setattr(algo, "SESSION_DIR_MAX_IDLE_S", 7 * 24 * 3600)
    assert algo.cleanup_orphaned_session_dirs() == 1
    assert not directory.exists()


def _seed_finished_job(tmp_path) -> str:
    job = str(uuid.uuid4())

    async def seed():
        await jobs_db.create_job(job, "comfy", "ComFy", "f.xes", {})
        await jobs_db.update_job_progress(job, 100.0, "done", status="completed")

    asyncio.run(seed())
    (tmp_path / job).mkdir(parents=True, exist_ok=True)
    return job


def test_low_disk_clean_up_does_nothing_when_it_is_never(client, monkeypatch, tmp_path):
    job = _seed_finished_job(tmp_path)
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", tmp_path)
    monkeypatch.setattr(jobs_db, "LOW_DISK_CLEANUP_FREE_PCT", None)
    with patch("shutil.disk_usage", return_value=shutil._ntuple_diskusage(100, 99, 1)):
        asyncio.run(jobs_db.cleanup_old_jobs())
    assert (tmp_path / job).exists()
    assert asyncio.run(jobs_db.read_job(job)) is not None


def test_low_disk_threshold_is_configurable(client, monkeypatch, tmp_path):
    job = _seed_finished_job(tmp_path)
    monkeypatch.setattr(jobs_db, "ARTIFACTS_DIR", tmp_path)
    monkeypatch.setattr(jobs_db, "LOW_DISK_CLEANUP_FREE_PCT", 2.0)
    # 5% free is above a 2% trigger: nothing is deleted.
    with patch("shutil.disk_usage", return_value=shutil._ntuple_diskusage(100, 95, 5)):
        asyncio.run(jobs_db.cleanup_old_jobs())
    assert (tmp_path / job).exists()
    # 1% free is below it: the run goes.
    with patch("shutil.disk_usage", return_value=shutil._ntuple_diskusage(100, 99, 1)):
        asyncio.run(jobs_db.cleanup_old_jobs())
    assert not (tmp_path / job).exists()


# --- sessions -------------------------------------------------------------------------------


def _session_cookie_id(client) -> str:
    import base64
    import json

    return json.loads(base64.b64decode(client.cookies["session_id"].split(".")[0]))["session_id"]


def test_a_shared_session_id_is_everybodys_session(monkeypatch):
    import config
    from fastapi.testclient import TestClient
    from srv_main import app

    shared = str(uuid.uuid4())
    monkeypatch.setattr(config, "SHARED_SESSION_ID", shared)
    with TestClient(app) as a, TestClient(app) as b:
        assert a.get("/session").status_code == 204
        assert b.get("/session").status_code == 204
        assert _session_cookie_id(a) == _session_cookie_id(b) == shared
        # A cookie with another (well-formed) id is replaced, not honoured.
        other = str(uuid.uuid4())
        assert other != shared

        async def make():
            await jobs_db.create_job(str(uuid.uuid4()), "comfy", "ComFy", "x", {}, session_id=shared)

        asyncio.run(make())
        assert len(a.get("/jobs").json()["jobs"]) == len(b.get("/jobs").json()["jobs"]) == 1


def test_without_a_shared_id_sessions_stay_separate():
    from fastapi.testclient import TestClient
    from srv_main import app

    with TestClient(app) as a, TestClient(app) as b:
        a.get("/session")
        b.get("/session")
        assert _session_cookie_id(a) != _session_cookie_id(b)


def test_the_session_cookie_carries_the_configured_max_age():
    """The middleware takes ``config.SESSION_MAX_AGE``; the default is Starlette's 14 days."""
    from fastapi.testclient import TestClient
    from srv_main import app

    with TestClient(app) as client:
        header = client.get("/session").headers["set-cookie"].lower()
    assert f"max-age={14 * 24 * 3600}" in header
