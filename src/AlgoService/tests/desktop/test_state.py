"""Name, directories, identity, settings.env and the backend's environment of the launcher."""

from __future__ import annotations

import json
import logging
import os
import stat
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from ._support import DESKTOP  # noqa: F401  (puts the launcher on the path)

from desktop_app import environment, resources, state
from desktop_app.paths import AppPaths, app_name
from desktop_app.state import Identity, LauncherError

SERVICE_DIR = Path(__file__).resolve().parents[2]


def test_the_name_is_read_from_config():
    import config

    assert app_name() == config.APP_NAME


def test_the_folder_is_named_independently_of_the_display_name(monkeypatch):
    """The display name will change; the data of an installation must stay where they are."""
    from desktop_app import paths as paths_module

    assert paths_module.DATA_DIR_NAME == "complexity-factor-analysis"
    paths = AppPaths.for_user()
    for directory in (paths.data, paths.config):
        assert directory.name == "complexity-factor-analysis" or directory.parent.name == "complexity-factor-analysis"
    assert paths.logs.name == "complexity-factor-analysis" or paths.logs.parent.name == "complexity-factor-analysis"
    assert AppPaths.for_user() == AppPaths.for_user(paths_module.DATA_DIR_NAME)

    import config

    monkeypatch.setattr(config, "APP_NAME", "XCom")
    assert AppPaths.for_user() == paths
    assert "xcom" not in str(paths).lower()


@pytest.mark.skipif(os.name == "nt", reason="modes")
def test_a_directory_others_can_write_to_is_refused(tmp_path):
    shared = tmp_path / "shared"
    shared.mkdir()
    shared.chmod(0o777)
    with pytest.raises(LauncherError, match="can be written to by other users"):
        AppPaths.under(shared).create()
    shared.chmod(0o755)  # readable is no problem
    AppPaths.under(shared).create()
    own = tmp_path / "own"
    AppPaths.under(own).create()
    assert stat.S_IMODE(own.stat().st_mode) == 0o700


@pytest.mark.skipif(os.name != "nt", reason="ACLs")
def test_a_new_directory_is_restricted_to_the_user_on_windows(tmp_path):
    fresh = tmp_path / "fresh"
    AppPaths.under(fresh).create()
    out = subprocess.run(["icacls", str(fresh)], capture_output=True, text=True).stdout
    # Not inherited from the parent (which would show BUILTIN\Users or Everyone on a shared drive).
    assert "(I)" not in out
    assert "Everyone" not in out and "BUILTIN\\Users" not in out
    assert (fresh / "artifacts").is_dir()


def test_a_data_dir_holds_everything(tmp_path):
    paths = AppPaths.under(tmp_path / "d")
    assert paths.data == paths.config == (tmp_path / "d").resolve()
    assert paths.logs == paths.data / "logs"
    paths.create()
    assert paths.artifacts.is_dir() and paths.uploads.is_dir() and paths.logs.is_dir()


# --- identity -------------------------------------------------------------------------------


def test_the_first_start_creates_the_identity_and_later_starts_keep_it(tmp_path):
    path = tmp_path / "identity.json"
    first = state.load_or_create_identity(path)
    assert len(first.session_secret_key) >= 48 and uuid.UUID(first.shared_session_id)
    assert json.loads(path.read_text()) == {
        "session_secret_key": first.session_secret_key,
        "shared_session_id": first.shared_session_id,
    }
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert state.load_or_create_identity(path) == first
    assert not path.with_name("identity.json.tmp").exists()


def test_a_missing_key_is_made_and_the_session_kept(tmp_path):
    path = tmp_path / "identity.json"
    session_id = str(uuid.uuid4())
    path.write_text(json.dumps({"shared_session_id": session_id}))
    identity = state.load_or_create_identity(path)
    assert identity.shared_session_id == session_id and len(identity.session_secret_key) >= 48
    assert json.loads(path.read_text())["session_secret_key"] == identity.session_secret_key


