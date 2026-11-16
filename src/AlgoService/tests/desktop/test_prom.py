"""The ProM of the edition with ProM (desktop_app/prom.py): found, started, watched, stopped.

A stand-in plays Java: a Python process that serves ``/isRunning`` behind the token on the port
it is given, as LocalProM.java does, and exits when its input closes. What it does besides is
set by ``FAKE_PROM_MODE``. The real ProM is tested by the CI's smoke test of the built program.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from desktop_app import environment, prom
from desktop_app.state import LauncherError

FAKE = textwrap.dedent(
    """
    import os, sys, threading, time
    from http.server import BaseHTTPRequestHandler, HTTPServer

    port = int(sys.argv[sys.argv.index("-p") + 1])
    mode = os.environ.get("FAKE_PROM_MODE", "")
    token = os.environ["PROM4PY_TOKEN"]
    log = os.environ.get("FAKE_PROM_LOG")
    if log:
        with open(log, "a") as fh:
            fh.write(f"start {os.getpid()}\\n")
    if mode == "exit-once" and log and open(log).read().count("start") == 1:
        sys.exit(3)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get("X-ProM4Py-Token") != token:
                self.send_response(403); self.end_headers(); return
            if mode == "stuck" and open(log).read().count("start") == 1:
                time.sleep(3600)
            self.send_response(200); self.end_headers(); self.wfile.write(b"ProM is running")
        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("Server listening on port", port, flush=True)
    sys.stdin.read()  # until the app closes it or is gone
    os._exit(0)
    """
)


class FakeSupervisor(prom.Supervisor):
    def __init__(self, tmp_path: Path, **kwargs):
        script = tmp_path / "fake_prom.py"
        script.write_text(FAKE, encoding="utf-8")
        self.script = script
        super().__init__(
            prom.Bundle(tmp_path / "prom"),
            port=prom.free_port(),
            token="t" * 43,
            heap="1G",
            call_timeout=10,
            state_dir=tmp_path / "state",
            **kwargs,
        )

    def command(self) -> list[str]:
        return [sys.executable, "-I", str(self.script), "-p", str(self.port)]


@pytest.fixture
def quick(monkeypatch):
    """The watchdog's pauses in tenths of seconds."""
    monkeypatch.setattr(prom, "PROBE_INTERVAL_S", 0.2)
    monkeypatch.setattr(prom, "RESTART_PAUSE_S", 0.2)


def _wait(condition, timeout: float = 20.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.1)
    return condition()


def _alive(pid: int) -> bool:
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _starts(log: Path) -> int:
    return log.read_text().count("start") if log.exists() else 0


def test_it_starts_answers_with_the_token_and_stops(tmp_path, quick):
    sup = FakeSupervisor(tmp_path)
    sup.start()
    try:
        assert _wait(lambda: sup._probe(1))
        assert not prom.Supervisor._probe(type("NoToken", (), {"url": sup.url, "token": "wrong"})(), 1)
        pid = sup.pid
        assert pid is not None
    finally:
        started = time.monotonic()
        sup.stop()
    assert time.monotonic() - started < prom.STOP_WAIT_S
    assert _wait(lambda: not _alive(pid), 5)
    assert sup.backend_settings() == {"PROM4PY_URL": sup.url, "PROM4PY_TOKEN": "t" * 43}


def test_a_java_that_exits_is_started_again(tmp_path, quick, monkeypatch):
    log = tmp_path / "starts.log"
    monkeypatch.setenv("FAKE_PROM_MODE", "exit-once")
    monkeypatch.setenv("FAKE_PROM_LOG", str(log))
    sup = FakeSupervisor(tmp_path)
    sup.start()
    try:
        assert _wait(lambda: _starts(log) >= 2)
        assert _wait(lambda: sup._probe(1))
    finally:
        sup.stop()


