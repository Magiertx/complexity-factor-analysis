"""Algorithms capabilities and execution endpoints."""

from __future__ import annotations

import os
import time
import uuid
import tempfile
import asyncio
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, BackgroundTasks, Depends
from fastapi.concurrency import run_in_threadpool

import jobs_db
import job_runner
from job_runner import enqueue
from config import CodedHTTPException, broadcast_jobs_update, MAX_FILE_SIZE, logger, get_session_id, limiter
from env_config import data_max_idle_s, rate_limit, text
from algorithms import REGISTRY, get as get_algorithm
from algorithms.base import ParameterValidationError, TOOL_CATEGORIES

router = APIRouter()

async def _enforce_job_quota(session_id: str, requested: int = 1) -> None:
    """Refuse the request when this session already has too many jobs queued or running."""
    active = await jobs_db.count_active_jobs(session_id)
    limit = jobs_db.MAX_ACTIVE_JOBS_PER_SESSION
    if active + requested > limit:
        raise CodedHTTPException(
            429,
            (
                f"You already have {active} job(s) queued or running; this request would add "
                f"{requested}. The limit is {limit}. Wait for them to finish or abort some."
            ),
            "job_quota",
            active=active,
            requested=requested,
            limit=limit,
        )




# Recent uploads per session; a volume in the Docker image, settable like ARTIFACTS_DIR.
UPLOADED_LOGS_DIR = Path(text("UPLOADED_LOGS_DIR", "/app/uploaded_logs"))
if not UPLOADED_LOGS_DIR.exists():
    try:
        UPLOADED_LOGS_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.exception(f"Failed to create uploaded logs directory: {e}")


def _sanitize_filename(name: str) -> str:
    """Reduce a user-supplied filename to a safe basename for joining with a
    directory path. Strips any directory components (both POSIX and Windows
    separators), rejects empty / dot-only / null-byte names. Raises
    HTTPException(400) on invalid input.
    """
    # os.path.basename is platform-sensitive on Windows but the server runs in
    # a Linux container, so normalize Windows separators first so we strip them
    # regardless.
    last = os.path.basename(name.replace("\\", "/"))
    if not last or last in (".", "..") or "\x00" in last:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return last


def _make_status_cache(job_id: str, loop: asyncio.AbstractEventLoop, *, max_age_s: float = 1.0):
    """Cache the job-aborted check for `max_age_s` seconds. Workers call
    `check_aborted()` on every progress tick; without caching, an algorithm
    that progresses hundreds of times per second would issue an equivalent number of synchronous
    DB reads via `run_coroutine_threadsafe(...).result()` and exhaust the
    connection pool. Returns a callable returning True if the job is gone or
    has been marked aborted.
    """
    state = {"last_check": 0.0, "cached": False}

    def is_aborted() -> bool:
        if job_runner.is_stopping():  # the app is quitting: stop now, not after the cached answer
            return True
        now = time.time()
        if now - state["last_check"] < max_age_s:
            return state["cached"]
        state["last_check"] = now
        try:
            js = asyncio.run_coroutine_threadsafe(
                jobs_db.read_job(job_id), loop
            ).result(timeout=5.0)
            state["cached"] = not js or js.get("status") == "aborted"
        except Exception as e:
            # Transient DB or loop error: keep the cached value.
            logger.warning(f"Status check for {job_id} failed; keeping cached value: {e}")
        return state["cached"]

    return is_aborted


