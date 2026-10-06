"""Shim that returns a process-wide ProM4Py client pointing at the
configured remote server. Used by the patched vendored ComFy code so the
miners don't each spawn / connect to a fresh ProM instance on hardcoded
port 8000 (which would deadlock against our FastAPI service on the same
port).

Every request of the shared client has a timeout. ProM4Py cannot cancel a plugin call, so
without one a miner that never finishes on a log would block its caller for good. The
prom4py container restarts a ProM that stays stuck (``src/prom4py/launch.sh``).
"""

from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator
from urllib.parse import urlparse

import requests

from env_config import positive_int

from .prom4py import ProM4Py  # type: ignore

#: Seconds one discovery (one miner on one log, all of its requests together) may take, and
#: the longest any other request waits for an answer. The watchdog in the prom4py container
#: reads the same variable and restarts ProM once it has not answered for 30 s longer.
CALL_TIMEOUT_S = positive_int("PROM4PY_CALL_TIMEOUT", 300, minimum=10)

_lock = threading.Lock()
_client: Any = None
_deadline = threading.local()
# ``time.monotonic()`` of the last answer ProM4Py gave this process, whatever the answer was.
_last_answer = float("-inf")


class ProMTimeout(requests.exceptions.Timeout):
    """ProM4Py did not answer in time. ProM goes on computing until its watchdog restarts it."""


class ProMUnavailable(requests.exceptions.ConnectionError):
    """ProM4Py refused or dropped the connection: it is starting, restarting or down."""


def prom4py_url() -> str:
    return os.environ.get("PROM4PY_URL", "http://localhost:4040").rstrip("/")


def get_shared_prom4py() -> Any:
    global _client
    with _lock:
        if _client is None:
            _client = new_client(prom4py_url())
        return _client


def new_client(url: str) -> Any:
    """A ProM4Py client for ``url`` whose requests are bounded in time."""
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 4040
    client = ProM4Py("ignored-in-dev-mode", port=port, dev_mode=True)
    client.client.config.address = f"{parsed.scheme or 'http'}://{host}:"
    client.client.http = _BoundedHTTP()
    return client


@contextmanager
def call_deadline(seconds: float) -> Iterator[None]:
    """Let the requests of this thread inside the block share one budget of ``seconds``."""
    previous = getattr(_deadline, "current", None)
    _deadline.current = (time.monotonic() + seconds, seconds)
    try:
        yield
    finally:
        _deadline.current = previous


def last_answer() -> float:
    """``time.monotonic()`` when ProM4Py last answered a request of this process."""
    return _last_answer


def _answered() -> None:
    global _last_answer
    _last_answer = time.monotonic()


def is_responsive(timeout: float) -> bool:
    """Whether ProM4Py answers ``/isRunning`` within ``timeout`` seconds. It answers only
    between calls, so a busy ProM counts as not responsive."""
    try:
        r = requests.get(f"{prom4py_url()}/isRunning", timeout=timeout)
    except requests.exceptions.RequestException:
        return False
    _answered()
    return r.status_code == 200


class _BoundedHTTP:
    """The functions of ``requests`` the vendored client uses, each with a timeout."""

    def get(self, url: str, **kwargs: Any) -> requests.Response:
        return self._send("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> requests.Response:
        return self._send("POST", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> requests.Response:
        return self._send("DELETE", url, **kwargs)

    def _send(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        current = getattr(_deadline, "current", None)
        if current is None:
            timeout = budget = CALL_TIMEOUT_S
        else:
            at, budget = current
            timeout = at - time.monotonic()
        if timeout <= 0:
            raise ProMTimeout(f"ProM did not answer within {budget:g} s")
        try:
            # One value bounds connecting, sending and waiting for the answer alike.
            response = requests.request(method, url, timeout=timeout, **kwargs)
        except requests.exceptions.Timeout as e:
            raise ProMTimeout(f"ProM did not answer within {budget:g} s") from e
        except requests.exceptions.ConnectionError as e:
            server = urlparse(url)
            raise ProMUnavailable(f"ProM4Py is not reachable at {server.scheme}://{server.netloc}") from e
        _answered()
        return response