@pytest.mark.parametrize("content", ["{", "[]", json.dumps({"shared_session_id": "not-a-uuid"})])
def test_a_broken_identity_stops_the_start(tmp_path, content):
    # A new session id would hide the datasets and runs of the old one.
    path = tmp_path / "identity.json"
    path.write_text(content)
    with pytest.raises(LauncherError, match="identity.json"):
        state.load_or_create_identity(path)
    assert path.read_text() == content


def _database_with_sessions(path, ids):
    import sqlite3

    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE sessions (id VARCHAR(255) PRIMARY KEY)")
        db.executemany("INSERT INTO sessions VALUES (?)", [(i,) for i in ids])


def test_a_lost_identity_takes_the_only_session_of_the_database(tmp_path, caplog):
    session = str(uuid.uuid4())
    _database_with_sessions(tmp_path / "app.db", [session])
    path = tmp_path / "identity.json"
    with caplog.at_level(logging.INFO, logger="desktop"):
        identity = state.load_or_create_identity(path, tmp_path / "app.db")
    assert identity.shared_session_id == session
    assert json.loads(path.read_text())["shared_session_id"] == session
    assert session not in caplog.text and identity.session_secret_key not in caplog.text  # nothing secret in the log
    assert "only session" in caplog.text
    # The next start reads the file.
    assert state.load_or_create_identity(path, tmp_path / "app.db") == identity


def test_a_lost_identity_with_several_sessions_starts_a_new_one_and_warns(tmp_path, caplog):
    sessions = [str(uuid.uuid4()), str(uuid.uuid4())]
    _database_with_sessions(tmp_path / "app.db", sessions)
    with caplog.at_level(logging.WARNING, logger="desktop"):
        identity = state.load_or_create_identity(tmp_path / "identity.json", tmp_path / "app.db")
    assert identity.shared_session_id not in sessions
    assert "holds 2 sessions" in caplog.text and str(tmp_path) in caplog.text
    assert not any(s in caplog.text for s in sessions)


def test_a_lost_identity_without_a_usable_database_is_a_first_start(tmp_path):
    assert uuid.UUID(state.load_or_create_identity(tmp_path / "a.json", tmp_path / "missing.db").shared_session_id)
    (tmp_path / "broken.db").write_text("not a database")
    assert uuid.UUID(state.load_or_create_identity(tmp_path / "b.json", tmp_path / "broken.db").shared_session_id)
    _database_with_sessions(tmp_path / "junk.db", ["not-a-uuid"])
    assert uuid.UUID(state.load_or_create_identity(tmp_path / "c.json", tmp_path / "junk.db").shared_session_id)


def test_an_identity_with_a_session_is_not_replaced_by_the_database(tmp_path):
    kept, other = str(uuid.uuid4()), str(uuid.uuid4())
    _database_with_sessions(tmp_path / "app.db", [other])
    (tmp_path / "identity.json").write_text(json.dumps({"session_secret_key": "k" * 40, "shared_session_id": kept}))
    assert state.load_or_create_identity(tmp_path / "identity.json", tmp_path / "app.db").shared_session_id == kept


# --- settings.env ---------------------------------------------------------------------------


def test_settings_env(tmp_path, caplog):
    path = tmp_path / "settings.env"
    path.write_text(
        "\n".join(
            [
                "# The key for live interpretations",
                "ANTHROPIC_API_KEY=sk-test-secret-value",
                "export INTERPRETATION_MODEL='claude-sonnet-5-5'",
                'INTERPRETATION_EFFORTS="low,medium"  ',
                "PROM4PY_START_WAIT=30 # seconds",
                "SESSION_SECRET_KEY=not-allowed-here",
                "DATABASE_URL=sqlite:///elsewhere.db",
                "this line is wrong",
                "",
            ]
        ),
        encoding="utf-8",
    )
    with caplog.at_level(logging.WARNING, logger="desktop"):
        settings = state.read_settings_env(path)
    assert settings == {
        "ANTHROPIC_API_KEY": "sk-test-secret-value",
        "INTERPRETATION_MODEL": "claude-sonnet-5-5",
        "INTERPRETATION_EFFORTS": "low,medium",
        "PROM4PY_START_WAIT": "30",
    }
    assert "SESSION_SECRET_KEY cannot be set" in caplog.text and "DATABASE_URL cannot be set" in caplog.text
    assert "line 8: not NAME=value" in caplog.text
    for value in ("sk-test-secret-value", "not-allowed-here", "elsewhere.db", "this line is wrong"):
        assert value not in caplog.text


