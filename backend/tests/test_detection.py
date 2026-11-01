import numpy as np
import cv2

from app.services.detection import detect

PPM = 50


def synth_plan() -> np.ndarray:
    """10 m × 8 m plan: outer walls, a partition with a door gap and a window with glazing lines."""
    img = np.full((500, 600), 255, np.uint8)
    o, t = 50, int(0.2 * PPM)
    R = lambda x0, y0, x1, y1, v=0: cv2.rectangle(img, (int(x0), int(y0)), (int(x1) - 1, int(y1) - 1), v, -1)
    R(o, o, o + 10 * PPM, o + t); R(o, o + 8 * PPM - t, o + 10 * PPM, o + 8 * PPM)
    R(o, o, o + t, o + 8 * PPM); R(o + 10 * PPM - t, o, o + 10 * PPM, o + 8 * PPM)
    R(o + 6 * PPM - 4, o, o + 6 * PPM + 4, o + 3 * PPM); R(o + 6 * PPM - 4, o + 3.9 * PPM, o + 6 * PPM + 4, o + 8 * PPM)
    R(o + 2 * PPM, o, o + 3.5 * PPM, o + t, 255)
    R(o + 2 * PPM, o + 2, o + 3.5 * PPM, o + 4); R(o + 2 * PPM, o + t - 4, o + 3.5 * PPM, o + t - 2)
    return img


def test_walls_openings_rooms():
    r = detect(synth_plan(), PPM, 128)
    assert len(r["walls"]) == 5
    assert sorted(o["type"] for o in r["openings"]) == ["door", "window"]
    door = next(o for o in r["openings"] if o["type"] == "door")
    assert 0.8 < door["width"] / PPM < 1.0
    assert len(r["rooms"]) == 2
    assert all(0 < w["confidence"] <= 1 for w in r["walls"])


def test_blank_image_has_no_walls():
    r = detect(np.full((300, 300), 255, np.uint8), None, None)
    assert r["walls"] == [] and r["rooms"] == []


def test_default_threshold_on_pure_black_and_white():
    """Audit A04: Otsu returns 0 on binary input; detection must still find the walls."""
    img = np.full((400, 500), 255, np.uint8)
    cv2.rectangle(img, (50, 50), (449, 349), 0, 10)
    r = detect(img, 50, None)
    assert len(r["walls"]) == 4 and len(r["rooms"]) == 1


def test_default_threshold_variants():
    base = np.full((400, 500), 255, np.uint8)
    cv2.rectangle(base, (50, 50), (449, 349), 0, 10)
    blurred = cv2.GaussianBlur(base, (5, 5), 0)                 # anti-aliased
    faint = np.where(base == 0, 150, 255).astype(np.uint8)      # faint grey ink
    inverted = 255 - base                                       # white lines on black
    rng = np.random.default_rng(1)
    noisy = np.clip(base.astype(int) + rng.normal(0, 12, base.shape), 0, 255).astype(np.uint8)  # scan noise
    for name, img in [("blurred", blurred), ("faint", faint), ("inverted", inverted), ("noisy", noisy)]:
        r = detect(img, 50, None)
        assert len(r["walls"]) == 4, name
        assert len(r["rooms"]) == 1, name


def test_l_shaped_room_keeps_its_outline():
    """Audit A05: an L-shaped room must not become its bounding rectangle."""
    img = np.full((500, 500), 255, np.uint8)
    pts = np.array([[50, 50], [450, 50], [450, 250], [250, 250], [250, 450], [50, 450]], np.int32)
    cv2.polylines(img, [pts], True, 0, 10)
    r = detect(img, 50, None)
    assert len(r["rooms"]) == 1
    room = r["rooms"][0]
    poly = np.array([[p["x"], p["y"]] for p in room["polygon"]], np.float32)
    area = cv2.contourArea(poly)
    assert room["irregular"] is True
    assert len(room["polygon"]) >= 6
    assert abs(area - room["areaPx"]) / room["areaPx"] < 0.06
