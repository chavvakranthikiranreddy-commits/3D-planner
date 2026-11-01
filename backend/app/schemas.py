from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCENE_SCHEMA_VERSION = 1
MAX_ITEMS = 20000
Coord = Field(ge=-10000, le=10000, allow_inf_nan=False)


class _Open(BaseModel):
    """Scene parts accept extra fields (forward compatible) but validate everything the editor relies on."""
    model_config = ConfigDict(extra="allow")


class Pt(_Open):
    x: float = Coord
    y: float = Coord


class FloorM(_Open):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default="Floor", max_length=200)
    level: int = Field(ge=-10, le=200)
    elevation: float = Field(ge=-50, le=500, allow_inf_nan=False)
    ceilingHeight: float = Field(ge=1.8, le=30, allow_inf_nan=False)


class WallM(_Open):
    id: str = Field(min_length=1, max_length=64)
    floorId: str
    a: Pt
    b: Pt
    height: float = Field(ge=0.5, le=30, allow_inf_nan=False)
    thickness: float = Field(ge=0.01, le=2, allow_inf_nan=False)
    materialId: str = "paint-white"


class OpeningM(_Open):
    id: str = Field(min_length=1, max_length=64)
    wallId: str
    type: str = Field(pattern="^(door|window)$")
    offset: float = Field(ge=-100, le=10000, allow_inf_nan=False)
    width: float = Field(gt=0, le=50, allow_inf_nan=False)
    height: float = Field(gt=0, le=30, allow_inf_nan=False)
    sill: float = Field(default=0, ge=0, le=30, allow_inf_nan=False)


class RoomM(_Open):
    id: str = Field(min_length=1, max_length=64)
    floorId: str
    name: str = Field(default="Room", max_length=200)
    polygon: list[Pt] = Field(min_length=3, max_length=500)


class Dims(_Open):
    w: float = Field(gt=0, le=100, allow_inf_nan=False)
    h: float = Field(gt=0, le=100, allow_inf_nan=False)
    d: float = Field(gt=0, le=100, allow_inf_nan=False)


class ObjectM(_Open):
    id: str = Field(min_length=1, max_length=64)
    floorId: str
    x: float = Coord
    y: float = Coord
    rotation: float = Field(default=0, ge=-1000, le=1000, allow_inf_nan=False)
    dims: Dims


class SceneM(_Open):
    schemaVersion: int = Field(default=1, ge=1)
    floors: list[FloorM] = Field(min_length=1, max_length=200)
    walls: list[WallM] = Field(default_factory=list, max_length=MAX_ITEMS)
    openings: list[OpeningM] = Field(default_factory=list, max_length=MAX_ITEMS)
    rooms: list[RoomM] = Field(default_factory=list, max_length=MAX_ITEMS)
    objects: list[ObjectM] = Field(default_factory=list, max_length=MAX_ITEMS)
    materials: dict[str, Any] = Field(default_factory=dict)
    lighting: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _references(self):
        if self.schemaVersion > SCENE_SCHEMA_VERSION:
            raise ValueError(f"Unsupported scene schema {self.schemaVersion}; this server understands up to {SCENE_SCHEMA_VERSION}")
        floors = {f.id for f in self.floors}
        walls = {w.id for w in self.walls}
        for kind, items in (("wall", self.walls), ("room", self.rooms), ("object", self.objects)):
            for it in items:
                if it.floorId not in floors:
                    raise ValueError(f"{kind} {it.id} refers to unknown floor {it.floorId}")
        for o in self.openings:
            if o.wallId not in walls:
                raise ValueError(f"opening {o.id} refers to unknown wall {o.wallId}")
        return self


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    project_type: str = Field(default="apartment", max_length=40)
    units: str = Field(default="m", pattern="^(m|ft)$")
    scene: SceneM


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    scene: SceneM | None = None


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
