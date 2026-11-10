"""One instance per data directory, the port, and the server in its thread."""

from __future__ import annotations

import json
import socket

import pytest

from ._support import DESKTOP  # noqa: F401  (puts the launcher on the path)

from desktop_app import instance, state
from desktop_app.app import build_app
from desktop_app.server import BackgroundServer


def test_the_instance_lock_is_exclusive(tmp_path):
    path = tmp_path / "instance.lock"
    first, second = instance.InstanceLock(path), instance.InstanceLock(path)
    assert first.acquire()
    assert not second.acquire()
    first.release()
    assert second.acquire()
    second.release()


def test_a_busy_port_falls_back_to_a_free_one():
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.bind((instance.HOST, 0))
    blocker.listen(1)
    busy = blocker.getsockname()[1]
    try:
        with pytest.raises(OSError):
            instance.bind(busy)
        with pytest.raises(OSError):
            instance.bind_preferred(busy, fall_back=False)
        sock = instance.bind_preferred(busy, fall_back=True)
        try:
            assert sock.getsockname()[0] == "127.0.0.1"
            assert sock.getsockname()[1] not in (0, busy)
        finally:
            sock.close()
    finally:
        blocker.close()


def test_a_bound_port_is_not_bound_twice():
    first = instance.bind(0)
    try:
        with pytest.raises(OSError):
            instance.bind(first.getsockname()[1])
    finally:
        first.close()


def test_the_port_is_remembered(tmp_path):
    path = tmp_path / "launcher.json"
    assert state.remembered_port(path) is None
    state.remember_port(path, 8766)
    assert state.remembered_port(path) == 8766
    for content in ("{", json.dumps({"port": 0}), json.dumps({"port": True}), json.dumps({"port": "8765"}), "[]"):
        path.write_text(content)
        assert state.remembered_port(path) is None, content


def test_instance_json(tmp_path):
    path = tmp_path / "instance.json"
    assert instance.read_info(path) is None
    instance.write_info(path, port=8765, token="t1")
    info = instance.read_info(path)
    assert info["port"] == 8765 and info["token"] == "t1" and isinstance(info["pid"], int)
    instance.remove_info(path, "another instance's token")
    assert path.exists()
    instance.remove_info(path, "t1")
    assert not path.exists()


async def _tiny_api(scope, receive, send):
    """Just enough of an ASGI app for the server to start and stop."""
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    await send({"type": "http.response.start", "status": 404, "headers": []})
    await send({"type": "http.response.body", "body": b""})


def test_a_second_start_finds_the_running_instance(tmp_path, export_dir):
    sock = instance.bind(0)
    port = sock.getsockname()[1]
    token = "the-running-instance"
    app = build_app(_tiny_api, export_dir, port=port, token=token, instance={"pid": 42, "port": port})
    server = BackgroundServer(app, sock)
    server.start()
    try:
        assert server.wait_started(30)
        assert instance.probe(port, token) == {"pid": 42, "port": port}
        assert instance.probe(port, "a stale token") is None

        info_path = tmp_path / "instance.json"
        assert instance.find_running(info_path) is None
        instance.write_info(info_path, port=port, token=token)
        running = instance.find_running(info_path)
        assert running["port"] == port and running["token"] == token and running["pid"] == 42
        instance.write_info(info_path, port=port, token="a stale token")
        assert instance.find_running(info_path) is None
    finally:
        server.stop()
    assert not server.running and server.error is None
    # Nothing answers any more.
    assert instance.probe(port, token, timeout=1) is None


