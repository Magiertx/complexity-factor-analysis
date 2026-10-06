"""Time limits on ProM4Py calls, and how a call that takes too long shows up.

A stand-in server on localhost plays ProM4Py: it answers ``/isRunning`` at once (like ProM
after its watchdog restarted it) and every other request after ``delay`` seconds. No Java
needed.
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

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


# ``time`` for ``algorithms._prom4py`` without the pauses between probes.
_NO_SLEEP = SimpleNamespace(monotonic=time.monotonic, sleep=lambda seconds: None)


class _Clock:
    """``time`` for ``algorithms._prom4py`` on which a pause passes at once."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def _closed_port_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"


class _HangingMiner:
    """Mines through the bounded client against the stand-in, which takes ``delay`` s."""

    name = "Hanging miner"

    def __init__(self, url: str):
        self.url = url
        self.calls = 0

    def __str__(self):
        return self.name

    def discover_for(self, event_log):
        from vendored.comfy._shared_prom4py import new_client

        self.calls += 1
        new_client(self.url).client.call_executor("return 1;")
        return ("net", "im", "fm")


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


# --- discover -----------------------------------------------------------------------------


def test_discover_fails_a_hanging_miner_after_the_timeout_and_names_it(fake_prom, monkeypatch):
    from algorithms import comfy

    monkeypatch.setattr(comfy, "CALL_TIMEOUT_S", 1)
    fake_prom.delay = 10.0
    miner = _HangingMiner(fake_prom.url)
    start = time.monotonic()
    with pytest.raises(comfy.ProMTimeout) as e:
        comfy.discover(miner, None, "pdc2025_02001100.xes")
    assert str(e.value) == "ProM took longer than 1 s for Hanging miner on pdc2025_02001100.xes"
    # Not repeated, although attempts are left.
    assert miner.calls == 1
    assert time.monotonic() - start < 3.0


def test_the_discovery_after_a_timeout_waits_for_prom_to_restart(fake_prom, monkeypatch):
    from algorithms import _prom4py, comfy

    monkeypatch.setattr(comfy, "CALL_TIMEOUT_S", 1)
    fake_prom.delay = 10.0
    with pytest.raises(comfy.ProMTimeout):
        comfy.discover(_HangingMiner(fake_prom.url), None, "a.xes")
    assert os.path.exists(_prom4py._STUCK_MARK)

    # Still busy with the stuck call at the first probe, restarted at the second.
    probes = iter([False, True])
    monkeypatch.setattr(_prom4py, "is_responsive", lambda timeout: next(probes))
    monkeypatch.setattr(_prom4py, "time", _NO_SLEEP)
    waits: list[str] = []
    assert comfy.discover(_ScriptedMiner(), None, "b.xes", on_wait=waits.append) == ("net", "im", "fm")
    assert waits == ["waiting for ProM to restart"]
    assert not os.path.exists(_prom4py._STUCK_MARK)


class _ScriptedMiner:
    """Raises the given exceptions in turn, then returns a net."""

    def __init__(self, *errors: Exception):
        self.errors = list(errors)
        self.calls = 0

    def __str__(self):
        return "Scripted miner"

    def discover_for(self, event_log):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return ("net", "im", "fm")


def test_discover_waits_for_a_restarted_prom_and_starts_over(monkeypatch):
    from algorithms import _prom4py, comfy

    probes = iter([False, False, True])
    monkeypatch.setattr(_prom4py, "is_responsive", lambda timeout: next(probes))
    monkeypatch.setattr(_prom4py, "time", _NO_SLEEP)
    waits: list[str] = []
    miner = _ScriptedMiner(comfy.ProMUnavailable("ProM4Py is not reachable"))

    assert comfy.discover(miner, None, "a.xes", on_wait=waits.append) == ("net", "im", "fm")
    assert miner.calls == 2
    assert waits == ["waiting for ProM to start"] * 2


def test_discover_gives_up_when_prom_stays_away(monkeypatch):
    from algorithms import _prom4py, comfy

    monkeypatch.setattr(_prom4py, "START_WAIT_S", 0.3)
    monkeypatch.setattr(_prom4py, "is_responsive", lambda timeout: False)
    miner = _ScriptedMiner(*[comfy.ProMUnavailable("ProM4Py is not reachable")] * 5)

    with pytest.raises(comfy.ProMUnavailable, match="did not answer within 0.3 s"):
        comfy.discover(miner, None, "a.xes")
    assert miner.calls == 1
    # The next wait is short instead of the full START_WAIT_S again for every input.
    assert _prom4py._given_up()


