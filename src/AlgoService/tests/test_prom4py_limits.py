"""Time limits on the requests of the ProM4Py client.

A stand-in server on localhost plays ProM4Py: it answers ``/isRunning`` at once (like ProM
after its watchdog restarted it) and every other request after ``delay`` seconds. No Java
needed.
"""

from __future__ import annotations

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

KEY = "11111111-2222-3333-4444-555555555555"


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/isRunning":
            self._reply(b"ProM is running")
        else:
            self._slow_reply()

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._slow_reply()

    def _slow_reply(self):
        time.sleep(self.server.delay)
        self._reply(KEY.encode())

    def _reply(self, body: bytes):
        try:
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass  # the client gave up already

    def log_message(self, *args):
        pass


class _FakeProM(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.delay = 0.0
        self.url = f"http://127.0.0.1:{self.server_port}"


@pytest.fixture
def fake_prom(monkeypatch):
    server = _FakeProM()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("PROM4PY_URL", server.url)
    yield server
    server.shutdown()
    server.server_close()


def _closed_port_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"


# --- the bounded client -------------------------------------------------------------------


def test_a_request_that_takes_too_long_raises_prom_timeout(fake_prom):
    from vendored.comfy._shared_prom4py import ProMTimeout, call_deadline, new_client

    fake_prom.delay = 5.0
    client = new_client(fake_prom.url).client
    start = time.monotonic()
    with call_deadline(0.5), pytest.raises(ProMTimeout, match="within 0.5 s"):
        client.call_executor("return 1;")
    assert time.monotonic() - start < 2.0


def test_a_request_outside_a_discovery_has_the_call_timeout(fake_prom, monkeypatch):
    from vendored.comfy import _shared_prom4py as shared

    monkeypatch.setattr(shared, "CALL_TIMEOUT_S", 0.5)
    fake_prom.delay = 5.0
    start = time.monotonic()
    with pytest.raises(shared.ProMTimeout):
        shared.new_client(fake_prom.url).client.extract(KEY)
    assert time.monotonic() - start < 2.0


def test_the_requests_of_a_discovery_share_one_budget(fake_prom):
    from vendored.comfy._shared_prom4py import ProMTimeout, call_deadline, new_client

    fake_prom.delay = 0.5
    client = new_client(fake_prom.url).client
    with call_deadline(1.3):
        assert client.call_executor("return 1;") == KEY
        assert client.call_executor("return 2;") == KEY
        with pytest.raises(ProMTimeout):
            client.call_executor("return 3;")


def test_a_refused_connection_raises_prom_unavailable():
    from vendored.comfy._shared_prom4py import ProMUnavailable, new_client

    client = new_client(_closed_port_url()).client
    with pytest.raises(ProMUnavailable, match="not reachable"):
        client.call_executor("return 1;")
    # Still a ConnectionError for the vendored client, which treats that as "not running".
    assert issubclass(ProMUnavailable, requests.exceptions.ConnectionError)
    assert client.is_running() is False
