"""What this installation can do, for the UI to say up front."""

from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter(tags=["capabilities"])


def prom_available() -> bool:
    """ProM is there when ``PROM4PY_URL`` is set, unless ``PROM4PY_DOWN`` says it is gone for good.
    The Docker stack sets the URL; the desktop app sets it when it starts its own ProM (the edition
    with ProM) or its settings file names a ProM4Py server, and sets ``PROM4PY_DOWN`` when its own
    ProM cannot be started."""
    if os.environ.get("PROM4PY_DOWN", "").strip():
        return False
    return bool(os.environ.get("PROM4PY_URL", "").strip())


@router.get("/capabilities")
async def capabilities() -> dict[str, bool]:
    """``prom``: whether event logs can be mined into Petri nets here. Without it, every run that
    discovers a net fails with ``prom_unavailable``; PNML files, log measures and CSV still work."""
    return {"prom": prom_available()}
