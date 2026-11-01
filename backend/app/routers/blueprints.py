"""Blueprint detection: synchronous for small images, or as a background job with progress."""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal, get_db
from ..models import ProcessingJob, Upload
from ..schemas import JobOut
from ..security import current_user, read_validated
from ..services.detection import decode_gray, detect, scale_result

router = APIRouter(prefix="/api", tags=["blueprints"])
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
# bounded CPU work: detection never runs on the event loop and at most N run at once
_slots = asyncio.Semaphore(settings.max_concurrent_detections)


def sweep_uploads() -> int:
    """Delete stored uploads older than the retention period. Returns files removed."""
    if not os.path.isdir(settings.upload_dir):
        return 0
    cutoff = time.time() - settings.upload_retention_hours * 3600
    n = 0
    for name in os.listdir(settings.upload_dir):
        path = os.path.join(settings.upload_dir, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                n += 1
        except OSError:
            pass
    return n


def _run(data: bytes, ppm: float | None, threshold: int | None) -> dict:
    gray, k = decode_gray(data)
    if gray.shape[0] * gray.shape[1] * k * k > settings.max_image_pixels:
        raise HTTPException(413, "Image has too many pixels")
    # detection runs on the downscaled copy; px_per_meter refers to the uploaded image
    res = detect(gray, ppm / k if ppm else None, threshold)
    return scale_result(res, k)


@router.post("/blueprints/detect")
async def detect_sync(
    file: UploadFile = File(...),
    px_per_meter: float | None = Query(default=None, gt=0),
    threshold: int | None = Query(default=None, ge=1, le=254),
    user: str = Depends(current_user),
):
    data, _, _ = await read_validated(file, IMAGE_TYPES)
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=20)
    except asyncio.TimeoutError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Detection is busy, please retry shortly", headers={"Retry-After": "10"}) from e
    try:
        return await run_in_threadpool(_run, data, px_per_meter, threshold)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    finally:
        _slots.release()


def _job_worker(job_id: str, path: str, ppm: float | None, threshold: int | None) -> None:
    db = SessionLocal()
    job: ProcessingJob | None = None
    try:
        job = db.get(ProcessingJob, job_id)
        if not job or job.status == "cancelled":
            return
        job.status, job.progress = "running", 0.1
        db.commit()
        with open(path, "rb") as f:
            res = _run(f.read(), ppm, threshold)
        db.refresh(job)
        if job.status == "cancelled":
            return
        job.status, job.progress, job.result = "succeeded", 1.0, res
    except Exception as e:  # noqa: BLE001 — surface any processing error to the client
        job = db.get(ProcessingJob, job_id)
        if job:
            job.status, job.error_code, job.error_message = "failed", type(e).__name__, str(e)[:500]
    finally:
        if job:
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
        db.close()
        try:  # the result is stored; the raw upload is no longer needed
            os.remove(path)
        except OSError:
            pass


@router.post("/jobs/detect", response_model=JobOut, status_code=202)
async def detect_job(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    project_id: str | None = Query(default=None),
    px_per_meter: float | None = Query(default=None, gt=0),
    threshold: int | None = Query(default=None, ge=1, le=254),
    db: Session = Depends(get_db),
    user: str = Depends(current_user),
):
    data, mime, checksum = await read_validated(file, IMAGE_TYPES)
    os.makedirs(settings.upload_dir, exist_ok=True)
    up = Upload(project_id=project_id, owner_id=user, storage_key="", media_type=mime, file_size=len(data), checksum=checksum)
    db.add(up)
    db.flush()
    path = os.path.join(settings.upload_dir, f"{up.id}.bin")  # never use the client file name on disk
    with open(path, "wb") as f:
        f.write(data)
    up.storage_key = path
    job = ProcessingJob(project_id=project_id, owner_id=user, job_type="detect", params={"upload_id": up.id, "px_per_meter": px_per_meter, "threshold": threshold})
    db.add(job)
    db.commit()
    background.add_task(_job_worker, job.id, path, px_per_meter, threshold)
    return job


def _own_job(db: Session, jid: str, user: str) -> ProcessingJob:
    j = db.get(ProcessingJob, jid)
    if not j or j.owner_id != user:
        raise HTTPException(404, "Job not found")
    return j


@router.get("/jobs/{jid}", response_model=JobOut)
def get_job(jid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    return _own_job(db, jid, user)


@router.post("/jobs/{jid}/cancel", response_model=JobOut)
def cancel_job(jid: str, db: Session = Depends(get_db), user: str = Depends(current_user)):
    j = _own_job(db, jid, user)
    if j.status in ("queued", "running"):
        j.status = "cancelled"
        j.completed_at = datetime.now(timezone.utc)
        db.commit()
    return j
