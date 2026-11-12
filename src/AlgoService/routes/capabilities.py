"""What this installation can do, for the UI to say up front."""

from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter(tags=["capabilities"])


def prom_available() -> bool:
    """ProM is there exactly when ``PROM4PY_URL`` is set. The Docker stack sets it; the desktop app
    does not, unless its settings file names a ProM4Py server."""
    return bool(os.environ.get("PROM4PY_URL", "").strip())


@router.get("/capabilities")
async def capabilities() -> dict[str, bool]:
    """``prom``: whether event logs can be mined into Petri nets here. Without it, every run that
    discovers a net fails with ``prom_unavailable``; PNML files, log measures and CSV still work."""
    return {"prom": prom_available()}
