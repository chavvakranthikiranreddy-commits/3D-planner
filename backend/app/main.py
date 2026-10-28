"""Archiform API — FastAPI modular monolith. OpenAPI docs at /docs."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import VERSION, settings
from .db import Base, engine
from .routers import ai, blueprints, projects

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Archiform API", version=VERSION, description="Blueprint processing, projects, versions and AI orchestration for Archiform.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

# Dev convenience: create tables if missing. In production run `alembic upgrade head`.
Base.metadata.create_all(engine)

app.include_router(projects.router)
app.include_router(blueprints.router)
app.include_router(ai.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "version": VERSION, "ai_provider": settings.ai_provider if settings.ai_api_key else None, "auth": bool(settings.api_token)}
