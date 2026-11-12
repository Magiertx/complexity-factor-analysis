"""Where the launcher finds what it ships with: the backend, the static export of the frontend
and ``build_info.json``.

This is the only module that knows the layout. From a source checkout everything is where the
repository keeps it. In a frozen build (PyInstaller) it is under the bundle directory
(``sys._MEIPASS``): the backend's modules and data files at its root, as the backend's own
``__file__``-relative paths expect (``datasets/``, ``alembic/``), the export in ``frontend/``
and ``build_info.json`` next to them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def is_frozen() -> bool:
    """Whether this runs from a PyInstaller-style bundle rather than a checkout."""
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path:
    """The bundle directory of a frozen build, or ``src/`` of the checkout."""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent.parent


def backend_dir() -> Path:
    """The directory of the backend's top-level modules (``config``, ``srv_main``, ...)."""
    return bundle_root() if is_frozen() else bundle_root() / "AlgoService"


def frontend_dir() -> Path:
    """The static export of the frontend (``npm run build:export`` writes ``src/frontend/out``)."""
    return bundle_root() / "frontend" if is_frozen() else bundle_root() / "frontend" / "out"


def icon_path(suffix: str) -> Path:
    """The app's icon, ``.ico`` or ``.png`` (``src/desktop/assets``, made by ``make_icons.py``)."""
    name = f"icon{suffix}"
    return bundle_root() / name if is_frozen() else bundle_root() / "desktop" / "assets" / name


def build_info_path() -> Path:
    """The ``build_info.json`` written at build time (version and commit)."""
    return bundle_root() / "build_info.json" if is_frozen() else bundle_root() / "desktop" / "build_info.json"


def prepare_import_path() -> None:
    """Make the backend importable; a frozen build has it in its archive already."""
    if is_frozen():
        return
    path = str(backend_dir())
    if path not in sys.path:
        sys.path.insert(0, path)


def build_info() -> dict[str, str]:
    """``APP_VERSION`` and ``APP_COMMIT`` as the build wrote them into ``build_info.json``.

    A frozen build has no ``.git``, so without them the provenance of every export would say
    "unknown". Empty when the file is missing (a source checkout, where git answers); a file
    that is there but unreadable is an error of the build.
    """
    path = build_info_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"{path} cannot be read: {exc}") from exc
    if not isinstance(raw, dict):
        raise RuntimeError(f"{path} is not a JSON object.")
    return {
        key: raw[key].strip()
        for key in ("APP_VERSION", "APP_COMMIT")
        if isinstance(raw.get(key), str) and raw[key].strip()
    }
