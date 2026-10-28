"""OpenCV blueprint interpretation.

Finds thick orthogonal wall strokes with morphology, merges collinear pieces, turns short
gaps into door/window candidates, snaps corners and labels enclosed rooms. Results are
pixel-space *candidates* with confidence scores; the user confirms scale and every item.
Output matches the frontend's ``DetectResult`` shape.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import cv2
import numpy as np

MAX_SIDE = 2400


@dataclass
class Wall:
    id: int
    x0: float
    y0: float
    x1: float
    y1: float
    thickness: float
    confidence: float
    orient: str  # "h" | "v"


@dataclass
class OpeningCandidate:
    wallId: int
    type: str  # "door" | "window"
    center: float  # absolute px along the wall axis until finalised
    width: float
    confidence: float


def decode_gray(data: bytes) -> tuple[np.ndarray, float]:
    """Decode an image and downscale it. Returns (gray, scale) where original = scaled * scale."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("The image could not be decoded.")
    if img.ndim == 3 and img.shape[2] == 4:  # transparent → white paper
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * alpha + 255 * (1 - alpha)).astype(np.uint8)
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape
    k = min(1.0, MAX_SIDE / max(h, w))
    if k < 1:
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    return img, 1 / k


def _components(mask: np.ndarray):
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return [stats[i] for i in range(1, n)]


