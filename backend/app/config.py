"""Environment-based configuration. Secrets come from the environment, never from source control."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _list(v: str) -> list[str]:
    return [s.strip() for s in v.split(",") if s.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./archiform.db")
    api_token: str = os.getenv("API_TOKEN", "")  # empty = auth disabled (local development only)
    cors_origins: list[str] = field(default_factory=lambda: _list(os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173")))
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))
    max_image_pixels: int = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
    upload_dir: str = os.getenv("UPLOAD_DIR", "./uploads")
    # AI provider adapter: "none" | "openai" | "anthropic"
    ai_provider: str = os.getenv("AI_PROVIDER", "none")
    ai_api_key: str = os.getenv("AI_API_KEY", "")
    ai_model: str = os.getenv("AI_MODEL", "")
    ai_base_url: str = os.getenv("AI_BASE_URL", "")
    ai_timeout_s: float = float(os.getenv("AI_TIMEOUT_S", "45"))


settings = Settings()
VERSION = "0.1.0"
