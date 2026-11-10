"""What the launcher keeps between starts: the session key and id, the port, the user's settings."""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import sqlite3
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("desktop")


class LauncherError(RuntimeError):
    """A problem the user has to fix; the message says how."""


def write_private_text(path: Path, text: str) -> None:
    """Write ``path`` atomically, readable by the owner only where the system has modes.

    The data go into a file that ``mkstemp`` creates in the same directory (a name nobody can
    have planted, opened with ``O_EXCL``, mode 0600), whose mode is set again before anything is
    written, and which then replaces ``path``; there is no moment where the secret is readable
    by others or written through a link. On Windows the mode only sets the read-only flag; the
    file has the permissions of its folder, which ``AppPaths.create`` restricts to the user when
    it creates the folder (an existing folder, e.g. one named with ``--data-dir``, keeps its own).
    """
    path = Path(path)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    except BaseException:
        try:
            os.unlink(name)
        except OSError:
            pass
        raise


def write_private_json(path: Path, data: dict[str, Any]) -> None:
    write_private_text(path, json.dumps(data, indent=2) + "\n")


# --- Identity -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Identity:
    """``SESSION_SECRET_KEY`` signs the session cookie; ``SHARED_SESSION_ID`` is the one session
    every request of this installation is in, so the datasets and runs live under it."""

    session_secret_key: str
    shared_session_id: str


def _is_uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def sessions_in_database(database: Path) -> list[str]:
    """The ids of the sessions the SQLite file ``database`` knows, empty if it is missing, has no
    ``sessions`` table or cannot be read. Read only."""
    if not Path(database).is_file():
        return []
    try:
        connection = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            rows = connection.execute("SELECT id FROM sessions").fetchall()
        finally:
            connection.close()
    except sqlite3.Error:
        return []
    return sorted(str(row[0]) for row in rows if _is_uuid(row[0]))


def _recover_session_id(path: Path, database: Path | None) -> str | None:
    """The one session the database holds, for a lost ``identity.json``; else ``None``.

    Every dataset and run is stored under the session id, so a new one would hide all of them.
    With exactly one session in the database that is the old id. With several it cannot be told,
    so the data stay as they are (hidden) and the log names the folder.
    """
    if database is None:
        return None
    found = sessions_in_database(database)
    if len(found) == 1:
        logger.info("%s has no session id; taking the only session of %s.", path.name, database.name)
        return found[0]
    if len(found) > 1:
        logger.warning(
            "%s has no session id and %s holds %d sessions, so the old one cannot be told: a new session "
            "starts, and the datasets and runs of the old ones stay hidden. Restore %s from a backup to get "
            "them back. Data folder: %s",
            path.name, database.name, len(found), path.name, path.parent,
        )
    return None


def load_or_create_identity(path: Path, database: Path | None = None) -> Identity:
    """The identity in ``path``, created on the first start.

    A key that is missing is made anew (a new key only invalidates the cookie). A session id
    that is there but broken stops the start: a new one would hide every dataset and run of the
    old session. One that is missing is taken from ``database`` if that holds exactly one
    session (the file was lost, not the data).
    """
    stored: dict[str, Any] = {}
    if path.exists():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(stored, dict):
                raise ValueError("not a JSON object")
        except (OSError, ValueError) as exc:
            raise LauncherError(
                f"{path} cannot be read ({exc}). It holds the session your datasets and runs "
                "belong to. Restore it from a backup, or move it away to start with an empty session."
            ) from None

    key = stored.get("session_secret_key")
    session_id = stored.get("shared_session_id")
    changed = False
    if not isinstance(key, str) or len(key) < 32:
        key = secrets.token_urlsafe(48)
        changed = True
    if session_id is None:
        session_id = _recover_session_id(path, database) or str(uuid.uuid4())
        changed = True
    elif not _is_uuid(session_id):
        raise LauncherError(
            f"{path}: shared_session_id {session_id!r} is not a UUID. Restore the file from a backup, "
            "or move it away to start with an empty session."
        )
    if changed:
        write_private_json(path, {"session_secret_key": key, "shared_session_id": str(session_id)})
    return Identity(session_secret_key=key, shared_session_id=str(uuid.UUID(str(session_id))))


# --- Port -----------------------------------------------------------------------------------


def remembered_port(path: Path) -> int | None:
    """The port of the last start, or ``None`` (first start, or a file that makes no sense)."""
    try:
        port = json.loads(path.read_text(encoding="utf-8")).get("port")
    except FileNotFoundError:
        return None
    except (OSError, ValueError, AttributeError):
        logger.warning("Ignoring %s: it cannot be read.", path)
        return None
    if isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
        return port
    logger.warning("Ignoring the port in %s: %r is not a port number.", path, port)
    return None


def remember_port(path: Path, port: int) -> None:
    write_private_text(path, json.dumps({"port": port}) + "\n")


# --- settings.env ---------------------------------------------------------------------------

#: What settings.env may set. Everything else of the backend's configuration is the launcher's
#: (database, directories, session) or keeps the backend's default.
ALLOWED_NAMES = ("ANTHROPIC_API_KEY", "LOCAL_JOB_SLOTS", "PRECOMPUTE_BUNDLED")
ALLOWED_PREFIXES = ("INTERPRETATION_", "PROM4PY_")

_LINE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def is_allowed_setting(name: str) -> bool:
    return name in ALLOWED_NAMES or name.startswith(ALLOWED_PREFIXES)


def _value(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    # An unquoted value ends at a comment after whitespace, as in a .env file of Docker Compose.
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def read_settings_env(path: Path) -> dict[str, str]:
    """The settings in ``path`` (``NAME=value`` lines, ``#`` comments), if the file exists.

    Values are never logged: the file holds the API key. Names it may not set and lines that
    are not ``NAME=value`` are skipped with a warning that names the line, not its content.
    """
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except OSError as exc:
        raise LauncherError(f"{path} cannot be read: {exc}") from None

    settings: dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _LINE.match(stripped)
        if not match:
            logger.warning("%s, line %d: not NAME=value, skipped.", path, number)
            continue
        name, raw = match.groups()
        if not is_allowed_setting(name):
            logger.warning(
                "%s, line %d: %s cannot be set there, skipped (allowed: %s, %s*).",
                path, number, name, ", ".join(ALLOWED_NAMES), "*, ".join(ALLOWED_PREFIXES),
            )
            continue
        settings[name] = _value(raw)
    return settings
