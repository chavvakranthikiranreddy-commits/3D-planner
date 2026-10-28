"""Project CRUD + version history. Every query is scoped to the authenticated owner."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DesignVersion, Project
from ..schemas import ProjectFull, ProjectIn, ProjectOut, ProjectPatch, VersionIn, VersionOut
from ..security import current_user

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _scene_ok(scene: dict) -> int:
    if not isinstance(scene.get("walls"), list) or not isinstance(scene.get("floors"), list):
        raise HTTPException(422, "scene must contain 'floors' and 'walls' arrays")
    return int(scene.get("schemaVersion", 1))


def _owned(db: Session, pid: str, user: str) -> Project:
    p = db.get(Project, pid)
    if not p or p.owner_id != user:  # 404 rather than 403 so ids can't be probed
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return p


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: str = Depends(current_user)):
    return db.scalars(select(Project).where(Project.owner_id == user).order_by(Project.updated_at.desc())).all()


@router.post("", response_model=ProjectFull, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: str = Depends(current_user)):
    p = Project(owner_id=user, name=body.name, project_type=body.project_type, units=body.units, scene=body.scene, scene_schema_version=_scene_ok(body.scene))
    db.add(p)
    db.commit()
    return p


@router.get("/{pid}", response_model=ProjectFull)
def get_project(pid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    return _owned(db, pid, user)


@router.patch("/{pid}", response_model=ProjectFull)
def update_project(pid: str, body: ProjectPatch, db: Session = Depends(get_db), user: str = Depends(current_user)):
    p = _owned(db, pid, user)
    if body.name is not None:
        p.name = body.name
    if body.status is not None:
        p.status = body.status
    if body.scene is not None:
        p.scene_schema_version = _scene_ok(body.scene)
        p.scene = body.scene
    db.commit()
    return p


@router.delete("/{pid}", status_code=204)
def delete_project(pid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    db.delete(_owned(db, pid, user))
    db.commit()
    return Response(status_code=204)


@router.get("/{pid}/versions", response_model=list[VersionOut])
def list_versions(pid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    return _owned(db, pid, user).versions


@router.post("/{pid}/versions", response_model=VersionOut, status_code=201)
def create_version(pid: str, body: VersionIn, db: Session = Depends(get_db), user: str = Depends(current_user)):
    p = _owned(db, pid, user)
    n = (p.versions[-1].version_number if p.versions else 0) + 1
    v = DesignVersion(project_id=p.id, version_number=n, label=body.label or f"Version {n}", scene_snapshot=p.scene, created_by=user)
    db.add(v)
    db.commit()
    return v


@router.post("/{pid}/versions/{vid}/restore", response_model=ProjectFull)
def restore_version(pid: str, vid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    p = _owned(db, pid, user)
    v = next((x for x in p.versions if x.id == vid), None)
    if not v:
        raise HTTPException(404, "Version not found")
    n = p.versions[-1].version_number + 1
    db.add(DesignVersion(project_id=p.id, version_number=n, label="Auto-save before restore", scene_snapshot=p.scene, created_by=user))
    p.scene = v.scene_snapshot
    db.commit()
    return p
