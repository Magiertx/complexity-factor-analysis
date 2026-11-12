"""Database configuration and session management."""

from __future__ import annotations

import os
import sys

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Detect if we are running in pytest
IS_TESTING = "pytest" in sys.modules or os.environ.get("TESTING") == "1"

if IS_TESTING:
    DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
else:
    DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@postgres:5432/complexity")

#: How long SQLite waits for a lock before it fails with "database is locked".
SQLITE_BUSY_TIMEOUT_MS = 10_000


def is_sqlite_memory(url: str) -> bool:
    """Whether ``url`` is a SQLite database that lives in one connection's memory."""
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return False
    database = parsed.database or ""
    return database in ("", ":memory:") or "mode=memory" in database or parsed.query.get("mode") == "memory"


def _set_sqlite_pragmas(dbapi_connection, _record) -> None:
    """Applied to every new SQLite connection of the pool (file databases)."""
    cursor = dbapi_connection.cursor()
    try:
        # WAL: readers do not block the writer and vice versa. The setting is stored in the file.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        # Safe with WAL (a power cut can lose the last commits, never corrupt the file).
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def make_engine(url: str):
    """The async engine for ``url``.

    A SQLite in-memory database exists once per connection, so it gets a StaticPool that hands
    out the same connection every time. A SQLite file gets the default pool, one connection per
    concurrent session, in WAL mode with a busy timeout. Postgres is configured by its URL only.
    """
    connect_args = {}
    pool_args = {}
    file_sqlite = False
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if is_sqlite_memory(url):
            from sqlalchemy.pool import StaticPool
            pool_args["poolclass"] = StaticPool
        else:
            file_sqlite = True
            # The driver's own wait for a lock, in seconds; the pragma covers the rest.
            connect_args["timeout"] = SQLITE_BUSY_TIMEOUT_MS / 1000

    created = create_async_engine(url, echo=False, connect_args=connect_args, **pool_args)
    if file_sqlite:
        from sqlalchemy import event

        event.listen(created.sync_engine, "connect", _set_sqlite_pragmas)
    return created


engine = make_engine(DATABASE_URL)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base of all ORM models."""
    pass
