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
import re
from dataclasses import dataclass
from typing import Any, Callable

import anthropic
from pydantic import ValidationError

from config import logger
from env_config import ConfigError, choice, csv_list, positive_int, rate_limit_var, text

from .payload import PAYLOAD_FORMAT
from .prompt import SYSTEM_PROMPT, user_message
from .schema import Interpretation, tidy

EFFORTS = ("low", "medium", "high", "xhigh", "max")

#: What a model id or an effort may look like in a request: it becomes part of a file name.
CHOICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _well_formed(var: str, *values: str) -> None:
    """Refuse at startup a model or effort a request could never name: it would be offered and
    stored under a name the endpoints reject."""
    for value in values:
        if not CHOICE_RE.fullmatch(value):
            raise ConfigError(
                f"{var}: {value!r} is not a valid model or effort (letters, digits, '.', '_' and '-', "
                "at most 64 characters, starting with a letter or digit)."
            )


MODEL = text("INTERPRETATION_MODEL", "claude-opus-5-5")
_well_formed("INTERPRETATION_MODEL", MODEL)
# Claude Opus 5.5 thinks more per level than earlier models, and thinking counts towards
# MAX_TOKENS; at high, an analysis with many factors can be cut off.
EFFORT = choice("INTERPRETATION_EFFORT", "medium", EFFORTS)
_well_formed("INTERPRETATION_EFFORT", EFFORT)


def _with_default(kind: str, allowed: tuple[str, ...], default: str) -> tuple[str, ...]:
    if default in allowed:
        return allowed
    logger.warning("Default %s %s is not in the allowed list; it is added", kind, default)
    return (*allowed, default)


#: Models and efforts the UI may choose from when the server calls the API. The default
#: selection (``MODEL``, ``EFFORT``) is always part of them.
_models = csv_list("INTERPRETATION_MODELS", ("claude-opus-5-5", "claude-sonnet-5-5"))
_efforts = csv_list("INTERPRETATION_EFFORTS", ("low", "medium", "high", "xhigh"), allowed=EFFORTS, lower=True)
_well_formed("INTERPRETATION_MODELS", *_models)
_well_formed("INTERPRETATION_EFFORTS", *_efforts)
ALLOWED_MODELS = _with_default("model", _models, MODEL)
ALLOWED_EFFORTS = _with_default("effort", _efforts, EFFORT)


def allowed_models() -> tuple[str, ...]:
    """Read at call time: the default can change under tests."""
    return ALLOWED_MODELS if MODEL in ALLOWED_MODELS else (*ALLOWED_MODELS, MODEL)


def allowed_efforts() -> tuple[str, ...]:
    return ALLOWED_EFFORTS if EFFORT in ALLOWED_EFFORTS else (*ALLOWED_EFFORTS, EFFORT)
#: Live calls per session; served cache hits and precomputed results do not count.
RATE_LIMIT = rate_limit_var("INTERPRETATION_RATE_LIMIT", "10/hour")
#: Live calls per client address. Sessions are free (a request without a cookie starts one), so
#: the session limit alone does not bound what one visitor can spend.
IP_RATE_LIMIT = rate_limit_var("INTERPRETATION_IP_RATE_LIMIT", "30/hour")
#: Live calls per day over all sessions, a bound on the spending. Follow-up questions count too.
DAILY_CAP = positive_int("INTERPRETATION_DAILY_CAP", 200)
#: Of the daily calls, at most this many may be follow-up questions, so that questions cannot
#: use up the interpretations.
CHAT_DAILY_CAP = positive_int("INTERPRETATION_CHAT_DAILY_CAP", 100)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Thinking counts towards max_tokens, so leave room beyond the answer of a few hundred words;
# higher efforts think longer.
MAX_TOKENS_BY_EFFORT = {"low": 16000, "medium": 16000, "high": 24000, "xhigh": 32000, "max": 32000}
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


def make_client(key: str, timeout: float | None = None) -> Any:
    """``timeout`` is the limit of one request of the SDK; the default leaves room below
    ``TIMEOUT_S`` for the work before the call."""
    return anthropic.AsyncAnthropic(api_key=key, timeout=TIMEOUT_S - 10 if timeout is None else timeout, max_retries=2)


#: Replaced by tests with a fake client; called with the key, and with ``timeout`` only
#: when the caller sets one.
client_factory: Callable[..., Any] = make_client


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


def choice_not_allowed(model: str, effort: str) -> InterpretationError:
    return InterpretationError(
        422, "interpretation_choice_not_allowed",
        "This model or effort is not offered by the server.",
        {"model": model, "effort": effort, "models": list(allowed_models()), "efforts": list(allowed_efforts())},
    )


def check_choice(model: str, effort: str) -> None:
    """Refuse a model or effort the operator does not offer; only live calls cost money."""
    if model not in allowed_models() or effort not in allowed_efforts():
        raise choice_not_allowed(model, effort)


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


async def interpret(
    payload: dict[str, Any], language: str, key: str, timeout: float | None = None,
    *, model: str | None = None, effort: str | None = None, sdk_timeout: float | None = None,
) -> Answer:
    """``timeout`` is the time left for the call; ``TIMEOUT_S`` without it. ``model`` and
    ``effort`` default to ``MODEL`` and ``EFFORT``; ``sdk_timeout`` is the limit of one
    request of the SDK, for callers with a longer ``timeout`` than a live call."""
    timeout = TIMEOUT_S if timeout is None else timeout
    model = MODEL if model is None else model
    effort = EFFORT if effort is None else effort
    if effort not in MAX_TOKENS_BY_EFFORT:
        raise ValueError(f"Unknown effort {effort!r}")
    try:
        async with (client_factory(key) if sdk_timeout is None else client_factory(key, sdk_timeout)) as client:
            response = await asyncio.wait_for(
                client.beta.messages.create(
                    model=model,
                    max_tokens=MAX_TOKENS_BY_EFFORT[effort],
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_message(payload, language)}],
                    output_config={
                        "effort": effort,
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

    # A refusal at this point: both models declined, the category is not retried on a fallback
    # (reasoning_extraction), or the fallback could not run, e.g. because it was rate limited;
    # then stop_details names a recommended model and a later try may succeed.
    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None)
        recommended = getattr(response.stop_details, "recommended_model", None)
        logger.warning("Interpretation refused (category %s, recommended model %s)", category, recommended)
        if recommended:
            raise InterpretationError(
                503, "interpretation_fallback_unavailable",
                "The model declined, and the fallback model could not run right now. Try again later.",
            )
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
