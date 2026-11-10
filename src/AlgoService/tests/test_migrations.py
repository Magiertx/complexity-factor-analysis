"""The Alembic migrations run on SQLite, and end at the schema of the models."""

from __future__ import annotations

import asyncio
import sqlite3

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

import database
import db_migrate


def _url(path) -> str:
    return "sqlite+aiosqlite:///" + str(path)


def test_upgrade_on_an_empty_sqlite_file_matches_the_models(tmp_path):
    path = tmp_path / "fresh.db"
    db_migrate.upgrade_to_head(_url(path))

    engine = sa.create_engine("sqlite:///" + str(path))
    try:
        with engine.connect() as conn:
            # Not compare_type: SQLite hands back UUID and JSON columns as NUMERIC/JSON stubs,
            # so a type comparison would only report the reflection. Tables, columns,
            # nullability, indexes and foreign keys are compared.
            context = MigrationContext.configure(conn, opts={"compare_type": False})
            assert compare_metadata(context, database.Base.metadata) == []

            heads = ScriptDirectory.from_config(db_migrate.alembic_config()).get_heads()
            assert [row[0] for row in conn.execute(sa.text("SELECT version_num FROM alembic_version"))] == heads
    finally:
        engine.dispose()


def test_order_index_is_not_nullable_after_the_upgrade(tmp_path):
    path = tmp_path / "fresh.db"
    db_migrate.upgrade_to_head(_url(path))
    with sqlite3.connect(path) as conn:
        columns = {row[1]: row[3] for row in conn.execute("PRAGMA table_info(artifacts)")}
    assert columns["order_index"] == 1  # NOT NULL


def test_a_second_upgrade_changes_nothing(tmp_path):
    path = tmp_path / "fresh.db"
    db_migrate.upgrade_to_head(_url(path))
    db_migrate.upgrade_to_head(_url(path))
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM alembic_version").fetchone() == (1,)


def test_downgrade_of_the_last_revision_works_on_sqlite(tmp_path):
    from alembic import command

    path = tmp_path / "fresh.db"
    db_migrate.upgrade_to_head(_url(path))
    cfg = db_migrate.alembic_config(_url(path))
    command.downgrade(cfg, "391965a3c672")
    with sqlite3.connect(path) as conn:
        assert "order_index" not in {row[1] for row in conn.execute("PRAGMA table_info(artifacts)")}


def test_the_upgrade_can_run_inside_a_running_event_loop(tmp_path):
    path = tmp_path / "fresh.db"

    async def main() -> None:
        db_migrate.upgrade_to_head(_url(path))

    asyncio.run(main())
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM alembic_version").fetchone() == (1,)


def test_a_failing_upgrade_in_a_running_loop_raises_to_the_caller(tmp_path):
    async def main() -> None:
        db_migrate.upgrade_to_head("sqlite+aiosqlite:///" + str(tmp_path / "missing-dir" / "x.db"))

    try:
        asyncio.run(main())
    except Exception:
        return
    raise AssertionError("the error of the migration was swallowed")


def test_the_migration_emits_a_plain_alter_on_postgres():
    """Batch mode must not change what Postgres gets: the same ALTER COLUMN as before."""
    import io

    from alembic.operations import Operations

    buffer = io.StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer}
    )
    with Operations.context(context):
        import importlib.util
        import pathlib

        path = next(
            pathlib.Path(db_migrate.__file__).parent.joinpath("alembic", "versions").glob("ecf06c7182ce_*.py")
        )
        spec = importlib.util.spec_from_file_location("ecf06c7182ce", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.upgrade()
    sql = buffer.getvalue()
    assert "ALTER TABLE artifacts ADD COLUMN order_index INTEGER" in sql
    assert "ALTER TABLE artifacts ALTER COLUMN order_index SET NOT NULL" in sql
    assert "CREATE TABLE" not in sql  # no table rebuild
