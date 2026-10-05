"""Operator-tunable settings, read from the environment.

Deliberately free of project imports (only stdlib), so both ``config`` and ``jobs_db`` can use
it without an import cycle — ``config`` already imports ``jobs_db`` lazily to avoid one.

**Why anything beyond ``os.environ.get``.** The failure mode to avoid is a setting that looks
configured and silently is not: a database password that has no effect, or a signing key that
is never read. Nothing fails; the service just quietly keeps the old value. So the two rules
here are:

1. **A malformed value stops the service.** Falling back to the default would reproduce
   exactly that failure mode — an operator lowering a limit for a demo, and the old limit
   staying in force with nothing to indicate it.
2. **Every override is recorded** in :data:`OVERRIDES` and logged once at startup, so the
   effective configuration is visible rather than inferred.
"""

from __future__ import annotations

import os
import re

#: Names and values of every setting an operator actually changed. Logged at startup by
#: ``srv_main``; empty when everything runs on defaults.
OVERRIDES: dict[str, str] = {}

# slowapi accepts "5/minute" and "5 per minute". Anything else silently never matches a
# request, which is the one outcome a rate limit must not have.
_RATE_LIMIT_RE = re.compile(
    r"^\s*\d+\s*(?:/|\s+per\s+)\s*(?:second|minute|hour|day)\s*$", re.IGNORECASE
)


class ConfigError(RuntimeError):
    """Raised at import time for a value that cannot be honoured."""


def rate_limit(name: str, default: str) -> str:
    """Rate limit for one endpoint, overridable via ``RATE_LIMIT_<NAME>``.

    Format is slowapi's: ``"20/hour"``, ``"5 per minute"``. Example — throttle batches for a
    demo deployment without touching the code::

        RATE_LIMIT_BATCH=3/hour

    Note that request limits cap how often someone *starts* work, not how much they occupy:
    one batch request is up to 10 runs. To bound load, lower
    ``MAX_ACTIVE_JOBS_PER_SESSION`` instead — see :func:`positive_int`.
    """
    var = f"RATE_LIMIT_{name.upper()}"
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    value = raw.strip()
    if not _RATE_LIMIT_RE.match(value):
        raise ConfigError(
            f"{var}={raw!r} is not a valid rate limit. Expected something like '20/hour' or "
            "'5 per minute' (units: second, minute, hour, day). Refusing to start rather than "
            "falling back to the default, which would leave the intended limit silently "
            "unapplied."
        )
    OVERRIDES[var] = value
    return value


def positive_int(var: str, default: int, *, minimum: int = 1) -> int:
    """A positive integer setting, overridable via its own name.

    Used for ``MAX_ACTIVE_JOBS_PER_SESSION``, which is the limit that actually bounds server
    load: it counts what is queued or running rather than how many requests were made.
    """
    raw = os.environ.get(var)
    if raw is None or not raw.strip():
        return default

    try:
        value = int(raw.strip())
    except ValueError:
        raise ConfigError(
            f"{var}={raw!r} is not an integer. Refusing to start rather than silently keeping "
            f"the default of {default}."
        ) from None

    if value < minimum:
        raise ConfigError(f"{var}={value} is below the minimum of {minimum}.")

    OVERRIDES[var] = str(value)
    return value
