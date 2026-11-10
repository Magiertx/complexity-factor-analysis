"""The app's name and the directories it keeps its data, settings and logs in."""

from __future__ import annotations

import ast
import importlib.util
from dataclasses import dataclass
from pathlib import Path


def app_name() -> str:
    """``config.APP_NAME``, read from the source of the backend's ``config`` without running it.

    Importing ``config`` reads settings from the environment (``SHARED_SESSION_ID`` among them).
    The launcher sets those from files in the data directory, which is named after the app, so
    it needs the name before it may import ``config``. A frozen build has to ship the source of
    ``config`` for this (PyInstaller: ``module_collection_mode`` ``"pyz+py"``).
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
    def for_user(cls, name: str) -> "AppPaths":
        """The platform's directories for ``name``: on Windows ``%LOCALAPPDATA%\\<name>`` (also
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
        """Create the directories, for the owner only where the system has modes."""
        for directory in (self.data, self.config, self.logs, self.artifacts, self.uploads):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
