import cv2
from fastapi.testclient import TestClient

from app.main import app
from tests.test_detection import synth_plan

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}
SCENE = {"schemaVersion": 1, "floors": [{"id": "f0"}], "walls": [], "openings": [], "rooms": [], "objects": []}


def test_health_is_public():
    assert client.get("/api/health").json()["status"] == "ok"


def test_auth_required():
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_project_roundtrip_and_versions():
    r = client.post("/api/projects", json={"name": "Flat", "scene": SCENE}, headers=AUTH)
    assert r.status_code == 201
    pid = r.json()["id"]
    scene2 = {**SCENE, "walls": [{"id": "w1", "a": {"x": 0, "y": 0}, "b": {"x": 4, "y": 0}}]}
    v = client.post(f"/api/projects/{pid}/versions", json={"label": "empty"}, headers=AUTH).json()
    assert client.patch(f"/api/projects/{pid}", json={"scene": scene2}, headers=AUTH).json()["scene"]["walls"][0]["id"] == "w1"
    restored = client.post(f"/api/projects/{pid}/versions/{v['id']}/restore", headers=AUTH).json()
    assert restored["scene"]["walls"] == []
    assert len(client.get(f"/api/projects/{pid}/versions", headers=AUTH).json()) == 2
    assert client.delete(f"/api/projects/{pid}", headers=AUTH).status_code == 204
    assert client.get(f"/api/projects/{pid}", headers=AUTH).status_code == 404


def test_invalid_scene_rejected():
    assert client.post("/api/projects", json={"name": "x", "scene": {"foo": 1}}, headers=AUTH).status_code == 422


def test_detect_endpoint_and_job():
    ok, png = cv2.imencode(".png", synth_plan())
    files = {"file": ("plan.png", png.tobytes(), "image/png")}
    r = client.post("/api/blueprints/detect?px_per_meter=50&threshold=128", files=files, headers=AUTH)
    assert r.status_code == 200 and len(r.json()["walls"]) == 5
    j = client.post("/api/jobs/detect?px_per_meter=50&threshold=128", files=files, headers=AUTH)
    assert j.status_code == 202
    job = client.get(f"/api/jobs/{j.json()['id']}", headers=AUTH).json()
    assert job["status"] == "succeeded" and len(job["result"]["rooms"]) == 2


def test_upload_content_is_sniffed():
    files = {"file": ("plan.png", b"MZ\x90\x00 definitely not an image", "image/png")}
    assert client.post("/api/blueprints/detect", files=files, headers=AUTH).status_code == 415


def test_ai_without_provider_returns_501():
    assert client.post("/api/ai/design-proposal", json={"room": {}, "request": {}}, headers=AUTH).status_code == 501
