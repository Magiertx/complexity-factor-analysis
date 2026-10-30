import os
import sys
import asyncio
import logging
import signal
import threading
from celery import Celery
from celery.signals import worker_process_init

# Workaround for thread-signal binding issues in non-main threads
_orig_signal = signal.signal

def _safe_signal(sig, handler):
    if threading.current_thread() is threading.main_thread():
        try:
            return _orig_signal(sig, handler)
        except ValueError:
            pass
    return None

signal.signal = _safe_signal


# Make the app packages (algorithms, routes, vendored) importable from the worker.
_BASE = os.path.abspath(os.path.dirname(__file__))
if _BASE not in sys.path:
    sys.path.insert(0, _BASE)


logger = logging.getLogger("celery_worker")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_track_started=True,
    task_time_limit=3600,
)

_loop = None

@worker_process_init.connect
def init_worker_process(**kwargs):
    """Initialize database connection per worker process."""
    global _loop
    import jobs_db
    logger.info("Initializing worker process database connection...")
    try:
        _loop = asyncio.get_event_loop()
    except RuntimeError:
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    _loop.run_until_complete(jobs_db.init_db())

@celery_app.task(name="celery_worker.run_analysis")
def run_analysis(job_id: str, t_path: str, coerced_params: dict, algorithm_id: str):
    """Wrapper task running the process-mining analysis."""
    global _loop
    from routes.algorithms import run_analysis_task
    logger.info(f"Starting Celery task run_analysis for job {job_id} on file {t_path}")
    try:
        if _loop is None:
            try:
                _loop = asyncio.get_event_loop()
            except RuntimeError:
                _loop = asyncio.new_event_loop()
                asyncio.set_event_loop(_loop)
        _loop.run_until_complete(run_analysis_task(job_id, t_path, coerced_params, algorithm_id))
        logger.info(f"Celery task run_analysis for job {job_id} completed successfully")
    except Exception as e:
        logger.exception(f"Celery task run_analysis for job {job_id} failed: {e}")
        raise


@celery_app.task(name="celery_worker.build_dataset")
def build_dataset(job_id: str, session_id: str, dataset_id: str, spec: dict):
    """Wrapper task computing the measure values of a factor-analysis dataset."""
    global _loop
    from routes.factor_analysis import run_dataset_task
    logger.info(f"Starting Celery task build_dataset for job {job_id} ({len(spec.get('inputs', []))} inputs)")
    try:
        if _loop is None:
            try:
                _loop = asyncio.get_event_loop()
            except RuntimeError:
                _loop = asyncio.new_event_loop()
                asyncio.set_event_loop(_loop)
        _loop.run_until_complete(run_dataset_task(job_id, session_id, dataset_id, spec))
        logger.info(f"Celery task build_dataset for job {job_id} completed successfully")
    except Exception as e:
        logger.exception(f"Celery task build_dataset for job {job_id} failed: {e}")
        raise


@celery_app.task(name="celery_worker.compute_stability")
def compute_stability(job_id: str, session_id: str, dataset_id: str, request: dict):
    """Wrapper task bootstrapping the stability of a factor analysis."""
    global _loop
    from routes.factor_analysis import run_stability_task
    logger.info(f"Starting Celery task compute_stability for job {job_id} ({request.get('samples')} samples)")
    try:
        if _loop is None:
            try:
                _loop = asyncio.get_event_loop()
            except RuntimeError:
                _loop = asyncio.new_event_loop()
                asyncio.set_event_loop(_loop)
        _loop.run_until_complete(run_stability_task(job_id, session_id, dataset_id, request))
        logger.info(f"Celery task compute_stability for job {job_id} completed successfully")
    except Exception as e:
        logger.exception(f"Celery task compute_stability for job {job_id} failed: {e}")
        raise
