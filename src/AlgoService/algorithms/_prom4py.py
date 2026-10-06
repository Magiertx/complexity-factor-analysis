"""Access to the ProM4Py client shared with the vendored ComFy miners.

ProM4Py answers one request at a time and cannot cancel a call. Discoveries therefore take
turns (``prom4py_turn``): a call never queues behind another job's call, so its timeout
measures its own work, and the watchdog of the prom4py container, which restarts ProM once
it has been busy for longer than that timeout, never cuts off a call that is still awaited.
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from vendored.comfy._shared_prom4py import (
    CALL_TIMEOUT_S,
    ProMTimeout,
    ProMUnavailable,
    call_deadline,
    get_shared_prom4py,
    is_responsive,
    last_answer,
    prom4py_url,
)

try:
    import fcntl
except ImportError:  # Windows, where only the tests run
    fcntl = None

__all__ = [
    "CALL_TIMEOUT_S",
    "ProMNotRestarted",
    "ProMTimeout",
    "ProMUnavailable",
    "WaitFn",
    "call_deadline",
    "get_prom4py",
    "prom4py_turn",
    "wait_for_prom4py",
]

#: How long to wait for ProM4Py to answer after it refused or dropped a connection. The first
#: start of a new container takes about a minute.
START_WAIT_S = 180.0

#: How long to wait for ProM4Py to answer again after a call timed out. Its watchdog restarts
#: ProM once no probe has been answered for CALL_TIMEOUT_S + 30 s. ProM answers probes until
#: the stuck request arrives, which can be well after the discovery started (a large log is
#: exported and uploaded first), so the restart can come up to about CALL_TIMEOUT_S + 40 s
#: after the timeout; usually it comes about half a minute after it and takes a few seconds.
RESTART_WAIT_S = max(START_WAIT_S, CALL_TIMEOUT_S + 60.0)

#: Called about once a second while waiting for ProM, with what is being waited for. May raise
#: to abort the wait (the progress callbacks of the jobs do when the job was aborted).
WaitFn = Callable[[str], None]


class ProMNotRestarted(ProMUnavailable):
    """ProM4Py did not answer again within ``RESTART_WAIT_S`` after a call timed out."""


# One file lock for all worker processes of a container. A lock taken on its own open file
# description, so that processes forked from one parent do not share it.
_LOCK_PATH = os.path.join(tempfile.gettempdir(), "prom4py.lock")
_thread_lock = threading.Lock()

# Left by a discovery that timed out. ProM goes on with that call until its watchdog restarts
# it, so the next discovery in this container waits for ProM before it sends anything.
_STUCK_MARK = _LOCK_PATH + ".stuck"

# ``last_answer()`` when a whole wait for ProM was last in vain; None once a wait ended with an
# answer. While ProM has not answered anything since, later waits are short, so that a job
# over many inputs fails them quickly instead of waiting for each. Any answer ends that, also
# one to a discovery that never had to wait.
_gave_up_after: float | None = None


def get_prom4py() -> Any:
    """Return the process-wide ProM4Py client pointing at ``PROM4PY_URL``."""
    return get_shared_prom4py()


@contextmanager
def prom4py_turn(on_wait: WaitFn | None = None) -> Iterator[None]:
    """Hold ProM4Py for one discovery; other processes of this container wait meanwhile.

    A :class:`ProMTimeout` inside leaves ProM busy, so the next turn starts only once ProM
    answers again (after its watchdog restarted it), and raises :class:`ProMNotRestarted` if
    it does not within ``RESTART_WAIT_S``.
    """
    release = _acquire(on_wait)
    try:
        if os.path.exists(_STUCK_MARK):
            _wait_for_restart(on_wait)
        yield
    except ProMTimeout:
        # Before the turn is released, so that no other discovery slips in.
        with open(_STUCK_MARK, "w"):
            pass
        raise
    finally:
        release()


def _wait_for_restart(on_wait: WaitFn | None) -> None:
    # The whole time, also when an earlier wait was in vain: a restart is known to be coming.
    back = _wait(on_wait, "waiting for ProM to restart", RESTART_WAIT_S)
    # Back, or it had all the time a restart takes; either way later turns stop waiting for it
    # here. Not removed when the wait was aborted, since the restart is still to come then.
    try:
        os.remove(_STUCK_MARK)
    except FileNotFoundError:
        pass
    if not back:
        raise ProMNotRestarted(
            f"ProM did not finish restarting within {RESTART_WAIT_S:g} s after a call timed out"
        )


def _acquire(on_wait: WaitFn | None) -> Callable[[], None]:
    if fcntl is None:
        while not _thread_lock.acquire(timeout=1.0):
            if on_wait:
                on_wait("waiting for ProM, another job is using it")
        return _thread_lock.release

    fd = os.open(_LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return lambda: os.close(fd)
            except BlockingIOError:
                if on_wait:
                    on_wait("waiting for ProM, another job is using it")
                time.sleep(1.0)
    except BaseException:
        os.close(fd)
        raise


def _given_up() -> bool:
    return _gave_up_after is not None and last_answer() == _gave_up_after


def wait_for_prom4py(on_wait: WaitFn | None = None, what: str = "waiting for ProM to start") -> None:
    """Wait until ProM4Py answers; raise :class:`ProMUnavailable` if it does not in time."""
    budget = 5.0 if _given_up() else START_WAIT_S
    if not _wait(on_wait, what, budget):
        raise ProMUnavailable(
            f"ProM4Py is not reachable at {prom4py_url()} and did not answer within {budget:g} s"
        )


def _wait(on_wait: WaitFn | None, what: str, budget: float) -> bool:
    """Probe ProM4Py about once a second for up to ``budget`` seconds; whether it answered."""
    global _gave_up_after
    end = time.monotonic() + budget
    while True:
        if is_responsive(timeout=max(0.5, min(5.0, end - time.monotonic()))):
            _gave_up_after = None
            return True
        if time.monotonic() >= end:
            _gave_up_after = last_answer()
            return False
        if on_wait:
            on_wait(what)
        time.sleep(1.0)
