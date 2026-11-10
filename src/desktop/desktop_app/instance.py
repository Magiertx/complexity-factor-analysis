"""One running instance per data directory, and the port it listens on.

- A lock on ``instance.lock`` in the data directory, held by the process that serves it. The
  system releases it when the process ends, also after a crash. Two processes on one SQLite
  file, each running its own jobs and marking the other's as interrupted at startup, must not
  happen.
- ``instance.json`` next to it (pid, port, token), written once the server answers and deleted
  by the next owner of the lock, so a crash leaves nothing a later start believes. A second start
  that finds the lock taken asks that port whether the instance is there (:func:`probe`): the
  server must answer a random nonce with HMAC(token, nonce), so the token is not sent to
  whatever listens on that port, and opens the browser on it.
- The port: the one of the last start (``launcher.json``), else :data:`DEFAULT_PORT`. If another
  program holds it, a free one, which is then remembered, since the browser keeps the app's
  local storage per origin and so per port.
"""

from __future__ import annotations

import hmac
import http.client
import json
import logging
import os
import secrets
import socket
import time
from pathlib import Path
from typing import IO, Any

from .app import INSTANCE_HEADER, INSTANCE_PATH, LOGIN_PATH, NONCE_HEADER, proof
from .state import write_private_json

logger = logging.getLogger("desktop")

HOST = "127.0.0.1"
#: Not one of the usual development ports (3000, 5000, 8000, 8080, 8888).
DEFAULT_PORT = 8765


class InstanceLock:
    """An exclusive lock on a file, without blocking: :meth:`acquire` says whether it got it."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._file: IO[bytes] | None = None

    def acquire(self) -> bool:
        f = open(self.path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt

                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            return False
        self._file = f
        return True

    def release(self) -> None:
        if self._file is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            self._file.close()
            self._file = None


def bind(port: int) -> socket.socket:
    """A listening socket on ``HOST:port`` (0: any free port), for uvicorn to serve on.

    On Windows with ``SO_EXCLUSIVEADDRUSE``: there ``SO_REUSEADDR`` (which uvicorn would set)
    lets a second process bind the same port. Elsewhere with ``SO_REUSEADDR``, so that a restart
    does not wait for the connections of the last run to time out; listening at once keeps a
    second process from binding the port as well (Linux allows that until one listens).
    Connections that arrive before the server runs wait in the backlog.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((HOST, port))
        sock.listen(128)
    except OSError:
        sock.close()
        raise
    return sock


def bind_preferred(port: int, *, fall_back: bool) -> socket.socket:
    """``port`` if it is free; else, with ``fall_back``, any free port.

    The caller holds the instance lock, so whoever has the port is not an instance of this data
    directory: another program, or the app on another data directory.
    """
    try:
        return bind(port)
    except OSError as exc:
        if not fall_back:
            raise
        sock = bind(0)
        logger.warning(
            "Port %d is in use by another program (%s); using port %d instead.", port, exc.strerror or exc, sock.getsockname()[1]
        )
        return sock


# --- instance.json --------------------------------------------------------------------------


def write_info(path: Path, *, port: int, token: str) -> None:
    write_private_json(path, {"pid": os.getpid(), "port": port, "token": token})


def read_info(path: Path) -> dict[str, Any] | None:
    try:
        info = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if isinstance(info, dict) and isinstance(info.get("port"), int) and isinstance(info.get("token"), str):
        return info
    return None


def remove_info(path: Path, token: str) -> None:
    """Delete ``instance.json`` if it is still this instance's."""
    info = read_info(path)
    if info is not None and info.get("token") == token:
        try:
            Path(path).unlink()
        except OSError:
            pass


def probe(port: int, token: str, timeout: float = 2.0) -> dict[str, Any] | None:
    """What the instance on ``port`` says about itself if it proves that it knows ``token``,
    else ``None``. The token is not sent: the instance answers a random nonce with
    HMAC-SHA256(token, nonce), which only a holder of the token can.

    Plain http.client: urllib would send the request through a proxy configured for the system.
    """
    nonce = secrets.token_urlsafe(24)
    connection = http.client.HTTPConnection(HOST, port, timeout=timeout)
    try:
        connection.request("GET", INSTANCE_PATH, headers={NONCE_HEADER.decode(): nonce})
        response = connection.getresponse()
        body = response.read(65536)
        if response.status != 200:
            return None
        answer = json.loads(body)
        given = answer.get("proof") if isinstance(answer, dict) else None
        if not isinstance(given, str) or not hmac.compare_digest(given.encode(), proof(token, nonce).encode()):
            return None
        return {k: v for k, v in answer.items() if k != "proof"}
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        connection.close()


def request_login(port: int, token: str, timeout: float = 5.0) -> dict[str, Any] | None:
    """A login from the instance on ``port``, which only the master ``token`` may ask for: its
    one-time ``code`` and the ``file`` (a redirect page in its data directory) that opens the
    browser with it. ``None`` if it does not give one. Call this only for an instance that has
    proved to know the token (:func:`probe`)."""
    connection = http.client.HTTPConnection(HOST, port, timeout=timeout)
    try:
        connection.request("GET", LOGIN_PATH, headers={INSTANCE_HEADER.decode(): token})
        response = connection.getresponse()
        body = response.read(65536)
        if response.status != 200:
            return None
        answer = json.loads(body)
        code = answer.get("code")
        if not isinstance(code, str) or not code:
            return None
        file = answer.get("file")
        return {"code": code, "file": file if isinstance(file, str) and file else None}
    except (OSError, ValueError, AttributeError, http.client.HTTPException):
        return None
    finally:
        connection.close()


def find_running(path: Path) -> dict[str, Any] | None:
    """The instance that ``instance.json`` names, if it proves to know the token: that file's
    ``port`` and ``token`` plus what the instance says about itself (never the other way round:
    an answer does not get to change where we connect or which token we send)."""
    info = read_info(path)
    if info is None:
        return None
    answer = probe(info["port"], info["token"])
    if answer is None:
        return None
    return {**answer, "port": info["port"], "token": info["token"]}
