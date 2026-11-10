"""The environment the backend reads its settings from, set before it is imported.

The backend reads most settings at import time (docs/DEPLOYMENT.md, "Running as one local
process"), so :func:`apply` has to run before the first import of ``config``, ``database`` or
``srv_main``.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path
from typing import Mapping

from .paths import AppPaths
from .state import Identity

#: Clean-up rules of the server that make no sense for one user's own data.
NEVER = ("DATA_MAX_IDLE_DAYS", "MAX_DATASETS_PER_SESSION", "LOW_DISK_CLEANUP_FREE_PCT", "SESSION_MAX_AGE")

#: Settings that would change what the launcher sets up, whoever set them: Celery and Redis,
#: the test harness (another database, no rate limits).
REMOVED = ("REDIS_URL", "RATE_LIMIT_DISABLED", "TESTING", "TEST_DATABASE_URL", "PYTEST_CURRENT_TEST")

#: Without ProM (it is not part of the desktop app yet) a run that needs it fails after this
#: many seconds instead of the server's three minutes. settings.env can raise it.
PROM4PY_START_WAIT = "2"


def sqlite_url(path: Path) -> str:
    """An aiosqlite URL for the file ``path``. SQLAlchemy unquotes the path, so it is quoted:
    a directory name with ``%``, ``#`` or ``?`` would otherwise change it."""
    return "sqlite+aiosqlite:///" + urllib.parse.quote(Path(path).resolve().as_posix(), safe="/:")


#: The prefix of an extended-length path on Windows (``\\?\C:\...``), which lifts MAX_PATH.
EXTENDED_PREFIX = "\\\\?\\"


def directory_setting(path: Path) -> str:
    """``path`` as the backend is told a data directory.

    On Windows an absolute, normalized path with the extended-length prefix: the backend appends
    ``datasets/<session>/<dataset>/stability/<key>.json`` and the like, which with a long data
    directory exceeds MAX_PATH (260) and then fails with FileNotFoundError. A UNC path or one that
    already has a double-backslash prefix is left as it is. Elsewhere it is the path itself.
    """
    text = str(path)
    if os.name != "nt" or text.startswith("\\\\"):
        return text
    return EXTENDED_PREFIX + os.path.abspath(text)


def backend_environ(
    base: Mapping[str, str],
    paths: AppPaths,
    identity: Identity,
    settings: Mapping[str, str],
    build: Mapping[str, str],
    *,
    shared_session: bool = True,
    rate_limits: bool = False,
) -> dict[str, str]:
    """The backend's environment: ``base`` (the process's own) with the launcher's settings.

    ``settings`` (settings.env) and ``build`` (APP_VERSION and APP_COMMIT of build_info.json)
    fill in what the environment does not set itself. ``shared_session=False`` leaves out
    ``SHARED_SESSION_ID``, so that each browser has a session of its own, as on a server; the
    end-to-end tests that compare two sessions need it. ``rate_limits=False`` (the default, as on
    the command line) switches the request limits off (``RATE_LIMIT_DISABLED=1``): they count per
    client address, and here every request comes from 127.0.0.1.
    """
    env = {k: v for k, v in base.items() if k not in REMOVED}
    for source in (settings, build):
        for key, value in source.items():
            env.setdefault(key, value)
    env.setdefault("PROM4PY_START_WAIT", PROM4PY_START_WAIT)
    env.update(
        {
            "DATABASE_URL": sqlite_url(paths.database),
            "ARTIFACTS_DIR": directory_setting(paths.artifacts),
            "UPLOADED_LOGS_DIR": directory_setting(paths.uploads),
            "SESSION_SECRET_KEY": identity.session_secret_key,
            # As in docker-compose.yml: the API is reached under /api.
            "FASTAPI_ROOT_PATH": "/api",
            # One BLAS thread, as in the Docker image: the results must not depend on threading.
            "OPENBLAS_NUM_THREADS": "1",
            "VECLIB_MAXIMUM_THREADS": "1",
            **{key: "never" for key in NEVER},
        }
    )
    if shared_session:
        env["SHARED_SESSION_ID"] = identity.shared_session_id
    else:
        env.pop("SHARED_SESSION_ID", None)
    if not rate_limits:
        env["RATE_LIMIT_DISABLED"] = "1"
    return env


def apply(env: Mapping[str, str]) -> None:
    """Make ``env`` the environment of this process."""
    for key in list(os.environ):
        if key not in env:
            del os.environ[key]
    os.environ.update(env)
