# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec of the desktop app (onedir). Run through ``scripts/build_desktop.py``, which
builds the static export, writes the stage directory this file reads and calls PyInstaller.

Environment:
  CFA_STAGE   the stage directory: ``meta.json`` (name, slug, version, commit, macos_min),
              ``build_info.json``, ``LICENSE`` and ``THIRD-PARTY-LICENSES.txt``

What a frozen build must carry (``desktop_app/resources.py`` is the one place that knows the
layout):
  * the backend's modules at the bundle root, with the source of ``config`` (the launcher reads
    ``APP_NAME`` from it without importing it), of ``vendored`` (``inspect.getsource`` in
    ``factor_analysis/catalog.py`` and ``provenance.py``) and of ``feeed`` (the catalog scans
    its files for the code behind each log measure);
  * the backend's data: ``datasets/``, ``sample_logs/``, ``alembic/`` (migrations are plain
    files that Alembic loads from the directory; ``alembic.ini`` is not needed);
  * the static export in ``frontend/``, ``build_info.json`` at the root;
  * the metadata of the installed packages: ``provenance.py`` asks for their versions, and some
    libraries look up entry points.
"""

import json
import os
import sys
from importlib import metadata
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

SRC = Path(SPECPATH).resolve().parent  # noqa: F821 (SPECPATH is provided by PyInstaller)
BACKEND = SRC / "AlgoService"
FRONTEND_OUT = SRC / "frontend" / "out"
STAGE = Path(os.environ["CFA_STAGE"]).resolve()
#: The app's icon (the favicon, see assets/make_icons.py): program file, window, taskbar, Dock.
ASSETS = SRC / "desktop" / "assets"
META = json.loads((STAGE / "meta.json").read_text(encoding="utf-8"))

NAME = META["name"]  # APP_NAME, the display name
SLUG = META["slug"]  # file name of the program
VERSION = META["version"]

IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"

if not (FRONTEND_OUT / "index.html").is_file():
    raise SystemExit(f"{FRONTEND_OUT / 'index.html'} is missing: run `npm run build:export` in src/frontend.")

# --- what is left out -------------------------------------------------------------------------
# Jobs run in the process (no Celery, no Postgres, no uvloop); the Docker stack keeps them.
# redis stays: config.py imports it for the in-memory fallbacks of the rate limits.
EXCLUDES = [
    "celery", "kombu", "billiard", "amqp", "vine", "asyncpg", "uvloop", "pytest", "_pytest",
    # PM4Py solves its LPs with SciPy when cvxopt is missing; see docs/DESKTOP.md.
    "cvxopt",
    # GUI toolkits and notebooks that matplotlib, pandas or networkx could pull in
    "PyQt5", "PyQt6", "PySide2", "PySide6", "wx", "gi", "IPython", "notebook", "jupyter",
    "tornado", "zmq", "sphinx",
]
EXCLUDED_DISTRIBUTIONS = {
    "celery", "kombu", "billiard", "amqp", "vine", "asyncpg", "uvloop", "pytest", "cvxopt",
    "pyinstaller", "pyinstaller-hooks-contrib", "pip-licenses",
}

# --- hidden imports ---------------------------------------------------------------------------
hiddenimports = [
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.lifespan.on",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "aiosqlite",
    "tkinter",
    "tkinter.ttk",
    "tkinter.messagebox",
    "desktop_app.main",
    # matplotlib loads the backend of a file format by name when a figure is saved
    "matplotlib.backends.backend_agg",
    "matplotlib.backends.backend_svg",
    "matplotlib.backends.backend_pdf",
]
hiddenimports += collect_submodules("alembic", filter=lambda name: not name.startswith("alembic.testing"))
# The backend's own packages are found by name below (they are not installed, so collect_submodules
# would have to import them).
for package in ("routes", "algorithms", "factor_analysis", "interpretation", "vendored"):
    for path in sorted((BACKEND / package).rglob("*.py")):
        rel = path.relative_to(BACKEND).with_suffix("")
        parts = list(rel.parts)
        if parts[-1] == "__init__":
            parts.pop()
        hiddenimports.append(".".join(parts))
for path in sorted(BACKEND.glob("*.py")):
    if path.stem not in {"celery_worker"}:
        hiddenimports.append(path.stem)

# --- data -------------------------------------------------------------------------------------
datas = [
    (str(BACKEND / "datasets"), "datasets"),
    (str(BACKEND / "sample_logs"), "sample_logs"),
    # The directory is named like the library; Alembic reads the migrations from it.
    (str(BACKEND / "alembic"), "alembic"),
    (str(FRONTEND_OUT), "frontend"),
    (str(STAGE / "build_info.json"), "."),
    # The status window's icon: the .ico on Windows (sharp in the taskbar), the .png elsewhere.
    (str(ASSETS / "icon.ico"), "."),
    (str(ASSETS / "icon.png"), "."),
    (str(STAGE / "LICENSE"), "licenses"),
    (str(STAGE / "THIRD-PARTY-LICENSES.txt"), "licenses"),
]
datas += collect_data_files("pm4py")
datas += collect_data_files("feeed")
datas += collect_data_files("factor_analyzer", include_py_files=False)

for dist in metadata.distributions():
    dist_name = (dist.metadata["Name"] or "").lower().replace("_", "-")
    if not dist_name or dist_name in EXCLUDED_DISTRIBUTIONS:
        continue
    try:
        datas += copy_metadata(dist.metadata["Name"])
    except Exception:  # a distribution without usable metadata is not needed at run time
        pass

# The source files the app reads at run time (see the module docstring).
module_collection_mode = {
    "config": "pyz+py",
    "vendored": "pyz+py",
    "feeed": "py",
}

a = Analysis(  # noqa: F821
    [str(SRC / "desktop" / "desktop_app" / "__main__.py")],
    pathex=[str(SRC / "desktop"), str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=EXCLUDES,
    noarchive=False,
    module_collection_mode=module_collection_mode,
)
pyz = PYZ(a.pure)  # noqa: F821

# --- Windows version resource -----------------------------------------------------------------
version_file = None
if IS_WINDOWS:
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
    )

    numbers = [int(p) for p in "".join(c if c.isdigit() or c == "." else "." for c in VERSION).split(".") if p][:4]
    numbers += [0] * (4 - len(numbers))
    version_file = VSVersionInfo(
        ffi=FixedFileInfo(filevers=tuple(numbers), prodvers=tuple(numbers), mask=0x3F, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0),
        kids=[
            StringFileInfo([StringTable("040904B0", [
                StringStruct("ProductName", NAME),
                StringStruct("FileDescription", NAME),
                StringStruct("FileVersion", VERSION),
                StringStruct("ProductVersion", VERSION),
                StringStruct("OriginalFilename", f"{SLUG}.exe"),
            ])]),
            VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
        ],
    )

common = dict(
    exclude_binaries=True,
    strip=False,
    upx=False,
    version=version_file,
    icon=str(ASSETS / "icon.ico") if IS_WINDOWS else None,
)

# The program: no console window on Windows and macOS. Linux starts from a terminal or a file
# manager, where a console does no harm.
exe = EXE(  # noqa: F821
    pyz, a.scripts, [], name=SLUG, console=not (IS_WINDOWS or IS_MACOS), **common,
)
exes = [exe]
if IS_WINDOWS:
    # The same program with a console: shows what it prints, and quits on Ctrl+C or Ctrl+Break
    # (a program without a console has no such signal), which the CI uses.
    exes.append(EXE(pyz, a.scripts, [], name=f"{SLUG}-console", console=True, **common))  # noqa: F821

coll = COLLECT(  # noqa: F821
    *exes, a.binaries, a.datas, strip=False, upx=False, name=SLUG,
)

if IS_MACOS:
    app = BUNDLE(  # noqa: F821
        coll,
        name=f"{NAME}.app",
        icon=str(ASSETS / "icon.icns"),
        bundle_identifier=f"io.github.magiertx.{SLUG}",
        version=VERSION,
        info_plist={
            "CFBundleName": NAME,
            "CFBundleDisplayName": NAME,
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": META["macos_min"],
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.education",
        },
    )
