"""FastAPI entry point for the AlgoService."""

from __future__ import annotations

import asyncio
import os
import signal
import threading
import logging
from contextlib import asynccontextmanager

# Before numpy is imported: single-threaded BLAS, see the Dockerfile.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

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

import config

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import jobs_db
from config import APP_NAME, JSONFormatter, limiter
from routes import health, algorithms, jobs, factor_analysis

from starlette.middleware.sessions import SessionMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# `root_path` makes Swagger UI / ReDoc work correctly when the API is reached
# through the Next.js `/api/*` rewrite (and any further reverse proxy in front
# of it). When unset, FastAPI runs as if it owns the URL root, which is fine for
# direct backend access during development.
_fastapi_root_path = os.environ.get("FASTAPI_ROOT_PATH", "")


async def redis_listener():
    import config
    import redis.exceptions
    if not config.redis_client:
        return
    while True:
        try:
            pubsub = config.redis_client.pubsub()
            await pubsub.subscribe("jobs_updates")
            config.logger.info("Subscribed to Redis jobs_updates channel.")
            while True:
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=10.0)
                    if message:
                        data = message["data"]
                        if isinstance(data, bytes):
                            data = data.decode("utf-8")
                        await config.sse_manager.broadcast(data)
                except (redis.exceptions.TimeoutError, asyncio.TimeoutError):
                    # Normal timeout when idle, just loop again
                    continue
        except asyncio.CancelledError:
            break
        except Exception as e:
            config.logger.error(f"Redis listener connection error, retrying in 5s... Error: {e}")
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)

    # Report the tunables an operator actually changed. They are read at import time, before
    # logging is configured, so they are collected there and reported here. Silence would mean
    # a lowered limit and a running deployment are indistinguishable from a typo in .env.
    from env_config import OVERRIDES
    if OVERRIDES:
        config.logger.info(
            "Limits overridden from the environment: %s",
            ", ".join(f"{k}={v}" for k, v in sorted(OVERRIDES.items())),
        )
    else:
        config.logger.info("All request and job limits are at their defaults.")

    await jobs_db.init_db()

    redis_task: asyncio.Task[None] | None = None
    if os.environ.get("REDIS_URL"):
        redis_task = asyncio.create_task(redis_listener())

    try:
        yield
    finally:
        # Shutdown: cancel the background listener so it doesn't leak on hot
        # reload or graceful shutdown.
        if redis_task is not None:
            redis_task.cancel()
            try:
                await redis_task
            except (asyncio.CancelledError, Exception):
                pass


app = FastAPI(
    title=APP_NAME,
    version="0.1.0",
    description=(
        "Complexity measures of process models and event logs, computed with ComFy and "
        "feeed, and factor analyses over them. See /api-access in the UI for quick-start "
        "examples."
    ),
    root_path=_fastapi_root_path,
    lifespan=lifespan,
)

# Rate limiting wiring. The Limiter itself lives in config.py so routes can
# import it without circular dependencies.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS middleware configurations
cors_origins_env = os.environ.get("CORS_ORIGINS")
origins = cors_origins_env.split(",") if cors_origins_env else ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The session cookie separates users' jobs and uploads, so there is no default signing key.
_session_secret = os.environ.get("SESSION_SECRET_KEY")
if not _session_secret:
    if os.environ.get("RATE_LIMIT_DISABLED") == "1":  # test harness, see tests/conftest.py
        _session_secret = "testing-only-not-for-any-deployment"
    else:
        raise RuntimeError(
            "SESSION_SECRET_KEY is not set. Generate one with "
            "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` and pass it to "
            "the algoservice and celery_worker services (see docs/DEPLOYMENT.md)."
        )

app.add_middleware(
    SessionMiddleware,
    secret_key=_session_secret,
    session_cookie="session_id",
    same_site="lax",
    # Set SESSION_COOKIE_SECURE=1 behind TLS; off by default for http://localhost.
    https_only=os.environ.get("SESSION_COOKIE_SECURE") == "1",
)


@app.middleware("http")
async def security_headers(request, call_next):
    """Baseline security headers, independent of the reverse proxy.

    API responses are JSON and file downloads, hence `default-src 'none'`. The frontend's CSP
    is in next.config.mjs.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    # HSTS only behind TLS, same switch as the Secure cookie.
    if os.environ.get("SESSION_COOKIE_SECURE") == "1":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


# Mount modular routes
app.include_router(health.router)
app.include_router(algorithms.router)
app.include_router(jobs.router)
app.include_router(factor_analysis.router)
