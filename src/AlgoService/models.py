"""SQLAlchemy models for persistence."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from database import Base
from sqlalchemy import Boolean, String, DateTime, Float, ForeignKey, JSON, Integer, false
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


def _utcnow_naive() -> datetime:
    """Return current UTC time as a naive datetime.

    Used as a default for the naive ``DateTime`` columns in this module.
    Equivalent in value to the deprecated ``datetime.utcnow()`` but built on
    a timezone-aware ``datetime.now(timezone.utc)`` to avoid the
    ``DeprecationWarning`` raised on Python 3.12+. The ``tzinfo`` is stripped
    because the columns are not declared with ``timezone=True``.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    """Account table. Nothing in the service creates or reads users; runs belong to sessions."""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    settings_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=dict)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    runs = relationship("Run", back_populates="owner_user", cascade="all, delete-orphan")
    presets = relationship("Preset", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    """An anonymous browser session that owns runs; ``last_seen`` is refreshed on use."""
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = relationship("User", back_populates="sessions")
    runs = relationship("Run", back_populates="owner_session")


class Run(Base):
    """One analysis job: its parameters, status, progress, timing and artifacts. ``status`` is one of pending, running, completed, failed, aborted."""
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    owner_session_id: Mapped[str | None] = mapped_column(
        String(255), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    algorithm_id: Mapped[str] = mapped_column(String(100), nullable=False)
    algorithm_name: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, running, completed, failed, aborted
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    progress_msg: Mapped[str | None] = mapped_column(String(255), default="")
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Free-text user note, editable from the past-job view and shown in the run history.
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    owner_user = relationship("User", back_populates="runs")
    owner_session = relationship("Session", back_populates="runs")
    artifacts = relationship("Artifact", back_populates="run", cascade="all, delete-orphan", lazy="selectin", order_by="Artifact.order_index")


class Artifact(Base):
    """One output of a run (``kind`` as in ``algorithms.base.ArtifactKind``): inline in ``payload_json`` or as a file at ``file_path``; ``order_index`` keeps the adapter's order."""
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(50), nullable=False)  # stat, table, image, log, text
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    run = relationship("Run", back_populates="artifacts")


class Preset(Base):
    """A saved parameter set per user and algorithm. Not used by the service yet."""
    __tablename__ = "presets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    algorithm_id: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)

    user = relationship("User", back_populates="presets")


class Feedback(Base):
    """A message from the feedback form. Anonymous: no session, no user, no address.

    ``context`` holds what the sender agreed to send along (version, commit, page, step,
    language, browser, last error code); ``delivered`` says whether the mail to the owner went out.
    """

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # bug, idea, other
    message: Mapped[str] = mapped_column(String(4000), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200), nullable=True)
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
