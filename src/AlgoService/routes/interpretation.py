"""Interpretation of factor analysis results by Claude: status and the interpret endpoint."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from config import get_session_id, limiter
from env_config import rate_limit
from interpretation import client, quota, store
from interpretation.client import InterpretationError
from interpretation.payload import build_payload, data_hash, effective_params
from interpretation.prompt import PROMPT_VERSION
from interpretation.schema import tidy
from routes.factor_analysis import AnalyzeRequest, _AnalysisFailed, _analyze, _ready_matrix

router = APIRouter(prefix="/factor-analysis", tags=["factor analysis"])

# One live call per cache key at a time; a second click waits for the first answer.
_LOCKS: dict[str, asyncio.Lock] = {}


class InterpretRequest(AnalyzeRequest):
    language: Literal["en", "de"] = "en"
    #: Only look up a cached or precomputed interpretation; never calls the API.
    cached_only: bool = False


def _error(e: InterpretationError) -> JSONResponse:
    return JSONResponse(status_code=e.status, content={"detail": e.detail, "code": e.code})


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
    body = body or InterpretRequest()
    meta, data = await _ready_matrix(dataset_id, session_id)
    kind = meta["kind"]
    params = body.params(kind)
    try:
        result = await _analyze(data, params)
    except _AnalysisFailed as e:
        return e.response

    effective = effective_params(params, result["n_factors"])
    digest = await run_in_threadpool(data_hash, data)
    precomputed = store.read_precomputed(meta.get("bundled_id"), body.language, digest, effective)
    if precomputed:
        return _response(precomputed, cached=True, precomputed=True)

    key = store.cache_key(
        kind=kind, data_hash=digest, params=effective, language=body.language,
        model=client.MODEL, prompt_version=PROMPT_VERSION,
    )
    cached = store.read_cached(session_id, meta, key)
    if cached:
        return _response(cached, cached=True, precomputed=False)
    if body.cached_only:
        return Response(status_code=204)

    api_key = client.api_key()
    if api_key is None:
        return _error(client.unavailable())

    lock = _LOCKS.setdefault(key, asyncio.Lock())
    try:
        async with lock:
            cached = store.read_cached(session_id, meta, key)
            if cached:
                return _response(cached, cached=True, precomputed=False)
            await run_in_threadpool(quota.claim, session_id)
            payload = build_payload(kind, result, params, meta.get("dropped"))
            answer = await client.interpret(payload, body.language, api_key)
            entry = {
                "kind": kind,
                "data_hash": digest,
                "params": effective,
                "language": body.language,
                "model": answer.model,
                "prompt_version": PROMPT_VERSION,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "interpretation": tidy(
                    answer.interpretation, result["used_measures"], result["n_factors"]
                ).model_dump(),
            }
            await run_in_threadpool(store.write_cached, session_id, meta, key, entry)
    except InterpretationError as e:
        return _error(e)
    finally:
        if not lock.locked():
            _LOCKS.pop(key, None)
    return _response(entry, cached=False, precomputed=False)