class _LoopCalls:
    """Coroutines a worker thread hands to the event loop of its task, without waiting.

    The task settles them before it ends. Under Celery the loop runs only while a task runs,
    so an update still in flight when the task returned stayed suspended inside its
    transaction: its row lock held every later write to that run, a delete as well, until
    the worker process ran its next task.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.futures: list[Any] = []

    def submit(self, coro: Any) -> None:
        self.futures.append(asyncio.run_coroutine_threadsafe(coro, self.loop))

    async def settle(self) -> None:
        """Wait for everything submitted so far; their errors are logged, not raised."""
        pending, self.futures = self.futures, []
        for result in await asyncio.gather(*(asyncio.wrap_future(f) for f in pending), return_exceptions=True):
            if isinstance(result, Exception):
                logger.warning(f"A progress update failed: {result}")


class _ProgressThrottle:
    """Bookkeeping for progress-cb persistence. Returns True from
    `should_persist(pct)` at most every `min_interval_s` seconds or whenever
    the percentage changes by `min_pct_delta`. Used so worker threads don't
    write to the DB on every tick."""

    def __init__(self, *, min_interval_s: float = 0.5, min_pct_delta: float = 1.0):
        self.min_interval = min_interval_s
        self.min_pct_delta = min_pct_delta
        self._last_pct = -1.0
        self._last_time = 0.0

    def should_persist(self, pct: float) -> bool:
        now = time.time()
        if abs(pct - self._last_pct) >= self.min_pct_delta or (now - self._last_time) >= self.min_interval:
            self._last_pct = pct
            self._last_time = now
            return True
        return False


#: Orphaned scratch files are deleted after this long. Generous, because the age is measured
#: against a *running* job's file too: a long run may hold one open for hours.
TMP_FILE_MAX_AGE_S = 12 * 3600

#: A session directory untouched for this long belongs to a session nobody will return to.
#: ``None`` (``DATA_MAX_IDLE_DAYS=never``) keeps them.
SESSION_DIR_MAX_IDLE_S = data_max_idle_s()


def cleanup_uploaded_logs(session_id: str):
    """Keep the 10 most recent uploads of a session and drop old scratch files.

    Uploads are capped by count. Scratch files (``tempfile.NamedTemporaryFile`` in the same
    directory) are left over when a worker is killed, so they are removed by age instead and
    do not count towards the 10, since the newest one is usually in use by a running job.
    """
    try:
        user_dir = UPLOADED_LOGS_DIR / session_id
        if not user_dir.exists():
            return

        now = time.time()
        uploads: list[Path] = []
        for path in user_dir.iterdir():
            if not path.is_file():
                continue
            if path.name.startswith("tmp"):
                try:
                    if now - path.stat().st_mtime > TMP_FILE_MAX_AGE_S:
                        path.unlink()
                except Exception:
                    pass
            else:
                uploads.append(path)

        uploads.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for old_file in uploads[10:]:
            try:
                old_file.unlink()
            except Exception:
                pass
    except Exception as e:
        logger.exception(f"Failed to clean up uploaded logs for session {session_id}: {e}")


def cleanup_orphaned_session_dirs() -> int:
    """Delete upload directories of sessions that have not been touched in a week.

    ``cleanup_uploaded_logs`` only ever runs for the session currently uploading, so a session
    that is abandoned would otherwise keep its files forever.
    Returns the number of directories removed, for logging.
    """
    removed = 0
    if SESSION_DIR_MAX_IDLE_S is None:
        return 0
    try:
        if not UPLOADED_LOGS_DIR.exists():
            return 0
        cutoff = time.time() - SESSION_DIR_MAX_IDLE_S
        for session_dir in UPLOADED_LOGS_DIR.iterdir():
            if not session_dir.is_dir():
                continue
            try:
                # Newest file in the directory, not the directory mtime: on some filesystems
                # the latter does not change when a file is merely rewritten.
                newest = max(
                    (p.stat().st_mtime for p in session_dir.iterdir() if p.is_file()),
                    default=session_dir.stat().st_mtime,
                )
                if newest < cutoff:
                    shutil.rmtree(session_dir, ignore_errors=True)
                    removed += 1
            except Exception:
                continue
    except Exception as e:
        logger.exception(f"Failed to clean up orphaned session directories: {e}")
    return removed


SAMPLE_LOGS = [
    {
        "id": "small_example",
        "name": "Small example log",
        "description": "Six synthetic traces over the activities a to e, enough to discover a model and compute its complexity.",
        "filename": "small_example.xes",
    }
]


@router.get("/algorithms")
def list_algorithms() -> dict[str, Any]:
    """List all registered algorithms and category grouping metadata."""
    return {
        "algorithms": [a.manifest() for a in REGISTRY.values()],
        "categories": TOOL_CATEGORIES,
    }


@router.get("/sample-logs")
def list_sample_logs() -> list[dict[str, Any]]:
    """List all available sample event logs."""
    sample_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_logs")
    return [
        {**s, "size_bytes": os.path.getsize(os.path.join(sample_dir, s["filename"]))}
        for s in SAMPLE_LOGS
    ]


@router.post("/log-stats")
@limiter.limit(rate_limit("log_stats", "300/hour"))
async def log_stats(
    request: Request,
    file: UploadFile | None = File(None),
    sample_log_id: str | None = Form(None),
    recent_log_id: str | None = Form(None),
    session_id: str = Depends(get_session_id),
) -> dict[str, Any]:
    """Read an uploaded / sample / recent log and compute cheap overview
    statistics. The log itself is not persisted; only the stats come back.
    """
    from log_stats import compute_log_stats

    # Resolve the source path. Mirror /analyze's accepted inputs.
    src_path: str | None = None
    cleanup_path: str | None = None
    try:
        if sample_log_id:
            sample = next((s for s in SAMPLE_LOGS if s["id"] == sample_log_id), None)
            if not sample:
                raise HTTPException(status_code=400, detail=f"Unknown sample log ID '{sample_log_id}'.")
            src_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_logs", sample["filename"])
            if not os.path.exists(src_path):
                raise HTTPException(status_code=500, detail=f"Sample log file '{sample['filename']}' not found on server.")
        elif recent_log_id:
            safe_recent = _sanitize_filename(recent_log_id)
            recent_path = UPLOADED_LOGS_DIR / session_id / safe_recent
            if not recent_path.exists():
                raise HTTPException(status_code=400, detail=f"Recent log '{safe_recent}' not found on server.")
            src_path = str(recent_path)
        else:
            if not file:
                raise HTTPException(status_code=400, detail="Either a file upload, sample_log_id or recent_log_id must be provided.")
            filename = _sanitize_filename(file.filename or "")
            allowed_extensions = {".xes", ".xes.gz", ".xml", ".json"}
            if not any(filename.lower().endswith(ext) for ext in allowed_extensions):
                raise HTTPException(status_code=400, detail="Invalid file extension. Allowed: .xes, .xes.gz, .xml, .json")
            suffix = os.path.splitext(filename)[1] or ".xes"
            if filename.lower().endswith(".xes.gz"):
                suffix = ".xes.gz"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            cleanup_path = tmp.name
            copied = 0
            try:
                while True:
                    chunk = await file.read(8192)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > MAX_FILE_SIZE:
                        raise HTTPException(status_code=400, detail="File size exceeds the 100 MB limit.")
                    tmp.write(chunk)
            finally:
                tmp.close()
            if filename.lower().endswith(".xes") or filename.lower().endswith(".xml"):
                from lxml import etree
                parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, collect_ids=False)
                try:
                    tree = etree.parse(cleanup_path, parser=parser)
                    if tree.docinfo.doctype:
                        raise HTTPException(status_code=400, detail="XML files containing DOCTYPE declarations are not allowed.")
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Security validation failed or invalid XML: {e}")
            src_path = cleanup_path

        try:
            stats = await run_in_threadpool(compute_log_stats, src_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read event log: {e}")

        return {"stats": stats}
    finally:
        if cleanup_path and os.path.exists(cleanup_path):
            try:
                os.remove(cleanup_path)
            except Exception as ex:
                logger.exception(f"Failed to remove log-stats temp file: {ex}")


@router.get("/recent-logs")
def list_recent_logs(session_id: str = Depends(get_session_id)) -> list[dict[str, Any]]:
    """List recently uploaded event logs from the server scoped by session."""
    try:
        user_dir = UPLOADED_LOGS_DIR / session_id
        if not user_dir.exists():
            return []
        files = sorted(
            [p for p in user_dir.iterdir() if p.is_file() and not p.name.startswith("tmp")],
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        return [
            {
                "id": p.name,
                "name": p.name,
                "filename": p.name,
                "size_bytes": p.stat().st_size,
                "mtime": p.stat().st_mtime,
            }
            for p in files
        ]
    except Exception as e:
        logger.exception(f"Failed to list recent logs for session {session_id}: {e}")
        return []


async def cleanup_old_jobs() -> None:
    """Periodic housekeeping. Called at the start of every job-creating request.

    `jobs_db.cleanup_old_jobs` only touches ARTIFACTS_DIR; uploaded_logs had no periodic
    caller at all, so abandoned sessions kept their files indefinitely. Runs in a thread
    because it walks the filesystem.
    """
    await jobs_db.cleanup_old_jobs()
    removed = await run_in_threadpool(cleanup_orphaned_session_dirs)
    if removed:
        logger.info(f"Removed {removed} abandoned session upload director(ies).")


async def run_analysis_task(job_id: str, t_path: str, coerced_params: dict[str, Any], algorithm_id: str):
    """Background task running the actual process-mining algorithm and saving results."""
    from algorithms.base import RunContext
    loop = asyncio.get_running_loop()
    algorithm = get_algorithm(algorithm_id)
    if not algorithm:
        logger.error(f"Cannot run task {job_id}: algorithm {algorithm_id} not found.")
        return
    updates = _LoopCalls(loop)

    try:
        job_state = await jobs_db.read_job(job_id)
        if not job_state or job_state.get("status") == "aborted":
            return
        await jobs_db.update_job_progress(job_id, 0.0, "Starting analysis...", status="running")
        await broadcast_jobs_update()
        
        check_aborted = _make_status_cache(job_id, loop)
        throttle = _ProgressThrottle()

        def progress_cb(pct: float, msg: str) -> None:
            if check_aborted():
                raise RuntimeError("Task aborted by user")
            # Fire-and-forget; the worker thread doesn't need to wait for the
            # DB write to land. Persistence + broadcast are coalesced by the
            # same throttle so they always move together.
            if throttle.should_persist(pct):
                updates.submit(jobs_db.update_job_progress(job_id, pct, msg, status="running"))
                updates.submit(broadcast_jobs_update())

        ctx = RunContext(
            run_id=job_id,
            _progress_callback=progress_cb,
            _check_aborted_callback=check_aborted,
            logger=logger,
            log_name=job_state.get("filename"),
        )
        
        # Run the blocking algorithm
        try:
            result = await asyncio.to_thread(algorithm.analyze, t_path, coerced_params, ctx)
        finally:
            await updates.settle()
        
        # Save results
        js = await jobs_db.read_job(job_id)
        if not js or js.get("status") == "aborted":
            return
        await jobs_db.set_job_completed(job_id, result.to_dict())
        await broadcast_jobs_update()
    except RuntimeError as e:
        js = await jobs_db.read_job(job_id)
        if js and ("Task aborted by user" in str(e) or js.get("status") == "aborted"):
            await jobs_db.update_job_progress(job_id, js.get("percentage", 0.0), "Aborted by user", status="aborted")
        else:
            await jobs_db.set_job_failed(job_id, str(e), getattr(e, "code", None))
        await broadcast_jobs_update()
    except Exception as e:
        await jobs_db.set_job_failed(job_id, f"Algorithm failed: {e}")
        await broadcast_jobs_update()
    finally:
        if os.path.exists(t_path):
            try:
                os.remove(t_path)
            except Exception as ex:
                logger.exception(f"Failed to remove temp file: {ex}")
        # Secondary files (e.g. an uploaded reference PNML) are passed through
        # params as "{name}_path"; clean them up alongside the main log.
        for spec in algorithm.secondary_files:
            sec_path = coerced_params.get(f"{spec.name}_path")
            if isinstance(sec_path, str) and os.path.exists(sec_path):
                try:
                    os.remove(sec_path)
                except Exception as ex:
                    logger.exception(f"Failed to remove secondary temp file: {ex}")
        await cleanup_old_jobs()


@router.post("/algorithms/{algorithm_id}/analyze")
@limiter.limit(rate_limit("analyze", "60/hour"))
async def analyze(
    request: Request,
    algorithm_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile | None = File(None),
    sample_log_id: str | None = Form(None),
    recent_log_id: str | None = Form(None),
    session_id: str = Depends(get_session_id)
) -> dict[str, Any]:
    """Upload an event log or select a sample log or recent log and enqueue it for process-mining analysis in the background."""
    algorithm = get_algorithm(algorithm_id)
    if algorithm is None:
        raise HTTPException(status_code=404, detail=f"Unknown algorithm '{algorithm_id}'.")

    form = await request.form()
    # Secondary-file fields (declared per adapter) carry UploadFile objects,
    # not parameter strings, so keep them out of raw_params.
    reserved_keys = {"file", "sample_log_id", "recent_log_id"}
    reserved_keys |= {f.name for f in algorithm.secondary_files}
    raw_params: dict[str, Any] = {}
    for key in form.keys():
        if key in reserved_keys:
            continue
        values = form.getlist(key)
        raw_params[key] = values if len(values) > 1 else values[0]

    if sample_log_id:
        sample = next((s for s in SAMPLE_LOGS if s["id"] == sample_log_id), None)
        if not sample:
            raise HTTPException(status_code=400, detail=f"Unknown sample log ID '{sample_log_id}'.")
        filename = sample["filename"]
    elif recent_log_id:
        safe_recent = _sanitize_filename(recent_log_id)
        recent_path = UPLOADED_LOGS_DIR / session_id / safe_recent
        if not recent_path.exists():
            raise HTTPException(status_code=400, detail=f"Recent log '{safe_recent}' not found on server.")
        filename = safe_recent
    else:
        if not file:
            raise HTTPException(status_code=400, detail="Either a file upload, sample_log_id or recent_log_id must be provided.")
        filename = _sanitize_filename(file.filename or "")
        # 1. Strict extension whitelist
        allowed_extensions = {".xes", ".xes.gz", ".xml", ".json"}
        has_valid_ext = any(filename.lower().endswith(ext) for ext in allowed_extensions)
        if not has_valid_ext:
            raise HTTPException(
                status_code=400,
                detail="Invalid file extension. Allowed formats: .xes, .xes.gz, .xml, .json"
            )

    await _enforce_job_quota(session_id)

    task_id = str(uuid.uuid4())
    
    # Initialize the job in jobs_store
    await jobs_db.create_job(task_id, algorithm_id, algorithm.name, filename or "uploaded_file", raw_params, session_id=session_id)
    await broadcast_jobs_update()
        
    try:
        params = algorithm.coerce_params(raw_params)
    except ParameterValidationError as e:
        await jobs_db.delete_job_file(task_id)
        await broadcast_jobs_update()
        unknown_keys = [k for k, v in e.errors.items() if v == "Unknown parameter key."]
        headers = {}
        if unknown_keys:
            headers["Warning"] = f'199 - "Unknown parameters: {", ".join(unknown_keys)}"'
        raise HTTPException(
            status_code=400,
            detail={
                "type": "validation_error",
                "errors": e.errors
            },
            headers=headers
        )
    except ValueError as e:
        await jobs_db.delete_job_file(task_id)
        await broadcast_jobs_update()
        raise HTTPException(status_code=400, detail=str(e))

    # Determine suffix correctly for .xes.gz
    suffix = os.path.splitext(filename)[1] or ".xes"
    if filename.lower().endswith(".xes.gz"):
        suffix = ".xes.gz"

    user_dir = UPLOADED_LOGS_DIR / session_id
    user_dir.mkdir(parents=True, exist_ok=True)
    # Create persistent temporary file inside shared directory that lives through background task
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=user_dir)
    tmp_path = tmp.name

    if sample_log_id:
        src_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_logs", filename)
        if not os.path.exists(src_path):
            tmp.close()
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            await jobs_db.delete_job_file(task_id)
            await broadcast_jobs_update()
            raise HTTPException(status_code=500, detail=f"Sample log file '{filename}' not found on server.")
        try:
            tmp.close()
            shutil.copyfile(src_path, tmp_path)
        except Exception as e:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            await jobs_db.delete_job_file(task_id)
            await broadcast_jobs_update()
            raise HTTPException(status_code=500, detail=f"Failed to copy sample log: {e}")
    elif recent_log_id:
        src_path = UPLOADED_LOGS_DIR / session_id / filename
        try:
            tmp.close()
            shutil.copyfile(src_path, tmp_path)
        except Exception as e:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            await jobs_db.delete_job_file(task_id)
            await broadcast_jobs_update()
            raise HTTPException(status_code=500, detail=f"Failed to copy recent log: {e}")
    else:
        # 2. Upload size limit enforced during stream copying
        try:
            copied = 0
            while True:
                chunk = await file.read(8192)
                if not chunk:
                    break
                copied += len(chunk)
                if copied > MAX_FILE_SIZE:
                    raise ValueError("File size exceeds the 100 MB limit.")
                tmp.write(chunk)
            tmp.close()
        except Exception as e:
            tmp.close()
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception as ex:
                    logger.exception(f"Failed to remove temp file: {ex}")
            await jobs_db.delete_job_file(task_id)
            await broadcast_jobs_update()
            raise HTTPException(status_code=400, detail=str(e))

        # 3. XML External Entity (XXE) and DTD injection prevention
        if filename.lower().endswith(".xes") or filename.lower().endswith(".xml"):
            try:
                from lxml import etree
                # Secure parser configuration
                parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, collect_ids=False)
                tree = etree.parse(tmp_path, parser=parser)
                if tree.docinfo.doctype:
                    raise ValueError("XML files containing DOCTYPE declarations are not allowed.")
            except Exception as e:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception as ex:
                        logger.exception(f"Failed to remove temp file: {ex}")
                await jobs_db.delete_job_file(task_id)
                await broadcast_jobs_update()
                raise HTTPException(
                    status_code=400,
                    detail=f"Security validation failed or invalid XML: {e}"
                )

        # Save copy of the valid uploaded file to user-specific UPLOADED_LOGS_DIR
        try:
            user_dir = UPLOADED_LOGS_DIR / session_id
            user_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tmp_path, user_dir / filename)
            cleanup_uploaded_logs(session_id)
        except Exception as e:
            logger.exception(f"Failed to save copy of uploaded file to recent history: {e}")

    # ---- Secondary files (adapter-declared, e.g. a reference PNML) ----------
    # Saved to temp paths and injected into params as "{name}_path"; the
    # background task's cleanup removes them together with the main log.
    secondary_tmp_paths: list[str] = []

    async def _fail_secondary(status_code: int, detail: str):
        for p in secondary_tmp_paths + [tmp_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
        await jobs_db.delete_job_file(task_id)
        await broadcast_jobs_update()
        raise HTTPException(status_code=status_code, detail=detail)

    for spec in algorithm.secondary_files:
        upload = form.get(spec.name)
        if upload is None or isinstance(upload, str):
            if not spec.optional:
                await _fail_secondary(400, f"Missing required file '{spec.name}' ({spec.label}).")
            continue
        sec_name = _sanitize_filename(upload.filename or "")
        allowed_exts = {ext.strip().lower() for ext in spec.accept.split(",") if ext.strip()}
        if not any(sec_name.lower().endswith(ext) for ext in allowed_exts):
            await _fail_secondary(
                400,
                f"Invalid extension for '{spec.label}'. Allowed: {spec.accept}",
            )
        sec_suffix = os.path.splitext(sec_name)[1] or ".pnml"
        sec_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=sec_suffix, dir=user_dir)
        sec_tmp_path = sec_tmp.name
        secondary_tmp_paths.append(sec_tmp_path)
        try:
            copied = 0
            while True:
                chunk = await upload.read(8192)
                if not chunk:
                    break
                copied += len(chunk)
                if copied > MAX_FILE_SIZE:
                    raise ValueError("File size exceeds the 100 MB limit.")
                sec_tmp.write(chunk)
            sec_tmp.close()
        except Exception as e:
            sec_tmp.close()
            await _fail_secondary(400, f"Failed to read '{spec.label}': {e}")
        # PNML is XML too, so apply the same XXE/DOCTYPE check as for the log.
        try:
            from lxml import etree
            parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, collect_ids=False)
            tree = etree.parse(sec_tmp_path, parser=parser)
            if tree.docinfo.doctype:
                raise ValueError("XML files containing DOCTYPE declarations are not allowed.")
        except Exception as e:
            await _fail_secondary(400, f"Security validation failed or invalid XML in '{spec.label}': {e}")
        params[f"{spec.name}_path"] = sec_tmp_path
        # Original filename for display; the temp path's name is meaningless.
        params[f"{spec.name}_filename"] = sec_name

    enqueue(
        background_tasks,
        celery_task="celery_worker.run_analysis",
        local=run_analysis_task,
        args=(task_id, tmp_path, params, algorithm_id),
        label=f"job {task_id}",
    )

    return {
        "algorithm": algorithm_id,
        "tool_type": algorithm.tool_type,
        "filename": filename,
        "job_id": task_id,
        "status": "pending"
    }
