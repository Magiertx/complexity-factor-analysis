"""Storing the feedback and sending it on.

The row comes first and is the record; the mail is a courtesy that may fail without costing
the message. Nothing here knows who sent it: no session, no address.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

import feedback_mail
import models
from database import AsyncSessionLocal
from sqlalchemy import select

logger = logging.getLogger("algoservice")


async def add(kind: str, message: str, contact: str | None, context: dict[str, Any] | None) -> int:
    async with AsyncSessionLocal() as session:
        row = models.Feedback(kind=kind, message=message, contact=contact, context=context)
        session.add(row)
        await session.commit()
        return row.id


async def deliver(feedback_id: int) -> bool:
    """Mail one stored message to the owner and mark it delivered. A failure is logged and
    leaves the row as it is, for ``scripts.feedback resend``."""
    try:
        mail = feedback_mail.settings()
        if mail is None:
            return False
        async with AsyncSessionLocal() as session:
            row = await session.get(models.Feedback, feedback_id)
            if row is None:
                return False
            msg = feedback_mail.compose(
                mail,
                feedback_id=row.id,
                kind=row.kind,
                message=row.message,
                contact=row.contact,
                context=row.context,
                created_at=row.created_at,
            )
            await asyncio.to_thread(feedback_mail.send, mail, msg)
            row.delivered = True
            await session.commit()
        return True
    except Exception as e:
        logger.warning("Feedback %s was stored but its mail was not sent (%s: %s)", feedback_id, type(e).__name__, e)
        return False


async def listing(*, since: datetime | None = None, undelivered: bool = False) -> list[models.Feedback]:
    """The messages, oldest first."""
    query = select(models.Feedback).order_by(models.Feedback.id)
    if since is not None:
        query = query.where(models.Feedback.created_at >= since)
    if undelivered:
        query = query.where(models.Feedback.delivered.is_(False))
    async with AsyncSessionLocal() as session:
        return list((await session.scalars(query)).all())
