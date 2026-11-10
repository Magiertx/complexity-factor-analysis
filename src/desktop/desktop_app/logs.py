"""The log file: everything the process writes to stdout and stderr, rotated by size.

Capturing the two streams instead of adding a logging handler takes in everything: the
backend's own log (srv_main replaces the handlers of the root logger with one on stderr when it
starts), uvicorn's, warnings, tracebacks of threads and what libraries print. A windowed build
has no console at all; with one, the output goes there as well.
"""

from __future__ import annotations

import io
import logging
import os
import re
import sys
import threading
from pathlib import Path
from typing import TextIO

MAX_BYTES = 2 * 1024 * 1024
BACKUPS = 5


class RotatingFile:
    """A text file that is renamed to ``.1`` (``.1`` to ``.2``, ...) once it exceeds ``max_bytes``."""

    def __init__(self, path: Path, max_bytes: int = MAX_BYTES, backups: int = BACKUPS) -> None:
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.backups = backups
        self._lock = threading.Lock()
        self._file = self._open()

    def _open(self) -> TextIO:
        return open(self.path, "a", encoding="utf-8", errors="backslashreplace", newline="")

    def write(self, text: str) -> None:
        with self._lock:
            if self._file is None:
                return
            self._file.write(text)
            self._file.flush()
            if self._file.tell() > self.max_bytes:
                self._rotate()

    def _rotate(self) -> None:
        self._file.close()
        try:
            for n in range(self.backups - 1, 0, -1):
                older = self.path.with_name(f"{self.path.name}.{n}")
                if older.exists():
                    os.replace(older, self.path.with_name(f"{self.path.name}.{n + 1}"))
            os.replace(self.path, self.path.with_name(f"{self.path.name}.1"))
        except OSError:
            pass  # e.g. opened elsewhere on Windows; the file grows until the next attempt
        self._file = self._open()

    def close(self) -> None:
        with self._lock:
            if self._file is not None:
                self._file.close()
                self._file = None


#: The access token in an address (an access log line, a traceback): never written.
_TOKEN = re.compile(r"([?&]token=)[^&\s\"']+")


#: Values that are never written, wherever they turn up (a path under the artifacts directory, an
#: error message, a traceback): the id of the one session, the key that signs its cookie.
_HIDDEN: set[str] = set()


def hide(*values: str) -> None:
    """Replace these values by ``***`` in everything the log and the console get."""
    _HIDDEN.update(v for v in values if v and len(v) >= 8)


def redact(text: str) -> str:
    text = _TOKEN.sub(lambda m: m.group(1) + "***", text)
    for value in _HIDDEN:
        if value in text:
            text = text.replace(value, "***")
    return text


class Tee(io.TextIOBase):
    """A text stream that writes to the console (if there is one) and to the log file."""

    def __init__(self, console: TextIO | None, log: RotatingFile) -> None:
        self.console = console
        self.log = log

    @property
    def encoding(self) -> str:  # type: ignore[override]
        return "utf-8"

    def writable(self) -> bool:
        return True

    def isatty(self) -> bool:
        # No colour codes: uvicorn checks this.
        return False

    def write(self, text: str) -> int:
        text = redact(text)
        if self.console is not None:
            try:
                self.console.write(text)
            except Exception:
                pass
        self.log.write(text)
        return len(text)

    def flush(self) -> None:
        if self.console is not None:
            try:
                self.console.flush()
            except Exception:
                pass


def _has_console(stream: TextIO | None) -> bool:
    return stream is not None and getattr(stream, "name", None) != os.devnull


def install(path: Path) -> RotatingFile:
    """Send stdout, stderr and the root logger to ``path`` (and to the console, if any)."""
    log = RotatingFile(path)
    sys.stdout = Tee(sys.stdout if _has_console(sys.stdout) else None, log)
    sys.stderr = Tee(sys.stderr if _has_console(sys.stderr) else None, log)
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    return log
