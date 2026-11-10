"""The app's name and the directories it keeps its data, settings and logs in."""

from __future__ import annotations

import ast
import importlib.util
import logging
import os
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .state import LauncherError

logger = logging.getLogger("desktop")

#: The folder of the app's data, settings and logs. Fixed: the display name (``APP_NAME``) will
#: change, and the data of an installation must stay where they are. It matches the repository.
DATA_DIR_NAME = "complexity-factor-analysis"


def app_name() -> str:
    """``config.APP_NAME``, read from the source of the backend's ``config`` without running it.

    Importing ``config`` reads settings from the environment (``SHARED_SESSION_ID`` among them),
    which the launcher sets first, so it needs the display name (for its messages and the status
    window) before it may import ``config``. A frozen build has to ship the source of ``config``
    for this (PyInstaller: ``module_collection_mode`` ``"pyz+py"``).
    """
    spec = importlib.util.find_spec("config")
    source = None
    if spec is not None and spec.loader is not None and hasattr(spec.loader, "get_source"):
        source = spec.loader.get_source("config")
    if source is None:
        raise RuntimeError("APP_NAME cannot be read: the source of the backend's config module is not available.")
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
        else:
            continue
        if any(isinstance(t, ast.Name) and t.id == "APP_NAME" for t in targets):
            value = ast.literal_eval(node.value)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise RuntimeError("The backend's config module has no APP_NAME = '<name>'.")


@dataclass(frozen=True)
class AppPaths:
    """Data (database, datasets, runs, uploads, the session key), settings and logs."""

    data: Path
    config: Path
    logs: Path

    @classmethod
    def for_user(cls, name: str = DATA_DIR_NAME) -> "AppPaths":
        """The platform's directories for ``name`` (always :data:`DATA_DIR_NAME`, whatever the app
        is called; the display name is not a folder name): on Windows ``%LOCALAPPDATA%\\<name>`` (also
        for the settings) with ``Logs`` in it, on macOS ``~/Library/Application Support/<name>``
        and ``~/Library/Logs/<name>``, on Linux the XDG directories."""
        import platformdirs

        return cls(
            data=platformdirs.user_data_path(name, appauthor=False),
            config=platformdirs.user_config_path(name, appauthor=False),
            logs=platformdirs.user_log_path(name, appauthor=False),
        )

    @classmethod
    def under(cls, root: Path) -> "AppPaths":
        """Everything in one directory (``--data-dir``), so a test leaves the user's alone."""
        root = Path(root).resolve()
        return cls(data=root, config=root, logs=root / "logs")

    # Data
    @property
    def database(self) -> Path:
        return self.data / "app.db"

    @property
    def artifacts(self) -> Path:
        return self.data / "artifacts"

    @property
    def uploads(self) -> Path:
        return self.data / "uploaded_logs"

    @property
    def identity(self) -> Path:
        """The key of the session cookie and the id of the one session (``state.Identity``)."""
        return self.data / "identity.json"

    @property
    def instance(self) -> Path:
        return self.data / "instance.json"

    @property
    def lock(self) -> Path:
        return self.data / "instance.lock"

    # Settings
    @property
    def settings_env(self) -> Path:
        return self.config / "settings.env"

    @property
    def launcher_state(self) -> Path:
        return self.config / "launcher.json"

    # Logs
    @property
    def log_file(self) -> Path:
        return self.logs / "app.log"

    def create(self) -> None:
        """Create the directories, for the owner only (modes on POSIX, an ACL on Windows).

        An existing directory is used as it is, except on POSIX where one that others can write
        to is refused: they could replace the secrets (``identity.json``, ``settings.env``) or
        plant files the app then reads.
        """
        for directory in (self.data, self.config, self.logs, self.artifacts, self.uploads):
            existed = directory.exists()
            if existed:
                _refuse_shared(directory)
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if not existed and os.name == "nt":
                _restrict_to_user(directory)


def _refuse_shared(directory: Path) -> None:
    if os.name == "nt" or not directory.is_dir():
        return
    mode = stat.S_IMODE(directory.stat().st_mode)
    if mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise LauncherError(
            f"{directory} can be written to by other users (mode {mode:04o}). The app keeps its secrets "
            f"there, so it needs a directory only you can write to: run `chmod go-w {directory}`, or "
            "choose another one with --data-dir."
        )


def _restrict_to_user(directory: Path) -> None:
    """Windows: only the current user (and the system) get access to a new directory, and what
    is created in it. A directory inherits the permissions of its parent otherwise, which for a
    folder outside the user's profile may include other users. Best effort; the log says if it
    did not work."""
    try:
        user = subprocess.run(
            ["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, timeout=15, check=True
        ).stdout.strip().split(",")[-1].strip().strip('"')
        if not user.startswith("S-1-"):
            raise ValueError("no SID")
        subprocess.run(
            ["icacls", str(directory), "/inheritance:r", "/grant:r", f"*{user}:(OI)(CI)F", "/grant:r", "*S-1-5-18:(OI)(CI)F"],
            capture_output=True, text=True, timeout=30, check=True,
        )
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        logger.warning("Could not restrict %s to the current user (%s); it has the permissions of its parent.", directory, exc)
