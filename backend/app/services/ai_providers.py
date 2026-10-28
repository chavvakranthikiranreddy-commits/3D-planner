"""Provider-agnostic AI adapter. The browser never sees API keys.

Every provider returns *high-level* design suggestions (style, palette, notes). The frontend turns
them into structured, reviewable scene edits, so an AI response can never alter geometry.
"""
from __future__ import annotations

import json
import re
from typing import Any, Protocol

import httpx

from ..config import settings

ALLOWED_STYLES = {"modern", "scandinavian", "industrial", "indian-contemporary", "minimal", "boho", "luxury", "classic"}
SYSTEM = (
    "You are an interior designer. Reply with ONLY a JSON object with keys: "
    '"style" (one of: ' + ", ".join(sorted(ALLOWED_STYLES)) + '), "wall_color" (a #RRGGBB hex), '
    '"accent_color" (#RRGGBB), "floor" (one of: oak, walnut, marble, terrazzo, tile, concrete), '
    '"summary" (max 12 words), "notes" (array of up to 4 short strings). Do not change room geometry.'
)


class Provider(Protocol):
    name: str

    async def suggest(self, brief: dict[str, Any]) -> dict[str, Any]: ...


def _brief_text(brief: dict[str, Any]) -> str:
    room = brief.get("room") or {}
    req = brief.get("request") or {}
    return json.dumps({
        "room_name": room.get("name"), "room_type": room.get("roomType"),
        "requested_style": req.get("style"), "prompt": (req.get("prompt") or "")[:800],
        "budget": req.get("budget"), "palette": req.get("palette"),
    })


def _parse(text: str) -> dict[str, Any]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("AI provider did not return JSON")
    data = json.loads(m.group(0))
    out: dict[str, Any] = {}
    if data.get("style") in ALLOWED_STYLES:
        out["style"] = data["style"]
    for k in ("wall_color", "accent_color"):
        v = str(data.get(k, ""))
        if re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            out[k] = v.lower()
    if data.get("floor") in {"oak", "walnut", "marble", "terrazzo", "tile", "concrete"}:
        out["floor"] = data["floor"]
    out["summary"] = str(data.get("summary", ""))[:120] or None
    out["notes"] = [str(n)[:200] for n in (data.get("notes") or [])][:4]
    return out


class OpenAIProvider:
    name = "OpenAI-compatible"

    async def suggest(self, brief: dict[str, Any]) -> dict[str, Any]:
        base = (settings.ai_base_url or "https://api.openai.com").rstrip("/")
        async with httpx.AsyncClient(timeout=settings.ai_timeout_s) as c:
            r = await c.post(f"{base}/v1/chat/completions", headers={"Authorization": f"Bearer {settings.ai_api_key}"}, json={
                "model": settings.ai_model, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": _brief_text(brief)}],
            })
            r.raise_for_status()
            return _parse(r.json()["choices"][0]["message"]["content"])


class AnthropicProvider:
    name = "Anthropic Claude"

    async def suggest(self, brief: dict[str, Any]) -> dict[str, Any]:
        base = (settings.ai_base_url or "https://api.anthropic.com").rstrip("/")
        async with httpx.AsyncClient(timeout=settings.ai_timeout_s) as c:
            r = await c.post(f"{base}/v1/messages", headers={"x-api-key": settings.ai_api_key, "anthropic-version": "2023-06-01"}, json={
                "model": settings.ai_model, "max_tokens": 600, "system": SYSTEM,
                "messages": [{"role": "user", "content": _brief_text(brief)}],
            })
            r.raise_for_status()
            text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
            return _parse(text)


def get_provider() -> Provider | None:
    if not settings.ai_api_key or not settings.ai_model:
        return None
    return {"openai": OpenAIProvider, "anthropic": AnthropicProvider}.get(settings.ai_provider, lambda: None)()
