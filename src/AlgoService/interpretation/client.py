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
import hashlib
import json
import os
from dataclasses import dataclass
from typing import Any, Callable

import anthropic
from pydantic import ValidationError

from config import logger
from env_config import choice, positive_int, rate_limit_var, text

from .payload import PAYLOAD_FORMAT
from .prompt import SYSTEM_PROMPT, user_message
from .schema import Interpretation, tidy

EFFORTS = ("low", "medium", "high", "xhigh", "max")

MODEL = text("INTERPRETATION_MODEL", "claude-opus-5-5")
# Claude Opus 5.5 thinks more per level than earlier models, and thinking counts towards
# MAX_TOKENS; at high, an analysis with many factors can be cut off.
EFFORT = choice("INTERPRETATION_EFFORT", "medium", EFFORTS)
#: Live calls per session; served cache hits and precomputed results do not count.
RATE_LIMIT = rate_limit_var("INTERPRETATION_RATE_LIMIT", "10/hour")
#: Live calls per day over all sessions, a bound on the spending.
DAILY_CAP = positive_int("INTERPRETATION_DAILY_CAP", 200)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Thinking counts towards max_tokens, so leave room beyond the answer of a few hundred words.
MAX_TOKENS = 16000
# The frontend's /api rewrite gives up after 180 s (proxyTimeout in next.config.mjs). The whole
# request, the analysis before the call and the retries of the SDK included, has this budget.
TIMEOUT_S = 170.0
#: A call is not started with less time left than this.
MIN_CALL_S = 30.0

# Bounds on one request, so the daily cap also bounds the spending. The bundled log dataset
# (122 measures, 15 factors) sends about 47,000 characters.
MAX_MEASURES = 150
MAX_FACTORS = 20
MAX_NAME_LENGTH = 120
MAX_MESSAGE_CHARS = 80_000

OUTPUT_SCHEMA = anthropic.transform_schema(Interpretation)


def prompt_digest(system: str, schema: dict[str, Any], payload_format: int) -> str:
    return hashlib.sha256(json.dumps([system, schema, payload_format], sort_keys=True).encode()).hexdigest()[:16]


#: Changes with the instructions, the output schema and the payload format; part of the cache
#: key and stored with every interpretation.
PROMPT_DIGEST = prompt_digest(SYSTEM_PROMPT, OUTPUT_SCHEMA, PAYLOAD_FORMAT)


def api_key() -> str | None:
    """Read at call time; never logged, never sent to the browser."""
    return os.environ.get("ANTHROPIC_API_KEY", "").strip() or None


def make_client(key: str) -> Any:
    return anthropic.AsyncAnthropic(api_key=key, timeout=TIMEOUT_S - 10, max_retries=2)


#: Replaced by tests with a fake client.
client_factory: Callable[[str], Any] = make_client


class InterpretationError(Exception):
    """A failure with the HTTP status, a stable code for the UI and a readable detail."""

    def __init__(self, status: int, code: str, detail: str, params: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.params = params


def unavailable() -> InterpretationError:
    return InterpretationError(
        503,
        "interpretation_unavailable",
        "Interpreting factors needs an Anthropic API key on the server (ANTHROPIC_API_KEY), and "
        "none is configured.",
    )


def check_size(payload: dict[str, Any], language: str) -> None:
    """Refuse an analysis too large to send: many measures or factors, long names."""
    names = payload["measure_definitions"]
    if (
        len(payload["used_measures"]) > MAX_MEASURES
        or payload["n_factors"] > MAX_FACTORS
        or max((len(m) for m in names), default=0) > MAX_NAME_LENGTH
        or len(user_message(payload, language)) > MAX_MESSAGE_CHARS
    ):
        raise InterpretationError(
            422, "interpretation_too_large",
            f"This analysis is too large to interpret. At most {MAX_MEASURES} measures, {MAX_FACTORS} "
            f"factors and measure names of {MAX_NAME_LENGTH} characters can be sent; exclude measures "
            "or choose fewer factors.",
            {"measures": MAX_MEASURES, "factors": MAX_FACTORS, "name_length": MAX_NAME_LENGTH},
        )


def timed_out() -> InterpretationError:
    return InterpretationError(504, "interpretation_timeout", "The Anthropic API did not answer in time. Try again later.")


def _sdk_error(e: anthropic.AnthropicError) -> InterpretationError:
    """Maps an SDK exception; its message stays in the server log."""
    status = getattr(e, "status_code", None)
    logger.warning(
        "Interpretation request failed: %s (status %s, request id %s)",
        type(e).__name__, status, getattr(e, "request_id", None),
    )
    if isinstance(e, anthropic.APITimeoutError):
        return timed_out()
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
    #: Tidied: one entry per factor, only measures of the analysis.
    interpretation: Interpretation
    #: The model that wrote the answer; a fallback model if the requested one declined.
    model: str


async def interpret(payload: dict[str, Any], language: str, key: str, timeout: float | None = None) -> Answer:
    """``timeout`` is the time left for the call; ``TIMEOUT_S`` without it."""
    timeout = TIMEOUT_S if timeout is None else timeout
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
                timeout,
            )
    except anthropic.AnthropicError as e:
        raise _sdk_error(e) from None
    except asyncio.TimeoutError:
        logger.warning("Interpretation request took longer than %.0f s", timeout)
        raise timed_out() from None

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
    result = tidy(result, payload["used_measures"], payload["n_factors"])
    # A valid answer can still leave factors out; it is neither shown nor cached.
    if len(result.factors) != payload["n_factors"]:
        logger.warning("Interpretation covers %s of %s factors", len(result.factors), payload["n_factors"])
        raise InterpretationError(502, "interpretation_failed", "The model returned no usable answer.")
    return Answer(interpretation=result, model=response.model)
