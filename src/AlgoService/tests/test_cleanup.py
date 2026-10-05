"""Regression: cleanup must never evict running or pending jobs.

The previous async-test variant used `@pytest.mark.anyio` and broke when
pytest-anyio wasn't installed in the dev env. Rewritten to the project's
sync-style test pattern (use `asyncio.run` to seed via jobs_db helpers).
"""

from __future__ import annotations

import asyncio
import shutil
import uuid
from unittest.mock import patch

import jobs_db


def _run(coro):
    return asyncio.run(coro)


def test_cleanup_old_jobs_skips_running_and_pending(client, tmp_path):
    id_completed = str(uuid.uuid4())
    id_running = str(uuid.uuid4())
    id_pending = str(uuid.uuid4())
    id_failed = str(uuid.uuid4())

    async def seed() -> None:
        await jobs_db.create_job(id_completed, "comfy", "ComFy", "file.xes", {})
        await jobs_db.create_job(id_running, "comfy", "ComFy", "file.xes", {})
        await jobs_db.create_job(id_pending, "comfy", "ComFy", "file.xes", {})
        await jobs_db.create_job(id_failed, "comfy", "ComFy", "file.xes", {})
        await jobs_db.update_job_progress(id_completed, 100.0, "Done", status="completed")
        await jobs_db.update_job_progress(id_running, 50.0, "Running", status="running")
        await jobs_db.update_job_progress(id_pending, 0.0, "Pending", status="pending")
        await jobs_db.update_job_progress(id_failed, 20.0, "Failed", status="failed")

    _run(seed())

    # Force the cleanup to think the disk is nearly full (free 5% < 10%) so it
    # actually tries to evict — otherwise the function returns early.
    fake_usage = shutil._ntuple_diskusage(100, 95, 5)

    # Create artifact folders matching each job so we can verify what gets
    # removed from disk.
    for jid in (id_completed, id_running, id_pending, id_failed):
        (tmp_path / jid).mkdir(parents=True, exist_ok=True)

    with patch("shutil.disk_usage", return_value=fake_usage), \
         patch.object(jobs_db, "ARTIFACTS_DIR", tmp_path):
        _run(jobs_db.cleanup_old_jobs())

    # Completed and failed runs are gone on disk; running and pending stay.
    assert not (tmp_path / id_completed).exists()
    assert not (tmp_path / id_failed).exists()
    assert (tmp_path / id_running).exists()
    assert (tmp_path / id_pending).exists()

    # DB matches the disk state.
    assert _run(jobs_db.read_job(id_completed)) is None
    assert _run(jobs_db.read_job(id_failed)) is None
    assert _run(jobs_db.read_job(id_running)) is not None
    assert _run(jobs_db.read_job(id_pending)) is not None
