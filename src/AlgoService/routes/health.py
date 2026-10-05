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
        # Don't return the exception text: asyncpg messages contain host, database and user.
        logger.exception("Database connection failed during health check")
        raise HTTPException(status_code=500, detail="Database unavailable")
