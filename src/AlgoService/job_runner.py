"""Where a job runs: a Celery worker, or this process.

With ``REDIS_URL`` set (the Docker deployment) a job goes to the Celery worker. Without it (a
single-process installation such as the desktop app) it runs here, as a background task of the
request that created it, and at most ``LOCAL_JOB_SLOTS`` of them compute at once; the others wait
as ``pending``.

The tests always run jobs here: ``database.IS_TESTING`` switches Celery off.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import weakref
from typing import Any, Awaitable, Callable

from fastapi import BackgroundTasks
from fastapi.concurrency import run_in_threadpool

from env_config import positive_int

logger = logging.getLogger("algoservice")

#: Jobs computing at once in this process (``LOCAL_JOB_SLOTS``). Each one may use several
#: threads for its own work, so the default is small.
LOCAL_JOB_SLOTS = positive_int("LOCAL_JOB_SLOTS", 2)

# A semaphore waits on the loop of its first contended use, so each loop (the server's; a fresh
# one per test) has its own.
_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def uses_celery() -> bool:
    """Whether jobs go to a Celery worker, read at call time."""
    from database import IS_TESTING

    return bool(os.environ.get("REDIS_URL")) and not IS_TESTING


def runs_jobs_itself() -> bool:
    """Whether this process runs its jobs, so that none can be alive after a restart. Never in
    the test harness, whose clients start the app on databases that hold seeded jobs."""
    from database import IS_TESTING

    return not os.environ.get("REDIS_URL") and not IS_TESTING


def _semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    slots = _slots.get(loop)
    if slots is None:
        slots = _slots[loop] = asyncio.Semaphore(LOCAL_JOB_SLOTS)
    return slots


async def _run_local(function: Callable[..., Any], args: tuple[Any, ...]) -> None:
    async with _semaphore():
        if inspect.iscoroutinefunction(function):
            await function(*args)
        else:
            result = await run_in_threadpool(function, *args)
            if inspect.isawaitable(result):
                await result


def enqueue(
    background_tasks: BackgroundTasks,
    *,
    celery_task: str,
    local: Callable[..., Awaitable[None]],
    args: tuple[Any, ...],
    label: str,
) -> None:
    """Start a job: on the Celery worker as ``celery_task``, or here by calling ``local``.

    Both get ``args``, in the same order. ``local`` is passed in (not imported) so that the
    route modules keep their task functions where tests replace them. If Celery cannot be reached
    the job runs here instead, as it always did. ``label`` names the job in the log.
    """
    if uses_celery():
        try:
            from celery_worker import celery_app

            celery_app.send_task(celery_task, args=list(args))
            logger.info("Enqueued Celery task %s for %s", celery_task, label)
            return
        except Exception:
            logger.exception("Failed to enqueue %s via Celery, falling back to local background task", label)
    background_tasks.add_task(_run_local, local, args)
