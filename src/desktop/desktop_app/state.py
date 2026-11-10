"""What the launcher keeps between starts: the session key and id, the port, the user's settings."""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("desktop")


class LauncherError(RuntimeError):
    """A problem the user has to fix; the message says how."""


def write_private_json(path: Path, data: dict[str, Any]) -> None:
    """Write ``path`` atomically, readable by the owner only where the system has modes.

    On Windows the mode only sets the read-only flag; the files lie in the user's profile,
    whose permissions keep other users out.
    """
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    if os.name != "nt":
        os.chmod(path, 0o600)


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


def load_or_create_identity(path: Path) -> Identity:
    """The identity in ``path``, created on the first start.

    A key that is missing is made anew (a new key only invalidates the cookie). A session id
    that is there but broken stops the start: a new one would hide every dataset and run of the
    old session.
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
        session_id = str(uuid.uuid4())
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
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"port": port}) + "\n", encoding="utf-8")
    os.replace(tmp, path)


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
