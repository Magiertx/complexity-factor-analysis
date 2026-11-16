"""The ProM of the edition with ProM (desktop_app/prom.py): found, started, watched, stopped.

A stand-in plays Java: a Python process that serves ``/isRunning`` behind the token on the port
it is given, as LocalProM.java does, and exits when its input closes. What it does besides is
set by ``FAKE_PROM_MODE``. The real ProM is tested by the CI's smoke test of the built program.

The stand-in answers on a plain socket, not with ``http.server``: ``HTTPServer`` looks up the
name of its address (``socket.getfqdn`` in ``server_bind``), and on the macOS runner the stand-in
started (its exit codes came back at once) but never got past that point, so it neither answered
nor ended with its input. It watches its input from the start, as LocalProM does, and prints
when it is up, which the app's log shows (``[prom] ...``).
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
    import os, socket, sys, threading, time

    born = time.monotonic()
    port = int(sys.argv[sys.argv.index("-p") + 1])
    mode = os.environ.get("FAKE_PROM_MODE", "")
    token = os.environ["PROM4PY_TOKEN"].encode()
    log = os.environ.get("FAKE_PROM_LOG")
    if log:
        with open(log, "a") as fh:
            fh.write(f"start {os.getpid()}\\n")
    starts = open(log).read().count("start") if log else 1
    if mode == "exit-once" and starts == 1:
        sys.exit(3)
    if mode == "exit-always":
        sys.exit(3)

    def watch_input():
        sys.stdin.buffer.read()  # until the app closes it or is gone
        os._exit(0)

    threading.Thread(target=watch_input, daemon=True).start()

    def answer(conn):
        with conn:
            head = b""
            while b"\\r\\n\\r\\n" not in head:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                head += chunk
            given = None
            for line in head.split(b"\\r\\n")[1:]:
                name, _, value = line.partition(b":")
                if name.strip().lower() == b"x-prom4py-token":
                    given = value.strip()
            if given != token:
                conn.sendall(b"HTTP/1.1 403 Forbidden\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n")
                return
            if mode == "stuck" and starts == 1:
                time.sleep(3600)
            body = b"ProM is running"
            conn.sendall(b"HTTP/1.1 200 OK\\r\\nContent-Length: %d\\r\\nConnection: close\\r\\n\\r\\n%s" % (len(body), body))

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", port))
    server.listen(16)
    print(f"Server listening on port {port} ({time.monotonic() - born:.2f} s after the start)", flush=True)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=answer, args=(conn,), daemon=True).start()
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

    def java_environ(self) -> dict[str, str]:
        # The stand-in's own settings; the real Java gets only prom.JAVA_ENV_KEEP.
        env = super().java_environ()
        env.update({k: v for k, v in os.environ.items() if k.startswith("FAKE_PROM_")})
        return env


@pytest.fixture
def quick(monkeypatch):
    """The watchdog's pauses in tenths of seconds."""
    monkeypatch.setattr(prom, "PROBE_INTERVAL_S", 0.2)
    monkeypatch.setattr(prom, "RESTART_PAUSE_S", 0.2)


@pytest.fixture(autouse=True)
def backend_variables(monkeypatch):
    """The supervisor writes PROM4PY_DOWN and PROM4PY_URL into the process's environment; they are
    removed again after each test (setenv records that they were not there)."""
    for name in (prom.DOWN_VARIABLE, "PROM4PY_URL"):
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)


def _wait(condition, timeout: float = 20.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.1)
    return condition()


def _alive(pid: int) -> bool:
    if os.name == "nt":
        # Bytes: tasklist writes in the console's code page (cp850 on a German Windows), which
        # text=True would decode with another one and fail on.
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True).stdout
        return str(pid).encode() in out
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
    # The port is taken once the app has bound its own (main.py), not before.
    assert sup.port is None
    sup.choose_port()
    assert sup.url == f"http://127.0.0.1:{sup.port}"
    assert len(sup.token) >= 40
    command = sup.command()
    assert command[0] == str(prom.Bundle(tmp_path / "prom").java)
    assert command[-3:] == [prom.MAIN_CLASS, "-p", str(sup.port)]
    assert f"-Duser.home={tmp_path / 'state'}" in command
    assert "-XX:ActiveProcessorCount=1" in command and "-Xmx4G" in command
    # UTF-8 for what ProM4Py reads and writes, whatever the system's charset.
    assert "-Dfile.encoding=UTF-8" in command and "-Dsun.jnu.encoding=UTF-8" in command
    # The token goes through the environment only: a command line can be read by other users.
    assert not any(sup.token in part for part in command)
    assert sup.java_environ()["PROM4PY_TOKEN"] == sup.token


def test_the_backend_finds_the_editions_graphviz_first(tmp_path, monkeypatch):
    root = _bundle(tmp_path / "prom")
    monkeypatch.setenv("PATH", "the-users-path")
    sup = prom.prepare(root, {}, {}, tmp_path / "state")
    assert "PATH" not in sup.backend_settings() or sys.platform == "darwin"  # no graphviz/ in it
    gv = root / "graphviz" / "bin"
    gv.mkdir(parents=True)
    (gv / ("dot.exe" if os.name == "nt" else "dot")).write_text("")
    assert sup.backend_settings()["PATH"] == os.pathsep.join([str(gv), "the-users-path"])


