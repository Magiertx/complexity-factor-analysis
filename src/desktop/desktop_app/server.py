"""Uvicorn in a thread of its own, so that the main thread is free for the window (Tk has to run
there on macOS) and for Ctrl+C."""

from __future__ import annotations

import logging
import socket
import threading
import time
from typing import Callable

import uvicorn
from starlette.types import ASGIApp

logger = logging.getLogger("desktop")

#: Seconds open requests get to finish when the app quits. The progress streams of the pages,
#: which never finish by themselves, are ended at once (``app.Shutdown``).
GRACEFUL_SHUTDOWN_S = 5


class BackgroundServer:
    """``on_stop`` is called first when the server is to stop (``app.Shutdown.request``)."""

    def __init__(
        self,
        app: ASGIApp,
        sock: socket.socket,
        *,
        access_log: bool = False,
        on_stop: Callable[[], None] | None = None,
    ) -> None:
        host, port = sock.getsockname()[:2]
        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            loop="asyncio",
            http="h11",
            ws="none",
            lifespan="on",
            access_log=access_log,
            use_colors=False,
            # Nothing stands in front of this server: X-Forwarded-* from a local program must
            # not change the client address the rate limits count.
            proxy_headers=False,
            server_header=False,
            timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_S,
        )
        self.server = uvicorn.Server(config)
        self.sock = sock
        self.on_stop = on_stop
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, name="uvicorn", daemon=True)

    def _run(self) -> None:
        try:
            self.server.run(sockets=[self.sock])
        except BaseException as exc:  # uvicorn ends a failed startup with SystemExit
            self.error = exc
            if not isinstance(exc, SystemExit):
                logger.exception("The server stopped with an error.")

    def start(self) -> None:
        """Start serving in the background thread."""
        self.thread.start()

    @property
    def running(self) -> bool:
        """Whether the server thread is alive."""
        return self.thread.is_alive()

    def wait_started(self, timeout: float) -> bool:
        """Whether the server answers requests (its startup, migrations aside, is done)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.server.started:
                return True
            if not self.thread.is_alive():
                return False
            time.sleep(0.05)
        return self.server.started

    def stop(self, timeout: float = GRACEFUL_SHUTDOWN_S + 10) -> None:
        """Stop accepting connections, let open ones finish (at most ``GRACEFUL_SHUTDOWN_S``),
        run the backend's shutdown, and wait for all of it."""
        if not self.thread.is_alive():
            return
        if self.on_stop is not None:
            self.on_stop()
        self.server.should_exit = True
        self.thread.join(timeout)
        if self.thread.is_alive():
            logger.warning("The server did not stop in %.0f s; forcing it.", timeout)
            self.server.force_exit = True
            self.thread.join(5)
