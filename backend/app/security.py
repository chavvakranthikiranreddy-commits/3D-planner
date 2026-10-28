"""Authentication + upload validation."""
from __future__ import annotations

import hashlib
import hmac

from fastapi import Depends, Header, HTTPException, UploadFile, status

from .config import settings

LOCAL_USER = "local"


def current_user(authorization: str | None = Header(default=None)) -> str:
    """Bearer-token auth. Replace with your managed auth provider (OIDC/JWT) for multi-user deployments;
    the rest of the API only relies on the returned user id."""
    if not settings.api_token:
        return LOCAL_USER
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    token = authorization.split(" ", 1)[1].strip()
    if not hmac.compare_digest(token, settings.api_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return LOCAL_USER


User = Depends(current_user)

MAGIC = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"%PDF": "application/pdf",
}


def sniff(data: bytes) -> str | None:
    for sig, mime in MAGIC.items():
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_validated(file: UploadFile, allowed: set[str]) -> tuple[bytes, str, str]:
    """Read an upload with a hard size cap and content-based type detection."""
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    mime = sniff(data)
    if mime not in allowed:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Unsupported file content. Allowed: {', '.join(sorted(allowed))}")
    return data, mime, hashlib.sha256(data).hexdigest()
