"""The feedback form: anonymous messages to the owner."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel

import feedback_mail
import feedback_store
import provenance
from config import CodedHTTPException, limiter
from env_config import rate_limit

router = APIRouter(tags=["feedback"])

KINDS = ("bug", "idea", "other")
MAX_MESSAGE = 4000
MAX_CONTACT = 200
#: What the form may send along when the visitor leaves "technical details" on. Anything else
#: in ``context`` is dropped, so the form cannot be used to store other data.
CONTEXT_KEYS = ("route", "step", "language", "user_agent", "error_code")
MAX_CONTEXT_VALUE = 300


class FeedbackIn(BaseModel):
    kind: str = ""
    message: str = ""
    contact: str | None = None
    context: dict[str, Any] | None = None
    #: Hidden in the form. People never fill it; bots that fill every field do.
    website: str | None = None


def _text(value: str) -> str:
    # Postgres cannot store a NUL character in text.
    return value.replace("\x00", "").strip()


def _context(sent: dict[str, Any] | None) -> dict[str, str] | None:
    """The allowed keys of what the form sent, plus the tool's version and commit. None where the
    visitor sent no technical details."""
    if sent is None:
        return None
    context = {
        key: _text(value)[:MAX_CONTEXT_VALUE]
        for key in CONTEXT_KEYS
        if isinstance(value := sent.get(key), str) and _text(value)
    }
    tool = provenance.tool()
    return {"version": tool["version"], "commit": tool["commit"], **context}


@router.post("/feedback")
@limiter.limit(rate_limit("feedback", "5/hour"))
async def send_feedback(request: Request, body: FeedbackIn, background: BackgroundTasks) -> dict[str, bool]:
    """Keep a message from the form and mail it to the owner if mail is set up.

    The message is stored before anything else and the mail never fails the request: whoever
    wrote it sees it arrive. The IP address and the session are not stored.
    """
    # A filled honeypot gets the same answer as a message, and nothing is kept.
    if body.website and body.website.strip():
        return {"ok": True}

    kind = body.kind.strip()
    if kind not in KINDS:
        raise CodedHTTPException(422, f"kind must be one of {', '.join(KINDS)}.", "feedback_kind")
    message = _text(body.message)
    if not message:
        raise CodedHTTPException(422, "The message is empty.", "feedback_empty")
    if len(message) > MAX_MESSAGE:
        raise CodedHTTPException(
            422, f"The message is longer than {MAX_MESSAGE} characters.", "feedback_too_long", max=MAX_MESSAGE
        )
    contact = _text(body.contact or "") or None
    if contact and len(contact) > MAX_CONTACT:
        raise CodedHTTPException(
            422, f"The contact is longer than {MAX_CONTACT} characters.", "feedback_contact_too_long", max=MAX_CONTACT
        )

    feedback_id = await feedback_store.add(kind, message, contact, _context(body.context))
    if feedback_mail.settings() is not None:
        background.add_task(feedback_store.deliver, feedback_id)
    return {"ok": True}
