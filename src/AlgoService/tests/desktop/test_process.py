"""``python -m desktop_app`` as a process: first start, a second start, Ctrl+C, a restart."""

from __future__ import annotations

import http.client
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

from ._support import DESKTOP, HTML, cookie_session_id

#: A cold start imports pandas, scipy, pm4py and the rest, slow on a busy machine.
START_TIMEOUT_S = 240


def _env() -> dict[str, str]:
    env = dict(os.environ)
    # The test harness's settings, which the launcher removes anyway, and no API key.
    for name in ("PYTEST_CURRENT_TEST", "RATE_LIMIT_DISABLED", "TEST_DATABASE_URL", "TESTING", "ANTHROPIC_API_KEY"):
        env.pop(name, None)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _launch(data: Path, port_file: Path, export: Path, output: Path) -> subprocess.Popen:
    port_file.unlink(missing_ok=True)
    command = [
        sys.executable, "-m", "desktop_app", "--headless", "--port", "0",
        "--port-file", str(port_file), "--data-dir", str(data), "--frontend-dir", str(export),
    ]
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    with open(output, "ab") as out:
        return subprocess.Popen(command, cwd=DESKTOP, env=_env(), stdout=out, stderr=subprocess.STDOUT, creationflags=flags)


def _wait_for_port(process: subprocess.Popen, port_file: Path, output: Path) -> int:
    deadline = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < deadline:
        if port_file.exists():
            return int(port_file.read_text().strip())
        if process.poll() is not None:
            break
        time.sleep(0.2)
    process.kill()
    pytest.fail("the launcher did not start:\n" + output.read_text(errors="replace")[-4000:])


def _quit(process: subprocess.Popen) -> int:
    """Ctrl+C (Ctrl+Break on Windows, the only one a process group can be sent)."""
    process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
    try:
        return process.wait(60)
    except subprocess.TimeoutExpired:
        process.kill()
        raise


def _get(port: int, path: str, headers: dict[str, str] | None = None) -> http.client.HTTPResponse:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    connection.request("GET", path, headers=headers or {})
    response = connection.getresponse()
    response.body = response.read()
    connection.close()
    return response


def _alembic_heads() -> list[str]:
    import db_migrate
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(db_migrate.alembic_config()).get_heads()


def test_start_hand_over_quit_and_restart(tmp_path, export_dir):
    data, output = tmp_path / "data", tmp_path / "output.txt"
    port_file = tmp_path / "port"

    first = _launch(data, port_file, export_dir, output)
    try:
        port = _wait_for_port(first, port_file, output)

        health = _get(port, "/api/health")
        assert health.status == 200 and json.loads(health.body)["status"] == "ok"

        # The first start made the identity; the page brings the cookie of its one session.
        identity = json.loads((data / "identity.json").read_text())
        page = _get(port, "/", HTML)
        assert page.status == 200 and b"index page" in page.body
        assert cookie_session_id(page.getheader("set-cookie")) == identity["shared_session_id"]

        # The database of the fresh data directory was migrated to the newest revision.
        with sqlite3.connect(data / "app.db") as db:
            assert [row[0] for row in db.execute("SELECT version_num FROM alembic_version")] == _alembic_heads()
        assert json.loads((data / "instance.json").read_text())["port"] == port

        # A second start on the same data directory shows the running one and ends.
        second_port = tmp_path / "port2"
        second = subprocess.run(
            [sys.executable, "-m", "desktop_app", "--headless", "--port-file", str(second_port), "--data-dir", str(data)],
            cwd=DESKTOP, env=_env(), capture_output=True, text=True, timeout=120,
        )
        assert second.returncode == 0, second.stdout + second.stderr
        assert int(second_port.read_text()) == port
        assert "already running" in second.stdout + second.stderr
    finally:
        code = _quit(first)
    assert code == 0, output.read_text(errors="replace")[-4000:]
    assert not (data / "instance.json").exists()
    log = (data / "logs" / "app.log").read_text(encoding="utf-8")
    assert "is running at" in log and "has stopped" in log

    # A restart keeps the session and its key.
    third = _launch(data, port_file, export_dir, output)
    try:
        port = _wait_for_port(third, port_file, output)
        page = _get(port, "/", HTML)
        assert cookie_session_id(page.getheader("set-cookie")) == identity["shared_session_id"]
    finally:
        assert _quit(third) == 0
    assert json.loads((data / "identity.json").read_text()) == identity
