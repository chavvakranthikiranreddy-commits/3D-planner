"""Environment-based configuration. Secrets come from the environment, never from source control.

A local ``.env`` file next to this package is loaded automatically (without overriding variables
already set), so `uvicorn`, `alembic` and `pytest` all see the same settings.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


if not os.getenv("ARCHIFORM_SKIP_DOTENV"):
    _load_env_file(Path(__file__).resolve().parent.parent / ".env")


def _list(v: str) -> list[str]:
    return [s.strip() for s in v.split(",") if s.strip()]


def _tokens() -> dict[str, str]:
    """API_TOKENS="alice:tok1,bob:tok2" maps each token to its own user id.
    The legacy single API_TOKEN maps to user "local"."""
    out: dict[str, str] = {}
    for pair in _list(os.getenv("API_TOKENS", "")):
        if ":" in pair:
            user, tok = pair.split(":", 1)
            if user.strip() and len(tok.strip()) >= 16:
                out[tok.strip()] = user.strip()
    legacy = os.getenv("API_TOKEN", "")
    if legacy:
        out[legacy] = "local"
    return out


DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080,http://127.0.0.1:8080"


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")  # "production" refuses to start without auth
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./archiform.db")
    tokens: dict[str, str] = field(default_factory=_tokens)
    cors_origins: list[str] = field(default_factory=lambda: _list(os.getenv("CORS_ORIGINS", DEFAULT_ORIGINS)))
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))
    max_json_mb: int = int(os.getenv("MAX_JSON_MB", "20"))
    max_image_pixels: int = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
    max_concurrent_detections: int = int(os.getenv("MAX_CONCURRENT_DETECTIONS", "2"))
    upload_dir: str = os.getenv("UPLOAD_DIR", "./uploads")
    upload_retention_hours: float = float(os.getenv("UPLOAD_RETENTION_HOURS", "24"))
    # AI provider adapter: "none" | "openai" | "anthropic"
    ai_provider: str = os.getenv("AI_PROVIDER", "none")
    ai_api_key: str = os.getenv("AI_API_KEY", "")
    ai_model: str = os.getenv("AI_MODEL", "")
    ai_base_url: str = os.getenv("AI_BASE_URL", "")
    ai_timeout_s: float = float(os.getenv("AI_TIMEOUT_S", "45"))

    @property
    def auth_enabled(self) -> bool:
        return bool(self.tokens)


settings = Settings()
VERSION = "0.2.0"

if settings.app_env == "production" and not settings.auth_enabled:
    raise RuntimeError("APP_ENV=production requires API_TOKENS (or API_TOKEN). Refusing to start without authentication.")
