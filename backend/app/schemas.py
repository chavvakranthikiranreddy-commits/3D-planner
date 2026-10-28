from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    project_type: str = "apartment"
    units: str = Field(default="m", pattern="^(m|ft)$")
    scene: dict[str, Any]


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    scene: dict[str, Any] | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    project_type: str
    units: str
    status: str
    scene_schema_version: int
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ProjectFull(ProjectOut):
    scene: dict[str, Any]


class VersionIn(BaseModel):
    label: str = Field(default="", max_length=200)


class VersionOut(BaseModel):
    id: str
    version_number: int
    label: str
    created_at: datetime
    model_config = {"from_attributes": True}


class JobOut(BaseModel):
    id: str
    job_type: str
    status: str
    progress: float
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    model_config = {"from_attributes": True}
