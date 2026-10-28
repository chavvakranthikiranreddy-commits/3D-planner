"""Database entities (spec §6). Searchable metadata lives in columns; the scene graph is a
versioned JSON document; large binaries go to object storage (here: UPLOAD_DIR)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _id() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    identity_ref: Mapped[str] = mapped_column(String(255), unique=True)
    account_status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    owner_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(200))
    project_type: Mapped[str] = mapped_column(String(40), default="apartment")
    units: Mapped[str] = mapped_column(String(4), default="m")
    status: Mapped[str] = mapped_column(String(20), default="active")
    scene_schema_version: Mapped[int] = mapped_column(Integer, default=1)
    scene: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    versions: Mapped[list["DesignVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="DesignVersion.version_number")


class DesignVersion(Base):
    __tablename__ = "design_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200), default="")
    scene_snapshot: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    project: Mapped[Project] = relationship(back_populates="versions")


class Upload(Base):
    __tablename__ = "uploads"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(32))
    storage_key: Mapped[str] = mapped_column(String(300))
    media_type: Mapped[str] = mapped_column(String(40))
    file_size: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64))
    processing_status: Mapped[str] = mapped_column(String(20), default="stored")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(32))
    job_type: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|succeeded|failed|cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SharePermission(Base):
    __tablename__ = "share_permissions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    recipient_ref: Mapped[str] = mapped_column(String(255))
    permission_level: Mapped[str] = mapped_column(String(20), default="view")  # view|comment|edit
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