def test_waits_are_short_only_until_prom_answers_anything(fake_prom, monkeypatch):
    """A discovery that ProM serves ends the short waits, so the wait for the restart after a
    later timeout is a whole one again."""
    from algorithms import _prom4py, comfy

    clock = _Clock()
    monkeypatch.setattr(_prom4py, "time", clock)
    monkeypatch.setattr(comfy, "CALL_TIMEOUT_S", 1)
    answers_from = None  # down
    monkeypatch.setattr(
        _prom4py, "is_responsive", lambda timeout: answers_from is not None and clock.now >= answers_from
    )

    with pytest.raises(comfy.ProMUnavailable, match="did not answer within 180 s"):
        comfy.discover(_ScriptedMiner(comfy.ProMUnavailable("refused")), None, "a.xes")
    assert _prom4py._given_up()

    # Back: it serves a discovery without anybody waiting for it.
    assert comfy.discover(_HangingMiner(fake_prom.url), None, "b.xes") == ("net", "im", "fm")
    assert not _prom4py._given_up()

    fake_prom.delay = 10.0
    with pytest.raises(comfy.ProMTimeout):
        comfy.discover(_HangingMiner(fake_prom.url), None, "c.xes")

    # Busy with that call, then restarted by its watchdog: it answers 40 s later.
    answers_from = clock.now + 40
    waits: list[str] = []
    assert comfy.discover(_ScriptedMiner(), None, "d.xes", on_wait=waits.append) == ("net", "im", "fm")
    assert waits == ["waiting for ProM to restart"] * 40
    assert not os.path.exists(_prom4py._STUCK_MARK)


def test_a_restart_that_does_not_come_fails_the_input_once(monkeypatch):
    """The wait for a restart outlasts the watchdog (up to about PROM4PY_CALL_TIMEOUT + 40 s
    after the timeout); when ProM does not come back even then, it is down for longer."""
    from algorithms import _prom4py, comfy

    clock = _Clock()
    monkeypatch.setattr(_prom4py, "time", clock)
    monkeypatch.setattr(_prom4py, "is_responsive", lambda timeout: False)
    with open(_prom4py._STUCK_MARK, "w"):
        pass

    miner = _ScriptedMiner()
    with pytest.raises(_prom4py.ProMNotRestarted, match="did not finish restarting within"):
        comfy.discover(miner, None, "a.xes")
    # Not repeated, and no more waits for the restart: the next input fails quickly.
    assert miner.calls == 0
    assert clock.now == pytest.approx(_prom4py.RESTART_WAIT_S, abs=1)
    assert not os.path.exists(_prom4py._STUCK_MARK)
    start = clock.now
    with pytest.raises(comfy.ProMUnavailable, match="did not answer within 5 s"):
        comfy.discover(_ScriptedMiner(comfy.ProMUnavailable("refused")), None, "b.xes")
    assert clock.now - start <= 6


def test_discover_does_not_repeat_unavailable_forever(monkeypatch):
    from algorithms import _prom4py, comfy

    monkeypatch.setattr(_prom4py, "is_responsive", lambda timeout: True)
    miner = _ScriptedMiner(*[comfy.ProMUnavailable("dropped")] * 5)
    with pytest.raises(comfy.ProMUnavailable, match="dropped"):
        comfy.discover(miner, None, "a.xes")
    assert miner.calls == comfy.DISCOVERY_ATTEMPTS


