"""Operator-tunable settings, read from the environment.

Only stdlib imports, so both ``config`` and ``jobs_db`` can use it without an import cycle.

A malformed value raises :class:`ConfigError` at import time instead of falling back to the
default. Every override is recorded in :data:`OVERRIDES` and logged once at startup.
"""

from __future__ import annotations

import os
import re

#: Names and values of every setting an operator actually changed. Logged at startup by
#: ``srv_main``; empty when everything runs on defaults.
OVERRIDES: dict[str, str] = {}

# slowapi accepts "5/minute" and "5 per minute".
_RATE_LIMIT_RE = re.compile(
    r"^\s*\d+\s*(?:/|\s+per\s+)\s*(?:second|minute|hour|day)\s*$", re.IGNORECASE
)


class ConfigError(RuntimeError):
    """Raised at import time for a value that cannot be honoured."""


def rate_limit(name: str, default: str) -> str:
    """Rate limit for one endpoint, overridable via ``RATE_LIMIT_<NAME>``.

    Format is slowapi's: ``"20/hour"``, ``"5 per minute"``, e.g. ``RATE_LIMIT_DATASETS=3/hour``.
    This limits how often work is started; ``MAX_ACTIVE_JOBS_PER_SESSION`` limits how much
    runs at once.
    """
    return rate_limit_var(f"RATE_LIMIT_{name.upper()}", default)


def rate_limit_var(var: str, default: str) -> str:
    """A rate limit in slowapi's format, read from ``var``."""
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    value = raw.strip()
    if not _RATE_LIMIT_RE.match(value):
        raise ConfigError(
            f"{var}={raw!r} is not a valid rate limit. Expected something like '20/hour' or "
            "'5 per minute' (units: second, minute, hour, day)."
        )
    OVERRIDES[var] = value
    return value


def positive_int(var: str, default: int, *, minimum: int = 1) -> int:
    """A positive integer setting, overridable via its own name."""
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    try:
        value = int(raw.strip())
    except ValueError:
        raise ConfigError(
            f"{var}={raw!r} is not an integer (default: {default})."
        ) from None

    if value < minimum:
        raise ConfigError(f"{var}={value} is below the minimum of {minimum}.")

    OVERRIDES[var] = str(value)
    return value


def choice(var: str, default: str, allowed: tuple[str, ...]) -> str:
    """One of ``allowed``, overridable via its own name."""
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    value = raw.strip().lower()
    if value not in allowed:
        raise ConfigError(f"{var}={raw!r} is not one of {', '.join(allowed)} (default: {default}).")

    OVERRIDES[var] = value
    return value


def text(var: str, default: str) -> str:
    """A free-form setting such as a model id. Not for secrets: overrides are logged."""
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    value = raw.strip()
    OVERRIDES[var] = value
    return value


def csv_list(
    var: str, default: tuple[str, ...], *, allowed: tuple[str, ...] | None = None, lower: bool = False
) -> tuple[str, ...]:
    """A comma-separated list setting, overridable via its own name; duplicates are dropped,
    the order is kept. With ``allowed``, every item has to be one of them."""
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    items: list[str] = []
    for part in raw.split(","):
        item = part.strip().lower() if lower else part.strip()
        if not item:
            raise ConfigError(f"{var}={raw!r} contains an empty item.")
        if allowed is not None and item not in allowed:
            raise ConfigError(f"{var}={raw!r}: {item!r} is not one of {', '.join(allowed)}.")
        if item not in items:
            items.append(item)

    OVERRIDES[var] = ",".join(items)
    return tuple(items)
