"""A SQLite file as the database: one connection per concurrent session, WAL, no lock errors."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

import database
import jobs_db
import models


def _file_url(tmp_path) -> str:
    return "sqlite+aiosqlite:///" + str(tmp_path / "app.db")


def test_in_memory_sqlite_keeps_one_connection():
    engine = database.make_engine("sqlite+aiosqlite:///:memory:")
    assert isinstance(engine.pool, StaticPool)
    assert isinstance(database.make_engine("sqlite+aiosqlite://").pool, StaticPool)


def test_a_sqlite_file_gets_a_real_pool(tmp_path):
    engine = database.make_engine(_file_url(tmp_path))
    assert not isinstance(engine.pool, StaticPool)


def test_postgres_is_left_alone():
    engine = database.make_engine("postgresql+asyncpg://u:p@localhost:5432/db")
    assert not isinstance(engine.pool, StaticPool)
    assert engine.dialect.name == "postgresql"


def test_every_connection_of_a_file_is_in_wal_mode_with_a_busy_timeout(tmp_path):
    async def main():
        engine = database.make_engine(_file_url(tmp_path))
        try:
            # Two connections at once, so the pool opens two.
            async with engine.connect() as a, engine.connect() as b:
                seen = []
                for conn in (a, b):
                    mode = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
                    timeout = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
                    sync = (await conn.execute(text("PRAGMA synchronous"))).scalar()
                    seen.append((mode, timeout, sync))
            return seen
        finally:
            await engine.dispose()

    for mode, timeout, sync in asyncio.run(main()):
        assert mode == "wal"
        assert timeout == database.SQLITE_BUSY_TIMEOUT_MS
        assert sync == 1  # NORMAL


def test_parallel_writers_neither_lock_nor_mix_transactions(tmp_path):
    """Sessions that write at once on one file: no "database is locked", and a rolled-back
    transaction leaves nothing behind while the committed ones all arrive."""

    async def main():
        engine = database.make_engine(_file_url(tmp_path))
        try:
            async with engine.begin() as conn:
                await conn.run_sync(database.Base.metadata.create_all)
            factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

            async def writer(i: int) -> bool:
                keep = i % 2 == 0
                async with factory() as session:
                    run = models.Run(
                        id=uuid.uuid4(), algorithm_id="a", algorithm_name="A", filename=f"{i}.xes",
                        params_json={}, status="running",
                    )
                    session.add(run)
                    await session.flush()
                    await asyncio.sleep(0.01)  # others write while this one is open
                    for step in range(5):
                        run.progress_pct = float(step)
                        await session.flush()
                        await asyncio.sleep(0)
                    if keep:
                        await session.commit()
                    else:
                        await session.rollback()
                return keep

            async def reader() -> int:
                total = 0
                for _ in range(10):
                    async with factory() as session:
                        total += (await session.execute(select(func.count()).select_from(models.Run))).scalar_one()
                    await asyncio.sleep(0)
                return total

            kept = await asyncio.gather(*(writer(i) for i in range(12)), *(reader() for _ in range(3)))
            async with factory() as session:
                stored = (await session.execute(select(func.count()).select_from(models.Run))).scalar_one()
            return sum(1 for k in kept[:12] if k), stored
        finally:
            await engine.dispose()

    committed, stored = asyncio.run(main())
    assert committed == 6
    assert stored == committed


def test_parallel_job_updates_through_the_repository(client):
    """The repository's own functions, on the test database (a file): many progress updates
    and reads of different jobs at once."""
    job_ids = [str(uuid.uuid4()) for _ in range(8)]

    async def main():
        for job_id in job_ids:
            await jobs_db.create_job(job_id, "comfy", "ComFy", "x.xes", {})

        async def progress(job_id: str) -> None:
            for pct in range(0, 100, 10):
                await jobs_db.update_job_progress(job_id, float(pct), "working")
                await jobs_db.read_job(job_id)
            await jobs_db.update_job_progress(job_id, 100.0, "done", status="completed")

        await asyncio.gather(*(progress(j) for j in job_ids), *(jobs_db.list_jobs() for _ in range(4)))
        return await jobs_db.list_jobs()

    jobs = asyncio.run(main())
    assert {j["status"] for j in jobs if j["id"] in job_ids} == {"completed"}


@pytest.fixture(autouse=True)
def _dispose_after():
    yield
    asyncio.run(database.engine.dispose())
