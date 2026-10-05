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
from config import logger

from .client import DAILY_CAP, RATE_LIMIT, InterpretationError

_storage = storage_from_string(config.REDIS_URL or "memory://")
_limiter = FixedWindowRateLimiter(_storage)
SESSION_LIMIT = parse(RATE_LIMIT)
DAILY_LIMIT = parse(f"{DAILY_CAP}/day")

#: Off under pytest and with RATE_LIMIT_DISABLED=1, like the other request limits. The daily
#: cap bounds the spending and always applies.
session_limit_enabled = not config.RATE_LIMIT_DISABLED


def claim(session_id: str) -> None:
    """Count one live call, or raise if a limit is reached or cannot be counted.

    ``hit`` counts and checks in one step of the storage, so workers that claim at the same
    time cannot pass a limit together. A request the daily cap refuses has used up one call of
    its session; it could not have made it anyway.
    """
    try:
        _claim(session_id)
    except InterpretationError:
        raise
    except Exception as e:
        # Without the counters the spending is not bounded, so no call is made.
        logger.warning("Interpretation limits could not be counted: %s", type(e).__name__)
        raise InterpretationError(
            503, "interpretation_limits_unavailable",
            "The server cannot count interpretations right now. Try again later.",
        ) from None


def _claim(session_id: str) -> None:
    if session_limit_enabled and not _limiter.hit(SESSION_LIMIT, "interpretation", session_id):
        raise InterpretationError(
            429, "interpretation_rate_limited",
            f"This session has reached its limit of interpretations ({RATE_LIMIT}). Try again later.",
            {"limit": RATE_LIMIT},
        )
    if not _limiter.hit(DAILY_LIMIT, "interpretation-daily"):
        raise InterpretationError(
            429, "interpretation_daily_cap",
            "The server has used up today's interpretations. Try again tomorrow.",
        )


def reset() -> None:
    """For tests."""
    _storage.reset()
