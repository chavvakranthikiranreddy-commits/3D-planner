"""Archiform API — FastAPI modular monolith. OpenAPI docs at /docs."""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import VERSION, settings
from .db import Base, engine
from .routers import ai, blueprints, projects
from .security import current_user

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Archiform API", version=VERSION, description="Blueprint processing, projects, versions and AI orchestration for Archiform.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)


@app.middleware("http")
async def limit_json_body(request: Request, call_next):
    """Reject oversized JSON bodies before parsing (uploads have their own limit)."""
    if request.headers.get("content-type", "").startswith("application/json"):
        size = request.headers.get("content-length")
        if size and int(size) > settings.max_json_mb * 1024 * 1024:
            return JSONResponse({"detail": f"Request body exceeds {settings.max_json_mb} MB"}, status_code=413)
    return await call_next(request)


# Dev convenience: create tables if missing. In production run `alembic upgrade head`.
if settings.app_env != "production":
    Base.metadata.create_all(engine)
blueprints.sweep_uploads()

app.include_router(projects.router)
app.include_router(blueprints.router)
app.include_router(ai.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "version": VERSION, "ai_provider": settings.ai_provider if settings.ai_api_key else None, "auth": settings.auth_enabled}


@app.get("/api/auth/check", tags=["meta"])
def auth_check(user: str = Depends(current_user)):
    """Protected probe used by the app's "Test connection" button to verify the token, not just reachability."""
    return {"user": user, "auth": settings.auth_enabled}
