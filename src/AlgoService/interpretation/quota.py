"""Limits on live calls to the Anthropic API: per session, per client address, and per day over
all sessions, with a smaller cap per day for follow-up questions.

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

from .client import CHAT_DAILY_CAP, DAILY_CAP, IP_RATE_LIMIT, RATE_LIMIT, InterpretationError

_storage = storage_from_string(config.REDIS_URL or "memory://")
_limiter = FixedWindowRateLimiter(_storage)
SESSION_LIMIT = parse(RATE_LIMIT)
IP_LIMIT = parse(IP_RATE_LIMIT)
DAILY_LIMIT = parse(f"{DAILY_CAP}/day")
CHAT_DAILY_LIMIT = parse(f"{CHAT_DAILY_CAP}/day")

#: Off under pytest and with RATE_LIMIT_DISABLED=1, like the other request limits (the e2e
#: suite makes all its calls from one address). The daily caps bound the spending and always
#: apply.
session_limit_enabled = not config.RATE_LIMIT_DISABLED


def claim(session_id: str, client_ip: str, *, chat: bool = False) -> None:
    """Count one live call, or raise if a limit is reached or cannot be counted.

    ``client_ip`` is the address the app's request limiter uses (``config.rate_limit_key``),
    so it follows ``X-Forwarded-For`` exactly where uvicorn trusts it. ``chat`` marks a
    follow-up question: it counts against the daily cap and the smaller one for questions.

    ``hit`` counts and checks in one step of the storage, so workers that claim at the same
    time cannot pass a limit together. A request a later limit refuses has used up one call of
    the earlier ones; it could not have made it anyway.
    """
    try:
        _claim(session_id, client_ip, chat)
    except InterpretationError:
        raise
    except Exception as e:
        # Without the counters the spending is not bounded, so no call is made.
        logger.warning("Interpretation limits could not be counted: %s", type(e).__name__)
        raise InterpretationError(
            503, "interpretation_limits_unavailable",
            "The server cannot count interpretations right now. Try again later.",
        ) from None


def _claim(session_id: str, client_ip: str, chat: bool) -> None:
    if session_limit_enabled:
        if not _limiter.hit(SESSION_LIMIT, "interpretation", session_id):
            raise InterpretationError(
                429, "interpretation_rate_limited",
                f"This session has reached its limit of calls to Claude ({RATE_LIMIT}); interpretations and "
                "follow-up questions count together. Try again later.",
                {"limit": RATE_LIMIT},
            )
        if not _limiter.hit(IP_LIMIT, "interpretation-ip", client_ip):
            raise InterpretationError(
                429, "interpretation_ip_rate_limited",
                f"This network address has reached its limit of calls to Claude ({IP_RATE_LIMIT}), whatever "
                "the session; interpretations and follow-up questions count together. Try again later.",
                {"limit": IP_RATE_LIMIT},
            )
    if chat and not _limiter.hit(CHAT_DAILY_LIMIT, "interpretation-chat-daily"):
        raise InterpretationError(
            429, "interpretation_chat_daily_cap",
            "The server has used up today's follow-up questions. Interpretations still work. Try again tomorrow.",
        )
    if not _limiter.hit(DAILY_LIMIT, "interpretation-daily"):
        raise InterpretationError(
            429, "interpretation_daily_cap",
            "The server has used up today's calls to Claude. Try again tomorrow.",
        )


def reset() -> None:
    """For tests."""
    _storage.reset()