def test_discoveries_take_turns_on_prom():
    from algorithms import comfy

    active = {"now": 0, "most": 0}
    guard = threading.Lock()
    waits: list[str] = []

    class SlowMiner:
        def discover_for(self, event_log):
            with guard:
                active["now"] += 1
                active["most"] = max(active["most"], active["now"])
            time.sleep(1.5)
            with guard:
                active["now"] -= 1
            return ("net", "im", "fm")

    threads = [
        threading.Thread(target=comfy.discover, args=(SlowMiner(), None), kwargs={"on_wait": waits.append})
        for _ in range(2)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert active["most"] == 1
    assert "waiting for ProM, another job is using it" in waits


# --- how a timeout shows up ---------------------------------------------------------------


@pytest.fixture
def hanging_miner(fake_prom, monkeypatch):
    """ComFy with a miner that takes 10 s on ProM, a 1 s timeout and a local fake miner."""
    import algorithms
    from algorithms import comfy

    class FakeMiner:
        def __str__(self):
            return "Fake miner"

        def discover_for(self, event_log):
            import pm4py

            return pm4py.discover_petri_net_inductive(event_log)

    fake_prom.delay = 10.0
    monkeypatch.setattr(comfy, "CALL_TIMEOUT_S", 1)
    monkeypatch.setitem(comfy.MINERS_BY_NAME, "Hanging miner", _HangingMiner(fake_prom.url))
    monkeypatch.setitem(comfy.MINERS_BY_NAME, "Fake miner", FakeMiner())
    # The registry built its parameter options before the two miners existed.
    monkeypatch.setitem(algorithms.REGISTRY, "comfy", comfy.ComFyAlgorithm())
    return "Hanging miner"


def _run_comfy(client, miners: list[str]) -> dict:
    r = client.post(
        "/algorithms/comfy/analyze",
        data={
            "sample_log_id": "small_example",
            "discovery_algorithms": miners,
            "complexity_measures": ["Size"],
        },
    )
    assert r.status_code == 200, r.text
    deadline = time.time() + 60
    while time.time() < deadline:
        job = client.get(f"/jobs/{r.json()['job_id']}").json()
        if job["status"] in {"completed", "failed", "aborted"}:
            return job
        time.sleep(0.1)
    pytest.fail("ComFy run did not finish")


def test_a_timeout_is_an_error_cell_of_a_single_log_run(client, hanging_miner):
    job = _run_comfy(client, [hanging_miner, "Fake miner"])
    assert job["status"] == "completed", job.get("error")
    artifacts = job["result"]["artifacts"]
    rows = {row[0]: row[1:] for row in next(a for a in artifacts if a["kind"] == "table")["rows"]}
    assert rows[hanging_miner] == ["ERR: ProMTimeout"]
    assert isinstance(rows["Fake miner"][0], int)
    notes = next(a for a in artifacts if a["label"] == "Notes")["markdown"]
    assert "ProM took longer than 1 s for Hanging miner on small_example.xes" in notes


def test_a_run_whose_only_miner_times_out_fails_with_the_reason(client, hanging_miner):
    job = _run_comfy(client, [hanging_miner])
    assert job["status"] == "failed"
    assert "ProM took longer than 1 s for Hanging miner on small_example.xes" in job["error"]


def _xes(traces: list[list[str]]) -> bytes:
    def event(activity: str, minute: int) -> str:
        return (
            f'<event><string key="concept:name" value="{activity}"/>'
            f'<date key="time:timestamp" value="2024-01-01T10:{minute:02d}:00.000+00:00"/></event>'
        )

    body = "".join(
        f'<trace><string key="concept:name" value="c{i}"/>'
        + "".join(event(a, j) for j, a in enumerate(trace))
        + "</trace>"
        for i, trace in enumerate(traces)
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><log xes.version="1.0">{body}</log>'.encode()


def test_a_timeout_is_a_failed_input_of_a_dataset_job(client, hanging_miner, monkeypatch):
    from algorithms import comfy

    hanging = comfy.MINERS_BY_NAME[hanging_miner]
    fake = comfy.MINERS_BY_NAME["Fake miner"]

    class HangsOnFirstLog:
        calls = 0

        def __str__(self):
            return hanging_miner

        def discover_for(self, event_log):
            HangsOnFirstLog.calls += 1
            return (hanging if HangsOnFirstLog.calls == 1 else fake).discover_for(event_log)

    monkeypatch.setitem(comfy.MINERS_BY_NAME, hanging_miner, HangsOnFirstLog())
    logs = {
        "seq.xes": [["a", "b", "c"]] * 3 + [["a", "b", "c", "d"]],
        "choice.xes": [["a", "b", "d"], ["a", "c", "d"], ["a", "b", "d"], ["a", "c", "d", "e"], ["a", "e"]],
        "loop.xes": [["a", "b", "b", "c"], ["a", "b", "c"], ["a", "b", "b", "b", "c"], ["x", "a"]],
    }
    r = client.post(
        "/factor-analysis/datasets",
        data={
            "kind": "model",
            "source": "logs",
            "miners": json.dumps([hanging_miner]),
            "measures": json.dumps(["Size", "Token split"]),
        },
        files=[("files", (name, _xes(traces), "application/xml")) for name, traces in logs.items()],
    )
    assert r.status_code == 200, r.text
    deadline = time.time() + 60
    while (d := client.get(f"/factor-analysis/datasets/{r.json()['dataset_id']}").json())["status"] == "computing":
        assert time.time() < deadline, "dataset still computing"
        time.sleep(0.1)

    assert d["status"] == "ready", d
    assert d["n_observations"] == len(logs) - 1
    [failure] = d["failures"]
    log_label = failure["input"].removesuffix(f" / {hanging_miner}")
    assert f"ProM took longer than 1 s for {hanging_miner} on {log_label}" in failure["error"]
