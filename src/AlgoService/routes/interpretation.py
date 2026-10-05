"""Interpretation of factor analysis results by Claude: status and the interpret endpoint."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from config import get_session_id, limiter
from env_config import rate_limit
from interpretation import client, quota, store
from interpretation.client import InterpretationError
from interpretation.payload import build_payload, data_hash, effective_params
from interpretation.prompt import PROMPT_VERSION
from routes.factor_analysis import AnalyzeRequest, _AnalysisFailed, _analyze, _ready_matrix

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


def _error(e: InterpretationError) -> JSONResponse:
    content: dict[str, Any] = {"detail": e.detail, "code": e.code}
    if e.params:
        content["params"] = e.params
    return JSONResponse(status_code=e.status, content=content)


def _response(entry: dict[str, Any], *, cached: bool, precomputed: bool) -> dict[str, Any]:
    return {
        **entry["interpretation"],
        "model": entry["model"],
        "created_at": entry["created_at"],
        "language": entry["language"],
        "prompt_version": entry["prompt_version"],
        "cached": cached,
        "precomputed": precomputed,
    }


@router.get("/interpretation/status")
def interpretation_status() -> dict[str, Any]:
    """Whether factors can be interpreted live; without an API key only precomputed
    interpretations of the bundled datasets are served."""
    available = client.api_key() is not None
    return {
        "available": available,
        "model": client.MODEL if available else None,
        "precomputed_only": not available and store.has_precomputed(),
    }


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
    meta, data = await _ready_matrix(dataset_id, session_id)
    kind = meta["kind"]
    params = body.params(kind)
    if body.cached_only and body.n_factors is not None:
        # A lookup needs only the data and the parameters; the analysis runs for a live call.
        result = None
        n_factors = body.n_factors
    else:
        try:
            result = await _analyze(data, params)
        except _AnalysisFailed as e:
            return e.response
        n_factors = result["n_factors"]

    effective = effective_params(params, n_factors)
    digest = await run_in_threadpool(data_hash, data)
    precomputed = store.read_precomputed(meta.get("bundled_id"), body.language, digest, effective, client.PROMPT_DIGEST)
    if precomputed:
        return _response(precomputed, cached=True, precomputed=True)

    key = store.cache_key(
        kind=kind, data_hash=digest, params=effective, language=body.language,
        model=client.MODEL, effort=client.EFFORT, prompt=client.PROMPT_DIGEST,
    )
    cached = store.read_cached(session_id, meta, key)
    if cached:
        return _response(cached, cached=True, precomputed=False)
    if body.cached_only:
        return Response(status_code=204)

    api_key = client.api_key()
    if api_key is None:
        return _error(client.unavailable())

    payload = build_payload(kind, result, params, meta.get("dropped"))
    try:
        # Before any quota is used: the size of the request bounds what one call costs.
        client.check_size(payload, body.language)
    except InterpretationError as e:
        return _error(e)

    try:
        async with _key_lock(key):
            cached = store.read_cached(session_id, meta, key)
            if cached:
                return _response(cached, cached=True, precomputed=False)
            # The analysis and the wait for the lock count against the time of the request.
            time_left = client.TIMEOUT_S - (time.monotonic() - started)
            if time_left < client.MIN_CALL_S:
                raise client.timed_out()
            await run_in_threadpool(quota.claim, session_id)
            answer = await client.interpret(payload, body.language, api_key, timeout=time_left)
            entry = {
                "kind": kind,
                "data_hash": digest,
                "params": effective,
                "language": body.language,
                "model": answer.model,
                "prompt_version": PROMPT_VERSION,
                "prompt_digest": client.PROMPT_DIGEST,
                "effort": client.EFFORT,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "interpretation": answer.interpretation.model_dump(),
            }
            await run_in_threadpool(store.write_cached, session_id, meta, key, entry)
    except InterpretationError as e:
        return _error(e)
    return _response(entry, cached=False, precomputed=False)