def test_a_stuck_prom_is_restarted(tmp_path, quick, monkeypatch):
    log = tmp_path / "starts.log"
    monkeypatch.setenv("FAKE_PROM_MODE", "stuck")
    monkeypatch.setenv("FAKE_PROM_LOG", str(log))
    sup = FakeSupervisor(tmp_path)
    sup.stuck_after = 2  # PROM4PY_CALL_TIMEOUT + 30 s in the app
    sup.start()
    try:
        first = None
        assert _wait(lambda: _starts(log) >= 1)
        first = sup.pid
        # The first stand-in never answers: after a boot of 600 s it would be restarted; here
        # it is marked up by hand, as if it had answered once and then hung.
        sup._up = True
        assert _wait(lambda: _starts(log) >= 2, 30)
        assert _wait(lambda: sup._probe(1))
        assert _wait(lambda: not _alive(first), 10)
    finally:
        sup.stop()


def test_java_ends_when_the_app_is_killed(tmp_path):
    """The crash case: the app's process ends without quitting; its ProM must not live on."""
    script = tmp_path / "app.py"
    pid_file = tmp_path / "java.pid"
    script.write_text(
        textwrap.dedent(
            f"""
            import os, sys, time
            sys.path[:0] = {[str(Path(prom.__file__).parent.parent)]!r}
            sys.path.insert(0, {str(tmp_path)!r})
            from test_prom_fake import make
            sup = make({str(tmp_path)!r})
            sup.start()
            while sup.pid is None or not sup._probe(1):
                time.sleep(0.1)
            open({str(pid_file)!r}, "w").write(str(sup.pid))
            time.sleep(600)
            """
        ),
        encoding="utf-8",
    )
    (tmp_path / "test_prom_fake.py").write_text(
        textwrap.dedent(
            f"""
            import sys
            from pathlib import Path
            from desktop_app import prom
            FAKE = {FAKE!r}
            class Fake(prom.Supervisor):
                def command(self):
                    return [sys.executable, "-I", str(self.script), "-p", str(self.port)]
            def make(tmp):
                tmp = Path(tmp)
                sup = Fake(prom.Bundle(tmp / "prom"), port=prom.free_port(), token="t" * 43, heap="1G",
                           call_timeout=10, state_dir=tmp / "state")
                sup.script = tmp / "fake_prom.py"
                sup.script.write_text(FAKE, encoding="utf-8")
                return sup
            """
        ),
        encoding="utf-8",
    )
    # The interpreter itself, not the launcher of a virtual environment on Windows, which keeps
    # its child in a job object that would end the stand-in by itself.
    python = getattr(sys, "_base_executable", None) or sys.executable
    app = subprocess.Popen([python, str(script)])
    try:
        assert _wait(lambda: pid_file.exists() and pid_file.read_text().strip(), 30)
        java = int(pid_file.read_text())
        assert _alive(java)
        app.kill()  # TerminateProcess on Windows, SIGKILL elsewhere: no clean quit
        app.wait(10)
        assert _wait(lambda: not _alive(java), 10), "the stand-in for Java outlived the app"
    finally:
        if app.poll() is None:
            app.kill()


# --- finding the folder and the settings -----------------------------------------------------


def _bundle(root: Path) -> Path:
    b = prom.Bundle(root)
    for path in (b.java, b.launcher):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    for part in prom.CLASSPATH:
        (b.home / part.rstrip("*")).mkdir(parents=True, exist_ok=True)
    b.native.mkdir(parents=True, exist_ok=True)
    return root


def test_prepare_finds_a_complete_folder(tmp_path):
    sup = prom.prepare(_bundle(tmp_path / "prom"), {}, {}, tmp_path / "state")
    assert sup is not None
    assert (sup.call_timeout, sup.stuck_after, sup.heap) == (300, 330, "4G")
    assert sup.url == f"http://127.0.0.1:{sup.port}"
    assert len(sup.token) >= 40
    command = sup.command()
    assert command[0] == str(prom.Bundle(tmp_path / "prom").java)
    assert command[-3:] == [prom.MAIN_CLASS, "-p", str(sup.port)]
    assert f"-Duser.home={tmp_path / 'state'}" in command
    assert "-XX:ActiveProcessorCount=1" in command and "-Xmx4G" in command


