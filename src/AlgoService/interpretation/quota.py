"""Limits on live calls to the Anthropic API: per session, and per day over all sessions.

Only requests that reach the API count, unlike the slowapi limits on the endpoints, which
count every request. Counters live in Redis when it is configured, so all API processes
share them.
"""

from __future__ import annotations

from limits import parse
from limits.storage import storage_from_string
from limits.strategies import FixedWindowRateLimiter

import config

from .client import DAILY_CAP, RATE_LIMIT, InterpretationError

_storage = storage_from_string(config.REDIS_URL or "memory://")
_limiter = FixedWindowRateLimiter(_storage)
SESSION_LIMIT = parse(RATE_LIMIT)
DAILY_LIMIT = parse(f"{DAILY_CAP}/day")

#: Off under pytest and with RATE_LIMIT_DISABLED=1, like the other request limits. The daily
#: cap bounds the spending and always applies.
session_limit_enabled = not config._RATE_LIMIT_DISABLED


def claim(session_id: str) -> None:
    """Count one live call, or raise if a limit is reached."""
    if session_limit_enabled and not _limiter.test(SESSION_LIMIT, "interpretation", session_id):
        raise InterpretationError(
            429, "rate_limited", f"Too many interpretations ({RATE_LIMIT} per session). Try again later.",
        )
    if not _limiter.test(DAILY_LIMIT, "interpretation-daily"):
        raise InterpretationError(
            429, "interpretation_daily_cap",
            "The server has used up today's interpretations. Try again tomorrow.",
        )
    if session_limit_enabled:
        _limiter.hit(SESSION_LIMIT, "interpretation", session_id)
    _limiter.hit(DAILY_LIMIT, "interpretation-daily")


def reset() -> None:
    """For tests."""
    _storage.reset()
