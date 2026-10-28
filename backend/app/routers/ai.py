from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, status

from ..security import current_user
from ..services.ai_providers import get_provider

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/design-proposal")
async def design_proposal(brief: dict[str, Any] = Body(...), user: str = Depends(current_user)):
    """Return high-level style suggestions for one room. 501 when no provider is configured,
    so the client falls back to its built-in rules."""
    provider = get_provider()
    if provider is None:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "No AI provider configured (set AI_PROVIDER, AI_API_KEY, AI_MODEL)")
    try:
        out = await provider.suggest(brief)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI provider error {e.response.status_code}") from e
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI provider unavailable: {e}") from e
    return {"provider": provider.name, **out}