def test_prepare_takes_the_settings(tmp_path):
    sup = prom.prepare(
        _bundle(tmp_path / "prom"), {"PROM4PY_HEAP": "2G"}, {"PROM4PY_CALL_TIMEOUT": "60", "PROM4PY_HEAP": "8G"}, tmp_path
    )
    assert (sup.call_timeout, sup.stuck_after, sup.heap) == (60, 90, "2G")  # the environment wins


@pytest.mark.parametrize("value", ["9", "abc", "-5", "1.5"])
def test_a_bad_call_timeout_stops_the_start(tmp_path, value):
    with pytest.raises(LauncherError, match="PROM4PY_CALL_TIMEOUT"):
        prom.prepare(_bundle(tmp_path / "prom"), {"PROM4PY_CALL_TIMEOUT": value}, {}, tmp_path)


def test_a_bad_heap_stops_the_start(tmp_path):
    with pytest.raises(LauncherError, match="PROM4PY_HEAP"):
        prom.prepare(_bundle(tmp_path / "prom"), {}, {"PROM4PY_HEAP": "lots"}, tmp_path)


def test_no_own_prom_when_prom4py_url_is_set(tmp_path):
    root = _bundle(tmp_path / "prom")
    assert prom.prepare(root, {"PROM4PY_URL": "http://elsewhere:4040"}, {}, tmp_path) is None
    assert prom.prepare(root, {}, {"PROM4PY_URL": "http://elsewhere:4040"}, tmp_path) is None


def test_no_prom_in_a_checkout_without_prom_dir(tmp_path):
    assert prom.prepare(None, {}, {}, tmp_path) is None


def test_an_incomplete_prom_dir_is_an_error(tmp_path):
    (tmp_path / "prom").mkdir()
    with pytest.raises(LauncherError, match="incomplete"):
        prom.prepare(tmp_path / "prom", {}, {}, tmp_path)


def test_java_gets_no_secrets_and_no_foreign_options(tmp_path, monkeypatch):
    for name in ("ANTHROPIC_API_KEY", "SESSION_SECRET_KEY", "SHARED_SESSION_ID", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS"):
        monkeypatch.setenv(name, "x")
    monkeypatch.setenv("SOME_SETTING", "kept")
    env = FakeSupervisor(tmp_path).java_environ()
    assert env["PROM4PY_TOKEN"] == "t" * 43
    assert env["SOME_SETTING"] == "kept"
    for name in ("ANTHROPIC_API_KEY", "SESSION_SECRET_KEY", "SHARED_SESSION_ID", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS"):
        assert name not in env


def test_the_backend_is_told_where_its_prom_is(tmp_path):
    from desktop_app.paths import AppPaths
    from desktop_app.state import Identity

    paths = AppPaths.under(tmp_path / "data")
    identity = Identity("k" * 64, "00000000-0000-4000-8000-000000000000")
    own = {"PROM4PY_URL": "http://127.0.0.1:5000", "PROM4PY_TOKEN": "secret"}
    env = environment.backend_environ({"PROM4PY_TOKEN": "old"}, paths, identity, {}, {}, prom=own)
    assert (env["PROM4PY_URL"], env["PROM4PY_TOKEN"]) == ("http://127.0.0.1:5000", "secret")
    # Jobs wait for a start of ProM as long as the supervisor gives it.
    assert env["PROM4PY_START_WAIT"] == str(prom.BOOT_TIMEOUT_S)
    env = environment.backend_environ({}, paths, identity, {"PROM4PY_START_WAIT": "30"}, {}, prom=own)
    assert env["PROM4PY_START_WAIT"] == "30"
