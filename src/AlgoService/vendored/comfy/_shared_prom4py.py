"""Shim that returns a process-wide ProM4Py client pointing at the
configured remote server. Used by the patched vendored ComFy code so the
miners don't each spawn / connect to a fresh ProM instance on hardcoded
port 8000 (which would deadlock against our FastAPI service on the same
port).
"""

from __future__ import annotations

import os
import threading
from typing import Any
from urllib.parse import urlparse

from .prom4py import ProM4Py  # type: ignore

_lock = threading.Lock()
_client: Any = None


def get_shared_prom4py() -> Any:
    global _client
    with _lock:
        if _client is None:
            url = os.environ.get("PROM4PY_URL", "http://localhost:4040")
            parsed = urlparse(url)
            host = parsed.hostname or "localhost"
            port = parsed.port or 4040
            client = ProM4Py("ignored-in-dev-mode", port=port, dev_mode=True)
            client.client.config.address = f"{parsed.scheme or 'http'}://{host}:"
            _client = client
        return _client
