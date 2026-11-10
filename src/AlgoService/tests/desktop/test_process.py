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
        "--port-file", str(port_file), "--token-file", str(port_file.with_name(port_file.name + ".token")),
        "--data-dir", str(data), "--frontend-dir", str(export),
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

        # Only the token opens anything else; the launcher's own files carry it, for the owner only.
        token = json.loads((data / "instance.json").read_text())["token"]
        token_file = port_file.with_name(port_file.name + ".token")
        assert token_file.read_text().strip() == token
        if os.name != "nt":
            assert token_file.stat().st_mode & 0o077 == 0 and (data / "instance.json").stat().st_mode & 0o077 == 0
        assert _get(port, "/api/factor-analysis/datasets").status == 401
        assert _get(port, "/", HTML).status == 401
        auth = {"Authorization": f"Bearer {token}"}
        code = json.loads(_get(port, "/_desktop/login", {"X-Desktop-Instance": token}).body)["code"]
        assert _get(port, "/api/factor-analysis/datasets", auth).status == 200
        assert _get(port, f"/?token={token}", HTML).status == 401  # the master token is no code
        traded = _get(port, f"/?token={code}", HTML)
        assert traded.status == 303 and traded.getheader("location") == "/"
        cookie = traded.getheader("set-cookie")
        assert token not in cookie and code not in cookie
        assert _get(port, "/api/factor-analysis/datasets", {"Cookie": cookie.split(";")[0]}).status == 200
        assert _get(port, f"/?token={code}", HTML).status == 401  # used up

        # The first start made the identity; the page brings the cookie of its one session.
        identity = json.loads((data / "identity.json").read_text())
        page = _get(port, "/", {**HTML, **auth})
        assert page.status == 200 and b"index page" in page.body
        assert cookie_session_id(page.getheader("set-cookie")) == identity["shared_session_id"]

        # The database of the fresh data directory was migrated to the newest revision.
        with sqlite3.connect(data / "app.db") as db:
            assert [row[0] for row in db.execute("SELECT version_num FROM alembic_version")] == _alembic_heads()
        assert json.loads((data / "instance.json").read_text())["port"] == port

        # A second start on the same data directory shows the running one and ends.
        second_port = tmp_path / "port2"
        second_token = tmp_path / "token2"
        second = subprocess.run(
            [
                sys.executable, "-m", "desktop_app", "--headless", "--port-file", str(second_port),
                "--token-file", str(second_token), "--data-dir", str(data),
            ],
            cwd=DESKTOP, env=_env(), capture_output=True, text=True, timeout=120,
        )
        assert second.returncode == 0, second.stdout + second.stderr
        assert int(second_port.read_text()) == port
        assert second_token.read_text().strip() == token
        assert "already running" in second.stdout + second.stderr
    finally:
        code = _quit(first)
    assert code == 0, output.read_text(errors="replace")[-4000:]
    assert not (data / "instance.json").exists()
    log = (data / "logs" / "app.log").read_text(encoding="utf-8")
    assert "is running at" in log and "has stopped" in log
    assert token not in log and token not in output.read_text(errors="replace")
    assert identity["shared_session_id"] not in log and identity["session_secret_key"] not in log

    # A restart keeps the session and its key.
    third = _launch(data, port_file, export_dir, output)
    try:
        port = _wait_for_port(third, port_file, output)
        new_token = json.loads((data / "instance.json").read_text())["token"]
        assert new_token != token  # a key for each start
        page = _get(port, "/", {**HTML, "Authorization": f"Bearer {new_token}"})
        assert cookie_session_id(page.getheader("set-cookie")) == identity["shared_session_id"]
    finally:
        assert _quit(third) == 0
    assert json.loads((data / "identity.json").read_text()) == identity


def _api(port: int, token: str, method: str, path: str, body=None, form=None):
    import urllib.parse

    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body)
        headers["Content-Type"] = "application/json"
    connection.request(method, "/api" + path, body=data, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    connection.close()
    return response.status, json.loads(raw) if raw else None


def test_quitting_with_a_running_job_keeps_the_lock_until_the_process_is_gone(tmp_path, export_dir):
    """The job threads cannot be killed. The instance lock must stay held until the process has
    really ended, so no second instance runs on the database meanwhile, and the job must end as
    interrupted (its writes stop, the shutdown marks it)."""
    from desktop_app.instance import InstanceLock

    data, output = tmp_path / "data", tmp_path / "output.txt"
    port_file = tmp_path / "port"
    process = _launch(data, port_file, export_dir, output)
    try:
        port = _wait_for_port(process, port_file, output)
        token = json.loads((data / "instance.json").read_text())["token"]
        status, dataset = _api(
            port, token, "POST", "/factor-analysis/datasets",
            form={"kind": "log", "source": "bundled", "bundled_id": "comfy-log-pdc-training-logs"},
        )
        assert status == 200, dataset
        status, job = _api(
            port, token, "POST", f"/factor-analysis/datasets/{dataset['dataset_id']}/stability",
            body={"samples": 500, "rotation": "oblimin"},
        )
        assert status == 200, job
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            _, state = _api(port, token, "GET", f"/jobs/{job['job_id']}")
            if state.get("status") == "running" and (state.get("percentage") or 0) > 0:
                break
            time.sleep(0.5)
        else:
            pytest.fail("the job did not start computing")

        process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        lock = InstanceLock(data / "instance.lock")
        deadline = time.monotonic() + 90
        held_while_stopping = 0
        while process.poll() is None and time.monotonic() < deadline:
            # While the process lives (its job threads too), nobody else may take the lock. It is
            # released by the system at the moment the process ends, which poll() may report a
            # moment later: then the process is gone within a second.
            if lock.acquire():
                lock.release()
                process.wait(5)
                break
            held_while_stopping += 1
            time.sleep(0.05)
        assert process.poll() is not None, "the process did not end"
        assert held_while_stopping > 0, "the lock was never seen held while the app was stopping"
    finally:
        if process.poll() is None:
            process.kill()
    assert process.returncode == 0, output.read_text(errors="replace")[-4000:]
    assert lock.acquire(), "the lock is still held after the process ended"
    lock.release()
    with sqlite3.connect(data / "app.db") as db:
        rows = db.execute("SELECT status, error, params_json FROM runs WHERE id = ?", (job["job_id"].replace("-", ""),)).fetchall()
    assert len(rows) == 1
    run_status, error, params = rows[0]
    assert run_status == "failed" and "interrupted" in error and json.loads(params)["_error_code"] == "interrupted"
    # Nothing writes to the log after the last line it says about the end.
    log = (data / "logs" / "app.log").read_text(encoding="utf-8")
    assert "has stopped" in log or "did not stop" in log