def detect(gray: np.ndarray, px_per_meter: float | None = None, threshold: int | None = None) -> dict:
    H, W = gray.shape
    max_dim = max(W, H)
    min_len = max(12, round(max_dim * 0.025))
    min_t = max(3, round(max_dim * 0.003))
    max_t = max(min_t + 4, round(max_dim * 0.04))

    if threshold is None:
        thr, ink = cv2.threshold(gray, 0, 1, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        thr = min(float(thr), 170.0)
        ink = (gray < thr).astype(np.uint8)
    else:
        thr = float(threshold)
        ink = (gray < thr).astype(np.uint8)

    walls: list[Wall] = []
    wid = 0
    for orient in ("h", "v"):
        # thin-line suppression across the wall, then keep only long runs along it
        across = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_t) if orient == "h" else (min_t, 1))
        along = cv2.getStructuringElement(cv2.MORPH_RECT, (min_len, 1) if orient == "h" else (1, min_len))
        m = cv2.morphologyEx(ink, cv2.MORPH_OPEN, across)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, along)
        for x, y, w, h, area in _components(m):
            length, t = (w, h) if orient == "h" else (h, w)
            if t < min_t or t > max_t or length < min_len:
                continue
            fill = area / float(w * h)
            conf = round(min(1.0, 0.35 + 0.35 * fill + 0.3 * min(1.0, length / (t * 8))), 2)
            if orient == "h":
                cy = y + (h - 1) / 2
                walls.append(Wall(wid, float(x), cy, float(x + w - 1), cy, float(t), conf, "h"))
            else:
                cx = x + (w - 1) / 2
                walls.append(Wall(wid, cx, float(y), cx, float(y + h - 1), float(t), conf, "v"))
            wid += 1

    openings: list[OpeningCandidate] = []
    gap_max = 2.6 * px_per_meter if px_per_meter else max_dim * 0.12
    alive = {w.id: True for w in walls}
    for orient in ("h", "v"):
        lst = sorted([w for w in walls if w.orient == orient], key=lambda w: (w.y0, w.x0) if orient == "h" else (w.x0, w.y0))
        changed = True
        while changed:
            changed = False
            for i, A in enumerate(lst):
                if not alive[A.id]:
                    continue
                for B in lst[i + 1:]:
                    if not alive[B.id] or A is B:
                        continue
                    offA, offB = (A.y0, B.y0) if orient == "h" else (A.x0, B.x0)
                    if abs(offA - offB) > max(A.thickness, B.thickness) / 2 + 1:
                        continue
                    a0, a1 = (A.x0, A.x1) if orient == "h" else (A.y0, A.y1)
                    b0, b1 = (B.x0, B.x1) if orient == "h" else (B.y0, B.y1)
                    f0, f1, s0, s1 = (a0, a1, b0, b1) if a0 <= b0 else (b0, b1, a0, a1)
                    gap = s0 - f1
                    if gap > gap_max:
                        continue
                    lo, hi = min(f0, s0), max(f1, s1)
                    if orient == "h":
                        A.x0, A.x1 = lo, hi
                    else:
                        A.y0, A.y1 = lo, hi
                    A.thickness = round((A.thickness + B.thickness) / 2)
                    A.confidence = min(A.confidence, B.confidence)
                    if gap > max(3, min_t):
                        line = int(round(A.y0 if orient == "h" else A.x0))
                        half = int(A.thickness // 2)
                        s_from, s_to = int(f1 + 1), int(s0)
                        if orient == "h":
                            patch = ink[max(0, line - half):line + half + 1, s_from:s_to]
                        else:
                            patch = ink[s_from:s_to, max(0, line - half):line + half + 1]
                        ink_frac = float(patch.mean()) if patch.size else 0.0
                        kind = "window" if ink_frac > 0.08 else "door"
                        width_m = gap / px_per_meter if px_per_meter else None
                        plausible = width_m is None or (0.6 <= width_m <= 1.6 if kind == "door" else 0.4 <= width_m <= 2.6)
                        if plausible:
                            openings.append(OpeningCandidate(A.id, kind, f1 + gap / 2, gap, 0.55 if kind == "door" else 0.5))
                    for o in openings:
                        if o.wallId == B.id:
                            o.wallId = A.id
                    alive[B.id] = False
                    changed = True
    kept = [w for w in walls if alive[w.id]]

    # corner joining
    for w in kept:
        for end in (0, 1):
            ex, ey = (w.x0, w.y0) if end == 0 else (w.x1, w.y1)
            best = None
            for o in kept:
                if o is w or o.orient == w.orient:
                    continue
                tol = max(o.thickness, w.thickness) * 1.2 + 4
                if w.orient == "h":
                    d = abs(o.x0 - ex)
                    if d < tol and o.y0 - tol <= ey <= o.y1 + tol and (best is None or d < best[0]):
                        best = (d, o.x0)
                else:
                    d = abs(o.y0 - ey)
                    if d < tol and o.x0 - tol <= ex <= o.x1 + tol and (best is None or d < best[0]):
                        best = (d, o.y0)
            if best:
                if w.orient == "h":
                    if end == 0: w.x0 = best[1]
                    else: w.x1 = best[1]
                else:
                    if end == 0: w.y0 = best[1]
                    else: w.y1 = best[1]

    out_openings = []
    for o in openings:
        w = next((k for k in kept if k.id == o.wallId), None)
        if w:
            start = w.x0 if w.orient == "h" else w.y0
            out_openings.append({**asdict(o), "center": o.center - start})

    rooms = _rooms(kept, W, H, px_per_meter)
    return {
        "walls": [asdict(w) for w in kept],
        "openings": out_openings,
        "rooms": rooms,
        "stats": {"inkRatio": float(ink.mean()), "threshold": thr},
    }


def _rooms(walls: list[Wall], W: int, H: int, ppm: float | None) -> list[dict]:
    mask = np.zeros((H + 2, W + 2), np.uint8)
    for w in walls:
        t = max(1, int(np.ceil(w.thickness / 2)) + 1)
        x0, x1 = int(min(w.x0, w.x1)), int(np.ceil(max(w.x0, w.x1)))
        y0, y1 = int(min(w.y0, w.y1)), int(np.ceil(max(w.y0, w.y1)))
        if w.orient == "h":
            cv2.rectangle(mask, (x0 + 1, y0 + 1 - t), (x1 + 1, y1 + 1 + t), 255, -1)
        else:
            cv2.rectangle(mask, (x0 + 1 - t, y0 + 1), (x1 + 1 + t, y1 + 1), 255, -1)
    free = (mask == 0).astype(np.uint8)
    ff = np.zeros((H + 4, W + 4), np.uint8)
    cv2.floodFill(free, ff, (0, 0), 0)  # remove exterior
    n, _, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    min_area = 1.5 * ppm * ppm if ppm else (W * H) / 400
    rooms = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_area:
            continue
        rect = area / float(w * h)
        rooms.append({"x0": float(x - 1), "y0": float(y - 1), "x1": float(x + w - 1), "y1": float(y + h - 1),
                      "areaPx": float(area), "confidence": round(0.4 + 0.5 * rect, 2)})
    return rooms


def scale_result(res: dict, k: float) -> dict:
    """Scale pixel results from the working image back to the uploaded image's pixels."""
    if k == 1:
        return res
    for w in res["walls"]:
        for key in ("x0", "y0", "x1", "y1", "thickness"):
            w[key] *= k
    for o in res["openings"]:
        o["center"] *= k
        o["width"] *= k
    for r in res["rooms"]:
        for key in ("x0", "y0", "x1", "y1"):
            r[key] *= k
        r["areaPx"] *= k * k
    return res
