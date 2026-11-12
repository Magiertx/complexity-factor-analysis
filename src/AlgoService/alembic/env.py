"""Alembic environment: runs the migrations of ``alembic/versions`` against the metadata of
``models``, offline (SQL script) or online through an async engine.

Used by ``alembic upgrade head`` (``entrypoint.sh``) and by ``db_migrate.upgrade_to_head``.
"""

import asyncio
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

# Ensure AlgoService directory is on sys.path so we can import database and models
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import Base, DATABASE_URL
import models  # noqa: F401  registers all models on Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata


def _database_url() -> str:
    """The database to migrate: the one a caller handed to :func:`db_migrate.upgrade_to_head`,
    else the one the service itself uses."""
    return config.attributes.get("database_url") or DATABASE_URL


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = _database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Configure the migration context on ``connection`` and run the migrations; called through ``run_sync``."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot alter columns in place; batch mode rebuilds the table there and
        # emits the ordinary ALTER statements on every other database.
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = create_async_engine(
        _database_url(),
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
