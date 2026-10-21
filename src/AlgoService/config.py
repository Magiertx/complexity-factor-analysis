"""Configuration, shared managers, and common helper utilities."""

from __future__ import annotations

import os
import re
import json
import logging
import asyncio
from typing import Any, Set
from fastapi import HTTPException

# Product name shown in the API docs and wherever the backend names itself. The frontend has
# its own copy in src/frontend/lib/app-config.ts.
APP_NAME = "Complexity Factor Analysis"

# Logger initialization
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)

logger = logging.getLogger("algoservice")

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


class CodedHTTPException(HTTPException):
    """An HTTP error that also carries ``code`` and ``params`` next to ``detail``, like the
    analysis errors, so the UI can say it in its own language. srv_main renders the body."""

    def __init__(self, status_code: int, detail: str, code: str, **params: Any) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
        self.params = params

# SSE Connection Management
class SSEConnectionManager:
    def __init__(self):
        self.active_queues: Set[asyncio.Queue] = set()

    def connect(self) -> asyncio.Queue:
        queue = asyncio.Queue()
        self.active_queues.add(queue)
        return queue

    def disconnect(self, queue: asyncio.Queue):
        if queue in self.active_queues:
            self.active_queues.remove(queue)

    async def broadcast(self, message: str):
        for queue in list(self.active_queues):
            try:
                await queue.put(message)
            except Exception:
                pass

sse_manager = SSEConnectionManager()

import redis.asyncio as aioredis

REDIS_URL = os.environ.get("REDIS_URL")
redis_client = aioredis.from_url(REDIS_URL) if REDIS_URL else None

async def broadcast_jobs_update():
    await sse_manager.broadcast("update")
    if redis_client:
        try:
            await redis_client.publish("jobs_updates", "update")
        except Exception as e:
            logger.error(f"Failed to publish to Redis: {e}")


# Common validation helpers
def validate_job_id(job_id: str) -> None:
    if not re.match(r"^[a-f0-9-]{36}$", job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format.")


import uuid
from fastapi import Request

def ensure_session_cookie(request: Request) -> str:
    """The caller's session id, guaranteed to be a well-formed UUID; starts a session if needed.

    The id is used as a path component for the per-session upload directory, so a value like
    ``../..`` must never get through. Anything that is not a UUID is replaced by a fresh one,
    so a tampered or corrupted cookie starts a new session instead of returning an error.
    The cookie is set by the session middleware when the response goes out.
    """
    session_id = request.session.get("session_id")
    if session_id is not None:
        try:
            uuid.UUID(str(session_id))
        except (ValueError, AttributeError, TypeError):
            logger.warning("Discarding malformed session id from cookie.")
            session_id = None

    if not session_id:
        session_id = str(uuid.uuid4())
        request.session["session_id"] = session_id
    return session_id


async def get_session_id(request: Request) -> str:
    """The caller's session id (see :func:`ensure_session_cookie`), known to the database."""
    session_id = ensure_session_cookie(request)

    # Lazy import to prevent circular references
    import jobs_db
    await jobs_db.get_or_create_session(session_id)
    return session_id


# Rate limiting (slowapi). Counter storage uses Redis when available so
# limits are shared across worker processes; falls back to in-memory for
# tests / local runs without Redis.
from slowapi import Limiter
from slowapi.util import get_remote_address

from env_config import rate_limit

# Disabled entirely in pytest so the test suite can hammer endpoints without
# hitting limits. Honors `RATE_LIMIT_DISABLED=1` for the same reason in dev.
RATE_LIMIT_DISABLED = os.environ.get("PYTEST_CURRENT_TEST") is not None \
    or os.environ.get("RATE_LIMIT_DISABLED") == "1"

_proxy_misconfig_warned = False


def rate_limit_key(request: Request) -> str:
    """Per-client key for rate limiting.

    Requests reach algoservice through the frontend container, so the client address is only
    per-user if uvicorn trusts ``X-Forwarded-For`` from that container (``FORWARDED_ALLOW_IPS``
    in ``docker-compose.yml``). If a request carries the header but the resolved address is not
    one of its hops, the header was ignored and a warning is logged once.
    """
    global _proxy_misconfig_warned
    client_host = get_remote_address(request)

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and not _proxy_misconfig_warned:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops and client_host not in hops:
            _proxy_misconfig_warned = True
            logger.warning(
                "Rate limiting is not per-client: X-Forwarded-For is present (%s) but the "
                "request resolves to %s, so uvicorn did not trust the proxy. Every caller "
                "shares one counter. Set FORWARDED_ALLOW_IPS to the address or subnet the "
                "requests arrive from (see docs/DEPLOYMENT.md). Warned once per process.",
                forwarded,
                client_host,
            )

    return client_host


limiter = Limiter(
    key_func=rate_limit_key,
    storage_uri=REDIS_URL if REDIS_URL else "memory://",
    enabled=not RATE_LIMIT_DISABLED,
    default_limits=[rate_limit("default", "120/minute")],
)
