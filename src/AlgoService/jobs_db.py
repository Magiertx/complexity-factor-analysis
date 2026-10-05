"""Database access repository for jobs (Runs and Artifacts)."""

from __future__ import annotations

import base64
import os
import shutil
from datetime import datetime, timezone


def _utcnow_naive() -> datetime:
    """Naive UTC ``datetime`` for persistence into naive ``DateTime`` columns.

    Mirrors the helper in ``models.py`` so we don't trip the
    ``datetime.utcnow()`` deprecation while keeping wire/storage shape stable.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
from pathlib import Path
from typing import Any
import uuid
import logging

import models
from env_config import positive_int
from database import AsyncSessionLocal, engine, Base
from sqlalchemy import select, delete, func

logger = logging.getLogger("algoservice")


ARTIFACTS_DIR = Path("/app/artifacts")


async def init_db() -> None:
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_or_create_session(session_id: str) -> str:
    """Ensure a session exists in the database. If not, create it."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(models.Session).where(models.Session.id == session_id)
        )
        db_sess = result.scalar_one_or_none()
        if not db_sess:
            db_sess = models.Session(
                id=session_id,
                created_at=_utcnow_naive(),
                last_seen=_utcnow_naive()
            )
            session.add(db_sess)
            await session.commit()
        else:
            db_sess.last_seen = _utcnow_naive()
            await session.commit()
        return session_id



# Jobs one session may have queued or running at once. A batch request enqueues up to 10
# runs, so this is the setting that bounds load; lower it for a public demo.
MAX_ACTIVE_JOBS_PER_SESSION = positive_int("MAX_ACTIVE_JOBS_PER_SESSION", 12)


