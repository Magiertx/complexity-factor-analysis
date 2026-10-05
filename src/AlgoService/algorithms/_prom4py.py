"""Access to the ProM4Py client shared with the vendored ComFy miners."""

from __future__ import annotations

from typing import Any

from vendored.comfy._shared_prom4py import get_shared_prom4py


def get_prom4py() -> Any:
    """Return the process-wide ProM4Py client pointing at ``PROM4PY_URL``."""
    return get_shared_prom4py()
