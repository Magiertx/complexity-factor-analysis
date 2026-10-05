"""Database configuration and session management."""

from __future__ import annotations

import os
import sys
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Detect if we are running in pytest
IS_TESTING = "pytest" in sys.modules or os.environ.get("TESTING") == "1"

if IS_TESTING:
    DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
else:
    DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@postgres:5432/complexity")

# Create engine. For SQLite in-memory, we use StaticPool to maintain a single connection.
connect_args = {}
pool_args = {}
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy.pool import StaticPool
    connect_args["check_same_thread"] = False
    pool_args["poolclass"] = StaticPool

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    **pool_args
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
