# Archiform — Architecture, decisions and spec coverage

## 1. Architecture

```
┌──────────────────────── Browser (works fully offline) ────────────────────────┐
│  Dashboard · Import wizard · Editor (2D plan ⇄ 3D view ⇄ walkthrough)          │
│                                                                                │
│  Zustand store ── Scene document (versioned JSON, metres) ── undo/redo history │
│       │                  │                         │                           │
│  IndexedDB          Detection engine          AI adapter (provider-agnostic)   │
│  (projects,         (TS port: thin-line       ├─ local rules (offline)         │
│   versions,          suppression, banding,    └─ server provider ─────┐        │
│   blueprints)        gap→opening, rooms)                              │        │
│                                                                       │        │
│  Job runner: queued → running → succeeded / failed / cancelled (+retry)        │
└───────────────────────────────────────────────────────────────────────┼────────┘
                                                      HTTPS + Bearer    │ (optional)
┌──────────────────────────── FastAPI modular monolith ─────────────────▼────────┐
│  /api/projects (+versions, restore)   owner-scoped, 404 on foreign ids         │
│  /api/blueprints/detect               OpenCV morphology pipeline               │
│  /api/jobs/detect, /api/jobs/{id}     background job + progress/cancel         │
│  /api/ai/design-proposal              Anthropic / OpenAI-compatible adapter    │
│  SQLAlchemy + Alembic → PostgreSQL (SQLite for dev) · uploads → private dir/S3 │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Processing flow (spec §5):** upload → content validation → (in-browser or server) detection → user review and correction → structured scene model → interactive 3D editor → render/report job.

### Technology decisions

| Layer | Spec recommendation | Implemented | Why |
|---|---|---|---|
| Frontend | TypeScript + React + Next.js | TypeScript + React 19 + **Vite** | The output is a static bundle that deploys straight to GitHub Pages with no server. Routes are hash-based, so the app can move to Next.js later without changes to the data model. |
| 3D | Three.js + React Three Fiber + Drei | Same | Covers the WebGL scene, TransformControls, PointerLockControls and Sky. |
| UI | Tailwind + shadcn/ui | Tailwind v4 + a small set of local components | Keeps the bundle small. shadcn can be added later. |
| Backend | Python + FastAPI | Same | OpenAPI documentation is served at `/docs`. |
| Image processing | OpenCV (+ OCR) | OpenCV. OCR is not added yet | See the roadmap. |
| DB / migrations | PostgreSQL + SQLAlchemy + Alembic | Same (SQLite for dev) | |
| Background jobs | Redis + Celery | FastAPI BackgroundTasks with a `ProcessingJob` table | The job API (`/api/jobs/*`) stays the same if Celery replaces the runner. |
| Storage | S3-compatible, private | Private upload directory; files are stored under generated ids | Replace with S3 and signed URLs in production. |
| Auth | Managed provider | Bearer token (`API_TOKEN`). Every query is scoped by owner | `current_user()` is the only integration point for OIDC/JWT. |

## 2. Scene schema (v1)

The scene is the source of truth. Renders and reports are outputs generated from it. Lengths are stored in **metres**. Plan `x` maps to world `x`, and plan `y` maps to world `z`. The full TypeScript definition is in `frontend/src/lib/types.ts`, and an example is in [`sample-project.archiform.json`](sample-project.archiform.json).

| Entity | Key fields |
|---|---|
| `Floor` | `id, level, elevation, ceilingHeight` |
| `Wall` | `a, b, height, thickness, materialId (face A), materialIdB (face B), source, confidence?` |
| `Opening` | `wallId, type (door/window), offset (m from wall start to centre), width, height, sill, confidence?` |
| `Room` | `polygon[], roomType, floorMaterialId, ceilingMaterialId, source` |
| `SceneObject` | `assetId, x, y, elevation, rotation, dims{w,h,d}, colorHex, materialId?, estimated?, imageDataUrl?, price` |
| `Material` | `kind, colorHex, roughness, metalness, pattern \| textureDataUrl, textureScale, pricePerM2` |
| `Lighting` | `sunIntensity, sunAzimuth, sunElevation, ambient, warmth, roomLights` |

`confidence` set to `undefined` means a human has confirmed the item. Detected items keep their score until you press **Confirm**. To change the schema, bump `SCENE_SCHEMA_VERSION` and add a step to `lib/migrate.ts`.

## 3. Functional requirement coverage

| ID | Priority | Status | Notes |
|---|---|---|---|
| FR-01 Project management | P0 | ✅ | Create, rename, duplicate, archive, delete and search. Autosave, versions and restore. |
| FR-02 Blueprint upload | P0 | ✅ | PDF (page picker), PNG and JPG. File type is checked by magic bytes, with a 25 MB / 50-page limit and clear error messages. |
| FR-03 Interpretation | P0 | ✅ (MVP) | Walls, doors, windows and rooms, each with confidence. Labels and OCR of dimensions are on the roadmap. |
| FR-04 Scale calibration | P0 | ✅ | Two points plus a known length. A sanity check warns about implausible sheet sizes. There is no silent default. |
| FR-05 Editable 3D | P0 | ✅ | Walls are segmented around openings, with real floors and ceilings. |
| FR-06 2D/3D sync | P0 | ✅ | Both views use one store, and the split view shows them side by side. |
| FR-07 Interior editor | P0 | ✅ | Move, rotate, resize, duplicate, delete, snapping, grid and numeric entry. |
| FR-08 Colour/material | P0 | ✅ | HEX/RGB input, picker, presets, texture upload and per-face wall paint. |
| FR-09 Product reference | P1 | ✅ (approximation) | Background removal, palette sampling, catalog matching and labelled approximations. Image-to-mesh is on the roadmap. |
| FR-10 AI assistant | P1 | ✅ | Reviewable change list with accept/reject and a pre-apply snapshot. Geometry is locked. |
| FR-11 Camera/navigation | P0 | ✅ | Orbit plus presets. Walkthrough with wall collision; doors are passable. |
| FR-12 Lighting/rendering | P1 | ✅ (real-time) | Render jobs up to 4K. Blender worker is on the roadmap. |
| FR-13 Compare versions | P1 | ✅ | Slider comparison, metrics table and restore. |
| FR-14 Catalog | P1 | ✅ | Filter by category, style, width and price. Licence and source are recorded. |
| FR-15 Reports/export | P1 | ✅ | PDF report, PNG renders and JSON project file. |
| FR-16 Multi-floor | P1 | ✅ (basic) | Floors, elevations, ghost of the floor below and an overlap check. Stairs are not built yet. |
| FR-17 Collaboration | P2 | ⏳ | Not built. The data model (`SharePermission`) is ready. Projects are private by default. |
| FR-18 AR preview | P3 | ⏳ | Not built. |

## 4. MVP acceptance checklist (spec §13)

- [x] Create a project and upload a supported blueprint
- [x] Asks for scale; never assumes it
- [x] Correct detected rooms, walls, doors and windows (drag, edit, exclude, confirm)
- [x] Valid editable 3D structure is generated from the confirmed plan
- [x] Navigate and switch views (2D, split, 3D, dollhouse/top/front, walkthrough)
- [x] Add, move, rotate and resize furniture
- [x] Apply a HEX colour and a material to a selected surface
- [x] Save, reload and continue editing without losing data (covered by the round-trip unit test)
- [x] Product reference gives a catalog match or a labelled approximation
- [x] Jobs show progress, errors and retry
- [x] Private by default; backend authorization tested (`tests/test_api.py`)
- [x] Basic render and project report export

## 5. Security and privacy

- Uploads are validated by **content** (magic bytes), size-capped and stored under generated ids, never under the client's file name. Server image decoding checks the pixel count.
- Project endpoints are owner-scoped and return 404 for ids that belong to someone else, so ids cannot be probed. Token comparison is constant-time.
- API keys live only in server environment variables. The browser never receives them, and the server only returns validated high-level suggestions.
- Local-first by default: nothing leaves the browser unless the user configures a backend. *Settings → Delete all local data* wipes everything.
- AI-derived changes, product approximations, detected geometry and cost estimates are always labelled. The report includes a professional-review disclaimer.

**Production hardening still to do:** HTTPS termination, a managed auth provider, rate limiting, S3 with signed URLs, malware scanning of uploads, sandboxed PDF/CAD parsing workers, backups and monitoring/alerting.

## 6. Roadmap (next phases)

1. **Blueprint accuracy:** OCR of room labels and dimension strings (PaddleOCR), diagonal walls via Hough lines, and a labelled test set with an accuracy report (spec §11 "Quality").
2. **Rendering:** a Blender worker for path-traced stills, queued through Celery/Redis.
3. **Products:** image-to-3D service integration; GLB catalog import with licence metadata.
4. **Collaboration:** sync to the backend, share links with view/comment permissions and expiry.
5. **CAD:** DXF import once format, licensing and accuracy have been validated; stairs; multi-floor automation.
6. **AR:** WebXR placement of selected products on compatible devices.