def test_no_settings_env_is_no_settings(tmp_path):
    assert state.read_settings_env(tmp_path / "settings.env") == {}


# --- the backend's environment --------------------------------------------------------------


def _environ(tmp_path, **kwargs):
    paths = AppPaths.under(tmp_path / "data")
    identity = Identity("k" * 64, str(uuid.uuid4()))
    base = {
        "SOME_OTHER_SETTING": "kept",
        "REDIS_URL": "redis://redis:6379/0",
        "RATE_LIMIT_DISABLED": "1",
        "TESTING": "1",
        "TEST_DATABASE_URL": "sqlite:///x.db",
        "SHARED_SESSION_ID": str(uuid.uuid4()),
        "SESSION_SECRET_KEY": "from-the-environment",
        "DATABASE_URL": "postgresql+asyncpg://elsewhere/db",
        "INTERPRETATION_MODEL": "from-the-environment",
        "DATA_MAX_IDLE_DAYS": "7",
    }
    settings = {"INTERPRETATION_MODEL": "from-settings", "ANTHROPIC_API_KEY": "from-settings"}
    build = {"APP_VERSION": "v1.0.0", "APP_COMMIT": "abc123"}
    return paths, identity, environment.backend_environ(base, paths, identity, settings, build, **kwargs)


def test_the_backend_environment(tmp_path):
    paths, identity, env = _environ(tmp_path, rate_limits=True)
    for name in ("REDIS_URL", "RATE_LIMIT_DISABLED", "TESTING", "TEST_DATABASE_URL"):
        assert name not in env
    assert env["DATABASE_URL"] == environment.sqlite_url(paths.database)
    assert env["ARTIFACTS_DIR"] == str(paths.artifacts) and env["UPLOADED_LOGS_DIR"] == str(paths.uploads)
    assert env["SESSION_SECRET_KEY"] == identity.session_secret_key
    assert env["SHARED_SESSION_ID"] == identity.shared_session_id
    for name in ("DATA_MAX_IDLE_DAYS", "MAX_DATASETS_PER_SESSION", "LOW_DISK_CLEANUP_FREE_PCT", "SESSION_MAX_AGE"):
        assert env[name] == "never"
    assert env["OPENBLAS_NUM_THREADS"] == env["VECLIB_MAXIMUM_THREADS"] == "1"
    assert env["FASTAPI_ROOT_PATH"] == "/api"
    assert env["PROM4PY_START_WAIT"] == "2"
    # settings.env and build_info.json fill in; the environment wins over them.
    assert env["ANTHROPIC_API_KEY"] == "from-settings"
    assert env["INTERPRETATION_MODEL"] == "from-the-environment"
    assert (env["APP_VERSION"], env["APP_COMMIT"]) == ("v1.0.0", "abc123")
    assert env["SOME_OTHER_SETTING"] == "kept"


def test_separate_sessions_leave_out_the_shared_id(tmp_path):
    _, _, env = _environ(tmp_path, shared_session=False)
    assert "SHARED_SESSION_ID" not in env


def test_rate_limits_are_off_unless_switched_on(tmp_path):
    """As on the command line (``--rate-limits``): off by default, since they count per address."""
    assert _environ(tmp_path)[2]["RATE_LIMIT_DISABLED"] == "1"
    assert _environ(tmp_path, rate_limits=False)[2]["RATE_LIMIT_DISABLED"] == "1"
    assert "RATE_LIMIT_DISABLED" not in _environ(tmp_path, rate_limits=True)[2]


