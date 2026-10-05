"""The call to Claude through the Anthropic SDK, and how its failures reach the API client.

Request shape for Claude Opus 5.5: thinking is adaptive and always on, so ``thinking`` is not
sent, nor ``temperature``; ``output_config`` sets the effort and the JSON schema of the answer.
A request the model's safety classifiers decline is re-run server-side on the fallback model
Anthropic recommends (``fallbacks="default"``, beta ``server-side-fallback-2026-07-01``).

``messages.parse()`` would validate the text against the schema while it builds the response,
so a truncated or refused answer raised a validation error before ``stop_reason`` could be
looked at. Hence ``create()`` with the schema in ``output_config.format``, a check of
``stop_reason``, and validation afterwards.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Callable

import anthropic
from pydantic import ValidationError

from config import logger
from env_config import choice, positive_int, rate_limit_var, text

from .prompt import SYSTEM_PROMPT, user_message
from .schema import Interpretation

EFFORTS = ("low", "medium", "high", "xhigh", "max")

MODEL = text("INTERPRETATION_MODEL", "claude-opus-5-5")
# Claude Opus 5.5 defaults to medium; the interpretation is worth more thinking.
EFFORT = choice("INTERPRETATION_EFFORT", "high", EFFORTS)
#: Live calls per session; served cache hits and precomputed results do not count.
RATE_LIMIT = rate_limit_var("INTERPRETATION_RATE_LIMIT", "10/hour")
#: Live calls per day over all sessions, a bound on the spending.
DAILY_CAP = positive_int("INTERPRETATION_DAILY_CAP", 200)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Thinking counts towards max_tokens, so leave room beyond the answer of a few hundred words.
MAX_TOKENS = 16000
# The frontend's /api rewrite gives up after 180 s (proxyTimeout in next.config.mjs); retries
# of the SDK have to fit into this budget as well.
TIMEOUT_S = 170.0

OUTPUT_SCHEMA = anthropic.transform_schema(Interpretation)


def api_key() -> str | None:
    """Read at call time; never logged, never sent to the browser."""
    return os.environ.get("ANTHROPIC_API_KEY", "").strip() or None


def make_client(key: str) -> Any:
    return anthropic.AsyncAnthropic(api_key=key, timeout=TIMEOUT_S - 10, max_retries=2)


#: Replaced by tests with a fake client.
client_factory: Callable[[str], Any] = make_client


class InterpretationError(Exception):
    """A failure with the HTTP status, a stable code for the UI and a readable detail."""

    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def unavailable() -> InterpretationError:
    return InterpretationError(
        503,
        "interpretation_unavailable",
        "Interpreting factors needs an Anthropic API key on the server (ANTHROPIC_API_KEY), and "
        "none is configured.",
    )


def _timeout() -> InterpretationError:
    return InterpretationError(504, "interpretation_timeout", "The Anthropic API did not answer in time. Try again later.")


def _sdk_error(e: anthropic.AnthropicError) -> InterpretationError:
    """Maps an SDK exception; its message stays in the server log."""
    status = getattr(e, "status_code", None)
    logger.warning(
        "Interpretation request failed: %s (status %s, request id %s)",
        type(e).__name__, status, getattr(e, "request_id", None),
    )
    if isinstance(e, anthropic.APITimeoutError):
        return _timeout()
    if isinstance(e, anthropic.APIConnectionError):
        return InterpretationError(
            503, "interpretation_unreachable",
            "The server could not reach the Anthropic API; it may have no internet connection.",
        )
    if isinstance(e, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        return InterpretationError(
            502, "interpretation_auth",
            "The Anthropic API rejected the server's API key. The operator has to check it.",
        )
    if isinstance(e, anthropic.RateLimitError):
        return InterpretationError(
            429, "interpretation_upstream_limited",
            "The Anthropic API is rate limiting this server. Try again later.",
        )
    if isinstance(e, anthropic.APIStatusError) and e.status_code >= 500:
        return InterpretationError(
            503, "interpretation_upstream_unavailable",
            "The Anthropic API is unavailable or overloaded. Try again later.",
        )
    return InterpretationError(502, "interpretation_failed", "The Anthropic API could not process the request.")


@dataclass
class Answer:
    interpretation: Interpretation
    #: The model that wrote the answer; a fallback model if the requested one declined.
    model: str


async def interpret(payload: dict[str, Any], language: str, key: str) -> Answer:
    try:
        async with client_factory(key) as client:
            response = await asyncio.wait_for(
                client.beta.messages.create(
                    model=MODEL,
                    max_tokens=MAX_TOKENS,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_message(payload, language)}],
                    output_config={
                        "effort": EFFORT,
                        "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
                    },
                    fallbacks="default",
                    betas=[FALLBACK_BETA],
                ),
                TIMEOUT_S,
            )
    except anthropic.AnthropicError as e:
        raise _sdk_error(e) from None
    except asyncio.TimeoutError:
        logger.warning("Interpretation request took longer than %s s", TIMEOUT_S)
        raise _timeout() from None

    # A refusal means the requested model and the fallback both declined.
    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None)
        logger.warning("Interpretation refused (category %s)", category)
        raise InterpretationError(
            422, "interpretation_refused",
            "The model declined to interpret this analysis. The factor analysis itself is not affected.",
        )
    if response.stop_reason == "max_tokens":
        raise InterpretationError(
            502, "interpretation_incomplete", "The answer of the model was cut off. Try again, or with fewer measures.",
        )
    if response.stop_reason != "end_turn":
        logger.warning("Interpretation stopped with %s", response.stop_reason)
        raise InterpretationError(502, "interpretation_failed", "The model returned no usable answer.")

    text_block = next((b.text for b in response.content if b.type == "text"), None)
    try:
        if text_block is None:
            raise ValueError("no text block")
        result = Interpretation.model_validate_json(text_block)
    except (ValidationError, ValueError):
        logger.warning("Interpretation did not match the schema")
        raise InterpretationError(502, "interpretation_failed", "The model returned no usable answer.") from None
    return Answer(interpretation=result, model=response.model)
