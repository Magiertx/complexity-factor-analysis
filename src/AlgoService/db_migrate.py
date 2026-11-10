"""Run the Alembic migrations from Python, for a launcher that has no ``alembic`` command.

The Docker image runs ``alembic upgrade head`` in ``entrypoint.sh``; the desktop launcher calls
:func:`upgrade_to_head` before it starts the server.
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def alembic_config(database_url: str | None = None):
    """Alembic's configuration for this service, without needing ``alembic.ini`` on disk (a
    frozen build may not ship it). ``database_url`` overrides ``database.DATABASE_URL``."""
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(_HERE / "alembic"))
    if database_url:
        cfg.attributes["database_url"] = database_url
    return cfg


def upgrade_to_head(database_url: str | None = None) -> None:
    """Bring the database to the newest schema; a no-op when it is there already.

    Safe to call from a running event loop: Alembic's async environment starts a loop of its
    own, which is not allowed inside another one, so it then runs in a helper thread.
    """
    from alembic import command

    cfg = alembic_config(database_url)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        command.upgrade(cfg, "head")
        return

    errors: list[BaseException] = []

    def work() -> None:
        try:
            command.upgrade(cfg, "head")
        except BaseException as exc:  # re-raised in the caller
            errors.append(exc)

    thread = threading.Thread(target=work, name="alembic-upgrade")
    thread.start()
    thread.join()
    if errors:
        raise errors[0]
