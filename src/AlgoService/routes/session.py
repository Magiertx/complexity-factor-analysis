"""Starting the session before the first real request."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from config import ensure_session_cookie

router = APIRouter(tags=["session"])


@router.get("/session", status_code=204)
async def start_session(request: Request) -> Response:
    """Give the caller a session cookie if it has none, or only an unusable one.

    A page fires its first requests at once; without a cookie each of them would start a
    session of its own, and the browser would keep the last cookie and lose what the others
    created. The frontend therefore asks for the cookie when it serves a page, before the page
    sends anything. No database access: the session is known to the database with its first
    real request.
    """
    ensure_session_cookie(request)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
