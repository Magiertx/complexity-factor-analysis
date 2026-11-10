"""Interpretation of factor analysis results by Claude: status and the interpret endpoint."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from config import get_session_id, limiter, logger, rate_limit_key
from env_config import rate_limit
from factor_analysis.core import AnalysisError
from interpretation import chat, client, quota, store
from interpretation.client import InterpretationError
from interpretation.payload import build_payload, data_hash, effective_params, result_fingerprint
from interpretation.prompt import PROMPT_VERSION
from routes.factor_analysis import AnalyzeRequest, _AnalysisFailed, _analyze, _ready_matrix, _select

router = APIRouter(prefix="/factor-analysis", tags=["factor analysis"])

# One live call per cache key at a time; a second click waits for the first answer. Each lock
# counts the requests that hold it or wait for it and goes when the last one is done.
_LOCKS: dict[str, tuple[asyncio.Lock, int]] = {}


@asynccontextmanager
async def _key_lock(key: str) -> AsyncIterator[None]:
    lock, users = _LOCKS.get(key, (asyncio.Lock(), 0))
    _LOCKS[key] = (lock, users + 1)
    try:
        async with lock:
            yield
    finally:
        lock, users = _LOCKS[key]
        if users == 1:
            del _LOCKS[key]
        else:
            _LOCKS[key] = (lock, users - 1)


class InterpretRequest(AnalyzeRequest):
    language: Literal["en", "de"] = "en"
    #: Only look up a cached or precomputed interpretation; never calls the API.
    cached_only: bool = False
    #: The model and effort to look up or to call with; None is the server default. A live
    #: call only takes the ones the server offers (``GET /interpretation/status``); lookups
    #: take any, since they cost nothing.
    model: str | None = Field(default=None, pattern=client.CHOICE_RE.pattern)
    effort: str | None = Field(default=None, pattern=client.CHOICE_RE.pattern)


class ChatMessage(BaseModel):
    # Nothing else is taken from the browser: no content blocks, no cache_control, no other key.
    model_config = ConfigDict(extra="forbid")

    #: Checked by ``chat.check_messages``, so a mistake gets a code the UI can say.
    role: str
    #: Bounded here so that a huge body fails at validation, before anything is read.
    content: str = Field(max_length=chat.MAX_ANSWER_CHARS)
    #: Of an assistant turn: the signature the server gave the answer.
    signature: str | None = Field(default=None, max_length=128)


class ChatRequest(InterpretRequest):
    #: The conversation so far, kept by the browser, ending with the new question.
    messages: list[ChatMessage] = Field(default_factory=list)


def _error(e: InterpretationError) -> JSONResponse:
    content: dict[str, Any] = {"detail": e.detail, "code": e.code}
    if e.params:
        content["params"] = e.params
    return JSONResponse(status_code=e.status, content=content)


def _response(
    entry: dict[str, Any], *, cached: bool, precomputed: bool, variants: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        **entry["interpretation"],
        "model": entry["model"],
        "requested_model": store.requested_model(entry),
        "effort": entry.get("effort"),
        "created_at": entry["created_at"],
        "language": entry["language"],
        "prompt_version": entry["prompt_version"],
        "cached": cached,
        "precomputed": precomputed,
        "variants": variants,
    }


@router.get("/interpretation/status")
def interpretation_status() -> dict[str, Any]:
    """Whether factors can be interpreted live, and the model and effort chosen by default
    and offered; without an API key only precomputed interpretations of the bundled datasets
    are served."""
    available = client.api_key() is not None
    return {
        "available": available,
        "model": client.MODEL if available else None,
        "effort": client.EFFORT,
        "models": list(client.allowed_models()),
        "efforts": list(client.allowed_efforts()),
        "precomputed_only": not available and store.has_precomputed(),
        "chat": available,
    }


@dataclass
class _Prepared:
    meta: dict[str, Any]
    kind: str
    params: dict[str, Any]
    selection: Any
    result: dict[str, Any]
    effective: dict[str, Any]
    digest: str
    fingerprint: str
    model: str
    effort: str


async def _prepare(dataset_id: str, session_id: str, body: InterpretRequest) -> _Prepared | JSONResponse:
    """Runs the analysis in every case, lookups too: a stored interpretation is served only for
    a result with the fingerprint it was made for, and that needs the result. The fits are cached
    in the process, so a repeated request does not refit."""
    meta, data = await _ready_matrix(dataset_id, session_id)
    kind = meta["kind"]
    params = body.params(kind)
    # The rows of one miner are data of their own, with interpretations of their own.
    try:
        data, params, selection = await run_in_threadpool(_select, meta, data, body.miner, params)
    except AnalysisError as e:
        return _AnalysisFailed(e).response
    try:
        result = await _analyze(data, params)
    except _AnalysisFailed as e:
        return e.response
    effective = effective_params(params, result["n_factors"])
    digest = await run_in_threadpool(data_hash, data)
    return _Prepared(
        meta, kind, params, selection, result, effective, digest, result_fingerprint(result),
        client.MODEL if body.model is None else body.model,
        client.EFFORT if body.effort is None else body.effort,
    )


@router.post("/datasets/{dataset_id}/interpret/variants")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def interpretation_variants(
    request: Request,
    dataset_id: str,
    body: InterpretRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Any:
    """The models and efforts an interpretation of this analysis and language is stored for,
    so the UI can offer them without an API key. Never calls the API."""
    body = body or InterpretRequest()
    prepared = await _prepare(dataset_id, session_id, body)
    if isinstance(prepared, JSONResponse):
        return prepared
    found = await run_in_threadpool(
        store.variants, session_id, prepared.meta, prepared.digest, prepared.effective, prepared.fingerprint,
        body.language
    )
    return {"variants": found}


@router.post("/datasets/{dataset_id}/interpret")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def interpret_dataset(
    request: Request,
    dataset_id: str,
    body: InterpretRequest | None = None,
    session_id: str = Depends(get_session_id),
) -> Any:
    """Run the analysis with the given parameters and let Claude name and interpret its
    factors. Precomputed and cached interpretations are served without a call to the API.

    With ``cached_only`` the answer is 204 when nothing is stored yet.
    """
    started = time.monotonic()
    body = body or InterpretRequest()
    prepared = await _prepare(dataset_id, session_id, body)
    if isinstance(prepared, JSONResponse):
        return prepared
    meta, kind, params, selection, result, effective, digest, fingerprint, model, effort = (
        prepared.meta, prepared.kind, prepared.params, prepared.selection, prepared.result,
        prepared.effective, prepared.digest, prepared.fingerprint, prepared.model, prepared.effort,
    )

    def variants() -> Any:
        return run_in_threadpool(store.variants, session_id, meta, digest, effective, fingerprint, body.language)

    stored = store.lookup(session_id, meta, digest, effective, fingerprint, body.language, model, effort)
    if stored:
        entry, precomputed = stored
        return _response(entry, cached=True, precomputed=precomputed, variants=await variants())
    if body.cached_only:
        return Response(status_code=204)
    key = store.key_for(meta, digest, effective, body.language, model, effort)

    api_key = client.api_key()
    if api_key is None:
        return _error(client.unavailable())
    try:
        client.check_choice(model, effort)
    except InterpretationError as e:
        return _error(e)

    dropped = [*(meta.get("dropped") or []), *(selection.dropped if selection else [])]
    payload = build_payload(kind, result, params, dropped)
    try:
        # Before any quota is used: the size of the request bounds what one call costs.
        client.check_size(payload, body.language)
    except InterpretationError as e:
        return _error(e)

    try:
        async with _key_lock(key):
            cached = store.read_cached(session_id, meta, key)
            if cached and store.fits_result(cached, fingerprint):
                return _response(cached, cached=True, precomputed=False, variants=await variants())
            # The analysis and the wait for the lock count against the time of the request.
            time_left = client.TIMEOUT_S - (time.monotonic() - started)
            if time_left < client.MIN_CALL_S:
                raise client.timed_out()
            await run_in_threadpool(quota.claim, session_id, rate_limit_key(request))
            answer = await client.interpret(
                payload, body.language, api_key, timeout=time_left, model=model, effort=effort
            )
            entry = {
                "kind": kind,
                "data_hash": digest,
                "params": effective,
                "result_fingerprint": fingerprint,
                "language": body.language,
                "model": answer.model,
                "requested_model": model,
                "prompt_version": PROMPT_VERSION,
                "prompt_digest": client.PROMPT_DIGEST,
                "effort": effort,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "interpretation": answer.interpretation.model_dump(),
            }
            try:
                await run_in_threadpool(store.write_cached, session_id, meta, key, entry)
            except OSError as e:
                # The answer is paid for; show it even if it cannot be kept.
                logger.warning("Interpretation could not be cached: %s", e)
    except InterpretationError as e:
        return _error(e)
    return _response(entry, cached=False, precomputed=False, variants=await variants())


@router.post("/datasets/{dataset_id}/interpret/chat")
@limiter.limit(rate_limit("fa_analyze", "120/minute"))
async def interpretation_chat(
    request: Request,
    dataset_id: str,
    body: ChatRequest,
    session_id: str = Depends(get_session_id),
) -> Any:
    """Answer a follow-up question about the stored interpretation of this analysis, language,
    model and effort. The server rebuilds the context itself; every question is one live call
    and counts like a live interpretation, and against a smaller daily cap of its own. Nothing
    is stored; the answer is signed, and the browser sends it back with the signature."""
    started = time.monotonic()
    messages = [m.model_dump() for m in body.messages]
    try:
        chat.check_messages(messages)
    except InterpretationError as e:
        return _error(e)
    api_key = client.api_key()
    if api_key is None:
        return _error(client.unavailable())
    model = client.MODEL if body.model is None else body.model
    effort = client.EFFORT if body.effort is None else body.effort
    try:
        client.check_choice(model, effort)
    except InterpretationError as e:
        return _error(e)

    try:
        chat.check_history(
            messages, session_id=session_id, dataset_id=dataset_id, model=model, effort=effort,
            language=body.language,
        )
    except InterpretationError as e:
        return _error(e)

    prepared = await _prepare(dataset_id, session_id, body)
    if isinstance(prepared, JSONResponse):
        return prepared
    stored = await run_in_threadpool(
        store.lookup, session_id, prepared.meta, prepared.digest, prepared.effective, prepared.fingerprint,
        body.language, model, effort
    )
    if not stored:
        return _error(chat.interpretation_required())
    entry, _ = stored

    selection = prepared.selection
    dropped = [*(prepared.meta.get("dropped") or []), *(selection.dropped if selection else [])]
    payload = build_payload(prepared.kind, prepared.result, prepared.params, dropped)
    try:
        client.check_size(payload, body.language)
        time_left = client.TIMEOUT_S - (time.monotonic() - started)
        if time_left < client.MIN_CALL_S:
            raise client.timed_out()
        await run_in_threadpool(quota.claim, session_id, rate_limit_key(request), chat=True)
        answer = await chat.ask(
            payload, entry["interpretation"], messages, body.language,
            api_key, timeout=time_left, model=model, effort=effort,
        )
    except InterpretationError as e:
        return _error(e)
    signature = chat.sign(
        answer.text, session_id=session_id, dataset_id=dataset_id, model=model, effort=effort,
        language=body.language, position=len(messages),
    )
    return {
        "answer": answer.text, "signature": signature, "model": answer.model, "requested_model": model,
        "effort": effort,
    }
