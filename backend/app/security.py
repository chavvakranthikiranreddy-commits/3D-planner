"""Authentication + upload validation."""
from __future__ import annotations

import hashlib
import hmac

from fastapi import Depends, Header, HTTPException, UploadFile, status

from .config import settings

LOCAL_USER = "local"


def current_user(authorization: str | None = Header(default=None)) -> str:
    """Bearer-token auth with one user id per token (API_TOKENS). With no tokens configured the API runs in
    explicit single-user local mode (refused when APP_ENV=production). For a public consumer service replace
    this with a managed identity provider (OIDC/JWT); the rest of the API only relies on the returned user id."""
    if not settings.auth_enabled:
        return LOCAL_USER
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    token = authorization.split(" ", 1)[1].strip()
    for known, user in settings.tokens.items():
        if hmac.compare_digest(token, known):
            return user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token", headers={"WWW-Authenticate": "Bearer"})


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


def image_size(data: bytes) -> tuple[int, int] | None:
    """Read width/height from PNG, JPEG or WebP headers without decoding pixels."""
    try:
        if data.startswith(b"\x89PNG") and data[12:16] == b"IHDR":
            return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        if data[:3] == b"\xff\xd8\xff":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg = int.from_bytes(data[i + 2:i + 4], "big")
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
                i += 2 + seg
            return None
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8X":
                return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
            if chunk == b"VP8 ":
                return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
            if chunk == b"VP8L":
                b = data[21:25]
                return 1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
    except IndexError:
        return None
    return None


async def read_validated(file: UploadFile, allowed: set[str]) -> tuple[bytes, str, str]:
    """Read an upload with a hard size cap and content-based type detection."""
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    mime = sniff(data)
    if mime not in allowed:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Unsupported file content. Allowed: {', '.join(sorted(allowed))}")
    if mime.startswith("image/"):
        size = image_size(data)
        if size is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the image dimensions")
        if size[0] * size[1] > settings.max_image_pixels:
            raise HTTPException(413, f"Image is {size[0]}x{size[1]} px; the limit is {settings.max_image_pixels:,} pixels")
    return data, mime, hashlib.sha256(data).hexdigest()