def test_the_database_url_survives_odd_directory_names(tmp_path):
    from sqlalchemy.engine import make_url

    odd = tmp_path / "XCom" / "50%20 #1" / "app.db"
    assert make_url(environment.sqlite_url(odd)).database == odd.resolve().as_posix()


def test_the_backend_accepts_the_environment(tmp_path):
    """The backend reads the settings at import time; a fresh interpreter shows what it makes of
    them (and a malformed one would stop it)."""
    paths, identity, env = _environ(tmp_path, rate_limits=True)
    env = {**os.environ, **env}
    env.pop("PYTEST_CURRENT_TEST", None)
    env.pop("SOME_OTHER_SETTING", None)
    for name in ("RATE_LIMIT_DISABLED", "TESTING", "TEST_DATABASE_URL", "ANTHROPIC_API_KEY"):
        env.pop(name, None)
    code = (
        "import json, config, database, jobs_db, job_runner\n"
        "from factor_analysis import storage\n"
        "print(json.dumps([database.DATABASE_URL, config.SHARED_SESSION_ID, config.SESSION_MAX_AGE,"
        " config.RATE_LIMIT_DISABLED, storage.MAX_DATASETS_PER_SESSION, storage.SESSION_MAX_IDLE_S,"
        " jobs_db.LOW_DISK_CLEANUP_FREE_PCT, str(jobs_db.ARTIFACTS_DIR), job_runner.runs_jobs_itself()]))"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=SERVICE_DIR, env=env, capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stderr[-3000:]
    url, shared, max_age, no_limits, max_datasets, idle, low_disk, artifacts, in_process = json.loads(
        out.stdout.strip().splitlines()[-1]
    )
    assert url == environment.sqlite_url(paths.database)
    assert shared == identity.shared_session_id
    assert max_age == 10 * 365 * 24 * 3600
    assert no_limits is False  # the rate limits stay on
    assert (max_datasets, idle, low_disk) == (None, None, None)
    assert artifacts == str(paths.artifacts)
    assert in_process is True


# --- build_info.json ------------------------------------------------------------------------


def test_build_info(tmp_path, monkeypatch):
    path = tmp_path / "build_info.json"
    monkeypatch.setattr(resources, "build_info_path", lambda: path)
    assert resources.build_info() == {}
    path.write_text(json.dumps({"APP_VERSION": "v1.0.0", "APP_COMMIT": " abc123 ", "other": "x", "APP_NAME": 1}))
    assert resources.build_info() == {"APP_VERSION": "v1.0.0", "APP_COMMIT": "abc123"}
    path.write_text("{")
    with pytest.raises(RuntimeError, match="build_info.json"):
        resources.build_info()


def test_private_files_are_written_through_a_fresh_owner_only_file(tmp_path):
    """No fixed ``.tmp`` name a planted file or link could sit on; no moment where others can read."""
    import os

    from desktop_app.state import write_private_json, write_private_text

    target = tmp_path / "instance.json"
    secret_target = tmp_path / "elsewhere"
    secret_target.write_text("keep")
    planted = tmp_path / "instance.json.tmp"
    try:
        planted.symlink_to(secret_target)
    except (OSError, NotImplementedError):  # no symlinks for this user (Windows)
        planted.write_text("planted")

    write_private_json(target, {"token": "t"})
    write_private_text(tmp_path / "token", "abc")

    assert target.read_text().count('"token": "t"') == 1
    assert (tmp_path / "token").read_text() == "abc"
    assert secret_target.read_text() == "keep"  # the planted link was not written through
    assert not [p for p in tmp_path.iterdir() if p.name.endswith(".tmp") and p != planted]  # nothing left over
    if os.name != "nt":
        assert target.stat().st_mode & 0o077 == 0 and (tmp_path / "token").stat().st_mode & 0o077 == 0

    write_private_text(target, "second")  # replaces an existing file
    assert target.read_text() == "second"