def test_a_foreign_server_on_the_old_port_never_gets_the_token(tmp_path):
    """instance.json of a crashed start names a port another program may hold now. The check
    must not send the token there, and must not take over what that server answers."""
    import http.server
    import threading

    seen: list[dict[str, str]] = []

    class Foreign(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append({k.lower(): v for k, v in self.headers.items()})
            body = json.dumps({"pid": 1, "port": 1, "token": "the foreign token", "proof": "x"}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Foreign)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        info_path = tmp_path / "instance.json"
        instance.write_info(info_path, port=port, token="the old token")
        assert instance.find_running(info_path) is None
        assert instance.probe(port, "the old token") is None
    finally:
        server.shutdown()
    assert seen and all("the old token" not in " ".join(h.values()) for h in seen)
    assert all("x-desktop-instance" not in h for h in seen)


def test_the_answer_does_not_change_port_or_token(tmp_path, monkeypatch):
    info_path = tmp_path / "instance.json"
    instance.write_info(info_path, port=1234, token="from the file")
    monkeypatch.setattr(instance, "probe", lambda port, token: {"pid": 7, "port": 9999, "token": "from the answer"})
    running = instance.find_running(info_path)
    assert running["port"] == 1234 and running["token"] == "from the file" and running["pid"] == 7


def test_a_start_takes_the_lock_when_the_holder_quits(tmp_path):
    """The holder is quitting: its instance.json is gone but it holds the lock until it ends.
    The second start keeps trying and takes over; it does not wait for an instance.json."""
    import threading
    from types import SimpleNamespace

    from desktop_app import main

    paths = SimpleNamespace(instance=tmp_path / "instance.json", data=tmp_path)
    holder = instance.InstanceLock(tmp_path / "instance.lock")
    assert holder.acquire()
    threading.Timer(1.0, holder.release).start()
    lock = instance.InstanceLock(tmp_path / "instance.lock")
    assert main._wait_for_lock_or_instance(lock, "App", paths) is None
    lock.release()


def test_a_start_that_waits_too_long_says_so(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from desktop_app import main
    from desktop_app.state import LauncherError

    monkeypatch.setattr(main, "HANDOVER_TIMEOUT_S", 0.3)
    holder = instance.InstanceLock(tmp_path / "instance.lock")
    assert holder.acquire()
    try:
        with pytest.raises(LauncherError, match="does not answer"):
            main._wait_for_lock_or_instance(
                instance.InstanceLock(tmp_path / "instance.lock"), "App", SimpleNamespace(instance=tmp_path / "i.json", data=tmp_path)
            )
    finally:
        holder.release()


def test_quitting_ends_the_progress_stream_at_once(export_dir):
    """A page keeps /api/jobs/events open; quitting must neither wait for it nor cut it off."""
    import http.client
    import threading
    import time

    from desktop_app.app import Shutdown
    from srv_main import app as api

    sock = instance.bind(0)
    port = sock.getsockname()[1]
    shutdown = Shutdown()
    server = BackgroundServer(build_app(api, export_dir, port=port, token="t", shutdown=shutdown), sock, on_stop=shutdown.request)
    server.start()
    lines: list[bytes] = []
    try:
        assert server.wait_started(30)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        connection.request("GET", "/api/jobs/events", headers={"accept": "text/event-stream", "Authorization": "Bearer t"})
        response = connection.getresponse()
        assert response.status == 200

        def read() -> None:
            while line := response.fp.readline():
                lines.append(line)

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        deadline = time.monotonic() + 10
        while b"data: initial\n" not in lines and time.monotonic() < deadline:
            time.sleep(0.05)
        assert b"data: initial\n" in lines
    finally:
        began = time.monotonic()
        server.stop()
        took = time.monotonic() - began
    reader.join(5)
    assert not server.running and server.error is None
    assert took < 3, f"quitting took {took:.1f} s"
    # The stream was completed (the last chunk of a chunked response), not cut off.
    assert lines[-2:] == [b"0\r\n", b"\r\n"]


def test_the_hand_over_opens_a_private_login_file(tmp_path, export_dir, monkeypatch):
    """A second start shows the running app in the browser: through a login file the running
    instance writes (no code on the command line of the browser), and writes the key of that
    start where a script asks for it."""
    import argparse
    import http.client
    from pathlib import Path
    from types import SimpleNamespace

    from desktop_app import main
    from desktop_app.app import Access

    sock = instance.bind(0)
    port = sock.getsockname()[1]
    token = "the-running-instance"
    server = BackgroundServer(
        build_app(
            _tiny_api, export_dir, port=port, token=token, instance={"pid": 42, "port": port},
            access=Access(token, tmp_path),
        ),
        sock,
    )
    server.start()
    opened: list[str] = []
    monkeypatch.setattr(main.webbrowser, "open", lambda url, new=0: opened.append(url))
    try:
        assert server.wait_started(30)
        paths = SimpleNamespace(instance=tmp_path / "instance.json", data=tmp_path)
        instance.write_info(paths.instance, port=port, token=token)
        args = argparse.Namespace(headless=False, port_file=tmp_path / "port", token_file=tmp_path / "token")
        running = instance.find_running(paths.instance)
        assert main._show_running(args, running) == 0

        # The browser gets a file (its command line is visible to other users), which holds a
        # one-time code of the running app, not the token, and the code works.
        assert len(opened) == 1 and opened[0].startswith("file:")
        from urllib.request import url2pathname
        from urllib.parse import urlsplit

        login = Path(url2pathname(urlsplit(opened[0]).path))
        assert login.parent == tmp_path and login.is_file()
        page = login.read_text(encoding="utf-8")
        code = page.split("?token=", 1)[1].split('"', 1)[0]
        assert f"http://127.0.0.1:{port}/?token={code}" in page and code != token and token not in page
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        connection.request("GET", f"/?token={code}")
        assert connection.getresponse().status == 303
        connection.close()
        assert not login.exists()  # used up
        assert instance.request_login(port, "wrong") is None
    finally:
        server.stop()
    assert (tmp_path / "token").read_text().strip() == token