def test_paths_java_8_cannot_take_go_as_short_names(tmp_path):
    # Java 8 on Windows reads its command line in the ANSI code page: a Cyrillic folder name
    # arrives as "????" (measured), its 8.3 short name does not.
    folder = tmp_path / "Юрий"
    folder.mkdir()
    plain = tmp_path / "Jurij"
    plain.mkdir()
    assert prom.jvm_path(plain) == str(plain)
    given = prom.jvm_path(folder)
    if os.name != "nt":
        assert given == str(folder)
        return
    import ctypes

    codec = f"cp{ctypes.windll.kernel32.GetACP()}"
    given.encode(codec)  # raises if Java could not take it
    assert os.path.samefile(given, folder)


@pytest.mark.skipif(os.name != "nt", reason="Java 8 reads paths in the ANSI code page on Windows only")
def test_a_program_folder_java_8_cannot_start_from_is_given_up_at_once(tmp_path):
    # The JVM opens its own rt.jar by an ANSI path, also when started by the short name.
    root = tmp_path / "Юрий" / "prom"
    root.mkdir(parents=True)
    assert "outside the system's code page" in prom.java_cannot_run_from(root)
    assert prom.java_cannot_run_from(tmp_path) == ""
    sup = prom.Supervisor(prom.Bundle(root), token="t" * 43, heap="1G", call_timeout=10, state_dir=tmp_path / "s")
    sup.choose_port()
    sup.start()
    sup._thread.join(10)
    assert "move the program to a folder such as" in os.environ[prom.DOWN_VARIABLE]
    sup.stop()


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


def test_java_gets_only_what_a_jvm_needs(tmp_path, monkeypatch):
    secrets_and_options = (
        "ANTHROPIC_API_KEY", "SESSION_SECRET_KEY", "SHARED_SESSION_ID", "FEEDBACK_SMTP_PASSWORD",
        "DATABASE_URL", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "SOME_SETTING",
    )
    for name in secrets_and_options:
        monkeypatch.setenv(name, "x")
    monkeypatch.setenv("TEMP", "the-temp-folder")
    monkeypatch.setenv("PATH", "the-path")
    env = FakeSupervisor(tmp_path).java_environ()
    assert env["PROM4PY_TOKEN"] == "t" * 43
    assert (env.get("TEMP"), env.get("PATH")) == ("the-temp-folder", "the-path")
    for name in secrets_and_options:
        assert name not in env


def test_java_gets_the_users_library_path_not_pyinstallers(tmp_path, monkeypatch):
    monkeypatch.setattr(prom.sys, "platform", "linux")
    monkeypatch.setattr(prom.resources, "is_frozen", lambda: True)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/opt/app/_internal")
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", "/usr/local/lib")
    assert FakeSupervisor(tmp_path).java_environ()["LD_LIBRARY_PATH"] == "/usr/local/lib"
    monkeypatch.delenv("LD_LIBRARY_PATH_ORIG")
    assert "LD_LIBRARY_PATH" not in FakeSupervisor(tmp_path).java_environ()


def test_a_java_that_cannot_be_started_is_given_up_at_once(tmp_path, monkeypatch):
    monkeypatch.delenv(prom.DOWN_VARIABLE, raising=False)
    sup = prom.Supervisor(
        prom.Bundle(tmp_path / "no-such-prom"), token="t" * 43, heap="1G", call_timeout=10, state_dir=tmp_path / "s"
    )
    sup.choose_port()
    sup.start()
    sup._thread.join(10)
    assert not sup._thread.is_alive()
    assert "Java cannot be started" in os.environ[prom.DOWN_VARIABLE]
    sup.stop()


def test_a_java_that_keeps_ending_moves_its_port_and_is_given_up(tmp_path, quick, monkeypatch):
    log = tmp_path / "starts.log"
    monkeypatch.setenv("FAKE_PROM_MODE", "exit-always")
    monkeypatch.setenv("FAKE_PROM_LOG", str(log))
    monkeypatch.setattr(prom, "MAX_RESTART_PAUSE_S", 0.2)
    monkeypatch.delenv(prom.DOWN_VARIABLE, raising=False)
    sup = FakeSupervisor(tmp_path)
    monkeypatch.setenv("PROM4PY_URL", sup.url)  # as the launcher sets it for the backend
    first = sup.url
    sup.start()
    try:
        assert _wait(lambda: prom.DOWN_VARIABLE in os.environ, 30)
        assert _starts(log) == prom.GIVE_UP_AFTER
        assert "times in a row" in os.environ[prom.DOWN_VARIABLE]
        # A start that ended before it answered may have lost its port: the next took another,
        # and the backend's address followed.
        assert sup.url != first and os.environ["PROM4PY_URL"] == sup.url
    finally:
        sup.stop()


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