async def count_active_jobs(session_id: str) -> int:
    """Jobs of this session that are queued or still running."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(func.count())
            .select_from(models.Run)
            .where(
                models.Run.owner_session_id == session_id,
                models.Run.status.in_(("pending", "running")),
            )
        )
        return int(result.scalar() or 0)


async def create_job(
    job_id: str,
    algorithm_id: str,
    algorithm_name: str,
    filename: str,
    params: dict[str, Any],
    session_id: str | None = None,
) -> dict[str, Any]:
    """Create a new Run row in the database in pending state."""
    async with AsyncSessionLocal() as session:
        run = models.Run(
            id=uuid.UUID(job_id),
            algorithm_id=algorithm_id,
            algorithm_name=algorithm_name,
            filename=filename,
            params_json=params,
            status="pending",
            progress_pct=0.0,
            progress_msg="Starting analysis...",
            created_at=_utcnow_naive(),
            owner_session_id=session_id,
        )
        session.add(run)
        await session.commit()
        return _serialize_run_meta(run)


async def read_job(job_id: str, session_id: str | None = None) -> dict[str, Any] | None:
    """Read a job and reconstruct its full dictionary, including artifacts."""
    async with AsyncSessionLocal() as session:
        # Load run and its artifacts
        try:
            uid = uuid.UUID(job_id)
        except ValueError:
            return None

        query = select(models.Run).where(models.Run.id == uid)
        if session_id:
            query = query.where(models.Run.owner_session_id == session_id)

        result = await session.execute(query)
        run = result.scalar_one_or_none()
        if not run:
            return None

        return _serialize_run_full(run)


async def update_job_progress(job_id: str, percentage: float, status_msg: str, status: str = "running") -> None:
    """Update progress percentage and status message of a running job."""
    async with AsyncSessionLocal() as session:
        uid = uuid.UUID(job_id)
        result = await session.execute(select(models.Run).where(models.Run.id == uid))
        run = result.scalar_one_or_none()
        if run:
            run.progress_pct = round(percentage, 1)
            run.progress_msg = status_msg
            if status != "running" or run.status not in ("aborted", "failed", "completed"):
                run.status = status
            if run.started_at is None and status == "running":
                run.started_at = _utcnow_naive()
            await session.commit()


async def set_job_completed(job_id: str, analysis_result: Any) -> None:
    """Mark a job as completed and save its artifacts to the DB/filesystem."""
    async with AsyncSessionLocal() as session:
        uid = uuid.UUID(job_id)
        result = await session.execute(select(models.Run).where(models.Run.id == uid))
        run = result.scalar_one_or_none()
        if not run:
            return

        run.status = "completed"
        run.progress_pct = 100.0
        run.progress_msg = "Analysis complete!"
        run.finished_at = _utcnow_naive()

        # Delete existing artifacts if any
        await session.execute(delete(models.Artifact).where(models.Artifact.run_id == uid))

        # Save new artifacts
        artifacts_payload = analysis_result.get("artifacts", [])
        for idx, art in enumerate(artifacts_payload):
            kind = art.get("kind")
            label = art.get("label", f"Artifact {idx}")
            name = art.get("name", f"artifact_{idx}")

            db_art = models.Artifact(
                id=uuid.uuid4(),
                run_id=uid,
                kind=kind,
                name=name,
                label=label,
                order_index=idx,
            )

            # Separate small vs large artifacts
            if kind in ("image", "log"):
                # Large artifacts -> filesystem + referenced from DB
                data_base64 = art.get("data_base64", "")
                if data_base64:
                    file_path, size_bytes = _save_large_artifact_file(
                        job_id, str(db_art.id), name, kind, data_base64
                    )
                    db_art.file_path = file_path
                    db_art.size_bytes = size_bytes
                    # Keep metadata in payload_json without data_base64
                    db_art.payload_json = {k: v for k, v in art.items() if k != "data_base64"}
            else:
                # Small artifacts -> payload_json in DB
                db_art.payload_json = art

            session.add(db_art)

        # Update run settings with summary if exists. Reassign instead of
        # mutating in place: params_json is a plain JSON column (no
        # MutableDict), so in-place writes are invisible to the unit of work
        # and never reach the DB.
        run.params_json = {**run.params_json, "_summary": analysis_result.get("summary", "")}
        await session.commit()


async def set_job_failed(job_id: str, error_msg: str) -> None:
    """Mark a job as failed and store the error message."""
    async with AsyncSessionLocal() as session:
        uid = uuid.UUID(job_id)
        result = await session.execute(select(models.Run).where(models.Run.id == uid))
        run = result.scalar_one_or_none()
        if run:
            run.status = "failed"
            run.error = error_msg
            run.finished_at = _utcnow_naive()
            await session.commit()


async def update_job_notes(
    job_id: str,
    notes: str | None,
    session_id: str | None = None,
) -> bool:
    """Update the free-text notes on a run.

    Returns True when the run was found and updated. Pass `notes=None` (or
    empty string) to clear the field. Capped at 2000 chars to match the
    model column.
    """
    if notes is not None:
        notes = notes.strip()
        if not notes:
            notes = None
        elif len(notes) > 2000:
            notes = notes[:2000]
    async with AsyncSessionLocal() as session:
        uid = uuid.UUID(job_id)
        query = select(models.Run).where(models.Run.id == uid)
        if session_id is not None:
            query = query.where(models.Run.owner_session_id == session_id)
        result = await session.execute(query)
        run = result.scalar_one_or_none()
        if not run:
            return False
        run.notes = notes
        await session.commit()
        return True


async def delete_job_file(job_id: str, session_id: str | None = None) -> None:
    """Delete a run from the database and clean up its filesystem artifacts."""
    async with AsyncSessionLocal() as session:
        uid = uuid.UUID(job_id)
        query = select(models.Run).where(models.Run.id == uid)
        if session_id:
            query = query.where(models.Run.owner_session_id == session_id)
        result = await session.execute(query)
        run = result.scalar_one_or_none()
        if not run:
            return

        # Delete from DB
        await session.delete(run)
        await session.commit()

        # Delete files from disk
        run_dir = ARTIFACTS_DIR / job_id
        if run_dir.exists():
            try:
                shutil.rmtree(run_dir)
            except Exception as e:
                logger.exception(f"Failed to delete job artifacts directory: {e}")


async def delete_all_jobs(session_id: str | None = None) -> None:
    """Delete all runs from the database (optionally filtered by session) and clean up their artifacts directory."""
    async with AsyncSessionLocal() as session:
        query = select(models.Run)
        if session_id:
            query = query.where(models.Run.owner_session_id == session_id)
        result = await session.execute(query)
        runs = result.scalars().all()

        for run in runs:
            job_id = str(run.id)
            await session.delete(run)

            # Clean up disk
            run_dir = ARTIFACTS_DIR / job_id
            if run_dir.exists():
                try:
                    shutil.rmtree(run_dir)
                except Exception as e:
                    logger.exception(f"Failed to delete job artifacts directory during session clear: {e}")

        await session.commit()


async def cleanup_old_jobs() -> None:
    """Check disk usage and delete oldest completed or failed runs (and their artifacts)
    until free space is at least 15%."""
    if not ARTIFACTS_DIR.exists():
        try:
            ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.exception(f"Failed to create artifacts directory: {e}")
            return

    try:
        usage = shutil.disk_usage(ARTIFACTS_DIR)
        free_pct = usage.free / usage.total
        if free_pct >= 0.10:
            return

        # Free space is less than 10%. Query completed or failed runs, oldest first.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(models.Run)
                .where(models.Run.status.in_(["completed", "failed"]))
                .order_by(models.Run.created_at.asc())
            )
            runs = result.scalars().all()

            for run in runs:
                job_id = str(run.id)
                # Delete the run (cascade deletes artifacts in DB)
                await session.delete(run)
                await session.commit()

                # Delete artifacts folder from disk
                run_dir = ARTIFACTS_DIR / job_id
                if run_dir.exists():
                    try:
                        shutil.rmtree(run_dir)
                    except Exception as e:
                        logger.exception(f"Failed to delete job artifacts directory during cleanup: {e}")

                print(f"Evicted old job {job_id} to reclaim disk space.")

                # Re-check usage
                usage = shutil.disk_usage(ARTIFACTS_DIR)
                free_pct = usage.free / usage.total
                if free_pct >= 0.15:
                    break
    except Exception as e:
        logger.exception(f"Disk space cleanup failed: {e}")



async def list_jobs(session_id: str | None = None) -> list[dict[str, Any]]:
    """Return all jobs ordered by created_at descending."""
    async with AsyncSessionLocal() as session:
        query = select(models.Run)
        if session_id:
            query = query.where(models.Run.owner_session_id == session_id)
        query = query.order_by(models.Run.created_at.desc())

        result = await session.execute(query)
        runs = result.scalars().all()
        return [_serialize_run_meta(r) for r in runs]


# --- Helper functions ---

def _tool_type_of(algorithm_id: str) -> str | None:
    """Category of the tool behind a run; batch runs are stored as ``_batch:<id>``."""
    from algorithms import get as get_algorithm

    algorithm = get_algorithm(algorithm_id.split(":", 1)[-1])
    return algorithm.tool_type if algorithm else None


def _serialize_run_meta(run: models.Run) -> dict[str, Any]:
    """Serialize basic metadata of a run.

    `params` strips internal keys (prefixed with `_`, e.g. the `_summary`
    cache written by `set_job_completed`) so the frontend only sees what the
    user actually submitted.
    """
    raw_params = run.params_json or {}
    visible_params = {k: v for k, v in raw_params.items() if not k.startswith("_")}
    return {
        "id": str(run.id),
        "algorithm_id": run.algorithm_id,
        "algorithm_name": run.algorithm_name,
        "filename": run.filename,
        "params": visible_params,
        "status": run.status,
        "percentage": run.progress_pct,
        "progress_status": run.progress_msg,
        "created_at": run.created_at.timestamp() if run.created_at else _utcnow_naive().timestamp(),
        "started_at": run.started_at.timestamp() if run.started_at else None,
        "finished_at": run.finished_at.timestamp() if run.finished_at else None,
        "error": run.error,
        "notes": run.notes,
    }


def _serialize_run_full(run: models.Run) -> dict[str, Any]:
    """Serialize full run details including reconstructed artifacts."""
    meta = _serialize_run_meta(run)

    # Reconstruct result if completed
    if run.status == "completed":
        reconstructed_artifacts = []
        for art in run.artifacts:
            art_dict = dict(art.payload_json or {})
            art_dict["kind"] = art.kind
            art_dict["name"] = art.name
            art_dict["label"] = art.label

            # Load file content if it was saved to the filesystem
            if art.kind in ("image", "log") and art.file_path:
                if os.path.exists(art.file_path):
                    try:
                        with open(art.file_path, "rb") as f:
                            art_dict["data_base64"] = base64.b64encode(f.read()).decode("utf-8")
                    except Exception as e:
                        logger.exception(f"Failed to read large artifact file at {art.file_path}: {e}")
                        art_dict["data_base64"] = ""
                else:
                    art_dict["data_base64"] = ""

            reconstructed_artifacts.append(art_dict)

        meta["result"] = {
            "algorithm": run.algorithm_id,
            "tool_type": _tool_type_of(run.algorithm_id),
            "filename": run.filename,
            "summary": run.params_json.get("_summary", ""),
            "artifacts": reconstructed_artifacts,
        }
    else:
        meta["result"] = None

    return meta


def _save_large_artifact_file(
    job_id: str, artifact_id: str, name: str, kind: str, data_base64: str
) -> tuple[str, int]:
    """Save raw file to disk and return (absolute_file_path, file_size_bytes)."""
    run_dir = ARTIFACTS_DIR / job_id
    run_dir.mkdir(parents=True, exist_ok=True)

    file_path = run_dir / f"{artifact_id}_{name}"
    file_bytes = base64.b64decode(data_base64)
    with open(file_path, "wb") as f:
        f.write(file_bytes)

    return str(file_path.absolute()), len(file_bytes)
