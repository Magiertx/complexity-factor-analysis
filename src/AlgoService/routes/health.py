"""Health check endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from database import AsyncSessionLocal
from config import logger

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    """Test backend health and database connectivity."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception:
        # The exception text is deliberately not returned: /health is unauthenticated and
        # asyncpg messages carry host, port, database name and user. `logger.exception`
        # records the full detail where it belongs — in the server log.
        logger.exception("Database connection failed during health check")
        raise HTTPException(status_code=500, detail="Database unavailable")
