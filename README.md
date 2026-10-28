# Archiform — Blueprint-to-3D Architecture & Interior Design Studio

Archiform is a browser app that turns a house or building floor plan into an **editable, measurable 3D model**. You can then design the interiors: paint walls with HEX colour codes, apply materials and textures, place furniture, upload product photos, try AI design proposals, walk through the rooms, compare versions and export renders and PDF reports.

The 3D model is built from structured geometry: walls, openings, rooms and floors, all with real dimensions. An AI-generated picture is never treated as the 3D conversion.

> **Status:** MVP (Phase 1 + Phase 2, plus parts of Phases 3–4 from the developer specification). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how each requirement is covered and what is still open.

---

## Features

| Area | What you get |
|---|---|
| **Projects (FR-01)** | Dashboard to create, rename, duplicate, archive, delete and search projects. Every edit autosaves, and named versions can be restored. Projects can be imported and exported as files. |
| **Blueprint import (FR-02 to FR-05)** | Upload a PDF, PNG or JPG. File type is checked from the file's content and there is a 25 MB limit. You can pick the PDF page and fix the orientation. **Scale calibration is required**: you click two points and enter the real length. Detection then finds walls, doors, windows and rooms, each with a confidence score. You review the results, exclude wrong ones and generate the 3D model. |
| **2D ↔ 3D sync (FR-06)** | The 2D plan and the 3D view edit the same scene model. Split view shows both at once. |
| **Plan editor (FR-07)** | Draw walls with snapping, right-angle assist and endpoint snapping. Outline rooms, place doors and windows, drag wall ends and room corners, and type exact lengths, heights and thicknesses. Includes undo/redo and keyboard shortcuts. |
| **Interior editor** | Add, move, rotate, resize, duplicate and delete furniture in 2D or with the 3D gizmo. Arrow keys nudge items. Supports multiple floors. |
| **Colour & materials (FR-08)** | Enter colours as HEX or `rgb()`, or use the colour picker. 18 material presets (paints, oak, walnut, herringbone, marble, terrazzo, tiles, concrete, linen, brass…). You can upload your own textures. **Each face of a wall is painted separately**, so a wall shared by two rooms can have a different colour in each. |
| **Product reference (FR-09)** | Upload a product photo. You can rotate it, remove a plain background and sample its colours as swatches. Archiform suggests the closest catalog match, or builds a dimensioned approximation that is always labelled **estimated**. |
| **AI design assistant (FR-10)** | Choose a room, style, prompt and budget to get a proposal. You review it change by change, and only accepted changes are applied. A snapshot is taken first so you can roll back. **The assistant never moves walls, openings or room outlines.** Works offline with built-in rules, or through the server with Claude or an OpenAI-compatible API (API keys stay on the server). |
| **Navigation (FR-11)** | Orbit, dollhouse, top and front camera views. First-person walkthrough with WASD controls; walls block you and doors let you through. |
| **Lighting & render (FR-12)** | Real-time sun direction, height, warmth and ambient light, time-of-day presets and ceiling lights. Renders run as jobs (up to 4K) with progress, cancel and retry. |
| **Versions (FR-13)** | Named snapshots with thumbnails, a side-by-side comparison slider with metrics, and restore. |
| **Catalog (FR-14)** | 37 parametric furniture and fixture models, searchable and filterable by category, style, width and price. Licence and source are recorded for each item. |
| **Reports (FR-15)** | PDF report with a render, rooms and areas, finishes, a product list and indicative paint and flooring quantities and costs, plus disclaimers. Also JSON export. |
| **Multi-floor (FR-16)** | Add floors with elevation and ceiling height. Exterior walls are copied up, the floor below shows as a ghost, and overlapping floors are flagged. |
| **Privacy** | Local-first: projects stay in your browser (IndexedDB) unless you connect the optional backend. |

---

## Quick start — publish on GitHub Pages (no server needed)

1. **Create a repository** on GitHub, for example `archiform`. It can be public or private; Pages on a private repo needs a paid plan.
2. **Upload the code.** Use either option:
   - **Web upload:** unzip this project, open the new repo → *Add file → Upload files*, and drag in **everything inside** the `archiform` folder, including the hidden `.github` folder. On macOS, press `Cmd+Shift+.` in Finder to show hidden folders. Commit to `main`.
   - **Git:**
     ```bash
     cd archiform
     git init && git add . && git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/<your-user>/archiform.git
     git push -u origin main
     ```
3. **Turn on Pages:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab. The *Deploy to GitHub Pages* workflow builds the app, which takes about 1–2 minutes. The site then goes live at
   `https://<your-user>.github.io/archiform/`

The *CI* workflow also runs the frontend and backend tests on every push and pull request.

---

## Run locally

Requirements: **Node.js 20+**. Python 3.11+ is needed only for the optional backend.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (detection, geometry, AI safety, save/reload round-trip)
npm run build        # production build in frontend/dist
```

To try it out: on the dashboard choose **Start from a blueprint**, then click *Download a sample plan to try* on the upload screen. Calibrate with the *12.00 m* dimension line at the bottom of the plan. You can also open **Sample 2BHK** to explore a furnished apartment.

### Optional backend (OpenCV detection, server AI, cloud projects)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                       # set API_TOKEN; DATABASE_URL defaults to SQLite if unset
alembic upgrade head
uvicorn app.main:app --reload              # API docs: http://localhost:8000/docs
pytest -q
```

Then, in the app, go to **Settings → Optional processing server**, enter `http://localhost:8000` and your `API_TOKEN`, and click *Test connection*. The import wizard now offers the **Server · OpenCV** engine, and the AI panel offers **Server AI**.

To enable an AI provider, set these in `backend/.env`:

```
AI_PROVIDER=anthropic        # or openai (any OpenAI-compatible gateway via AI_BASE_URL)
AI_API_KEY=...
AI_MODEL=claude-sonnet-5-5   # or your provider's model id
```

### Full stack with Docker

```bash
cp backend/.env.example backend/.env       # edit API_TOKEN
docker compose up --build
# UI  → http://localhost:8080
# API → http://localhost:8000/docs   (Postgres included)
```

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` `W` `R` `D` `N` `H` | Select · Wall · Room · Door · Window · Pan |
| `1` `2` `3` `4` | 2D · Split · 3D · Walkthrough |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Delete` | Delete selection |
| `Ctrl+D` | Duplicate item |
| `Q` / `E`, arrow keys | Rotate ±15°, nudge 5 cm (hold Shift for 50 cm) |
| `G` | Toggle snapping |
| `Enter` / double-click / `Esc` | Finish a wall chain or close a room |
| `?` | Show all shortcuts |

---

## Project structure

```
archiform/
├── frontend/                 React 19 + TypeScript + Vite + Three.js (React Three Fiber) + Tailwind
│   ├── src/lib/              scene schema, geometry, detection, AI adapter, estimates, PDF report, persistence
│   ├── src/three/            3D viewport, parametric furniture, procedural textures
│   ├── src/components/       2D plan editor, layer tree, side panels
│   ├── src/pages/            dashboard, import wizard, editor, settings
│   └── public/samples/       sample floor plan for testing the import
├── backend/                  FastAPI + SQLAlchemy + Alembic + OpenCV
│   ├── app/routers/          projects & versions, blueprint detection + jobs, AI proposals
│   ├── app/services/         OpenCV detection, AI provider adapter
│   ├── alembic/              database migrations
│   └── tests/                pytest suite
├── docs/                     architecture, decisions, scene schema, sample project fixture
├── docker-compose.yml
└── .github/workflows/        CI + GitHub Pages deploy
```

---

## Known limitations (MVP boundary)

- Automatic detection is built for **clean, orthogonal, single-floor plans** in which walls are drawn as thick dark strokes. Diagonal or curved walls, hatched walls, hand-drawn sketches and scanned photos may need manual tracing. You can always skip detection and trace over the blueprint underlay.
- Room names are not read from the plan yet (no OCR). Detected rooms are numbered for you to rename.
- DWG/DXF import, AR preview, collaboration and share links, and supplier price catalogs are not built yet (P2/P3 in the specification).
- "Product approximations" are textured blocks sized to the dimensions you enter. A single photo cannot produce exact 3D geometry.
- Renders capture the real-time WebGL view. Photoreal Blender rendering on the backend is the next step.
- **All quantities and prices are indicative.** Dimensions should be checked by a qualified professional before construction or purchasing.

## Licence

MIT. See [LICENSE](LICENSE). All built-in 3D models and textures are generated procedurally by this code, so there are no third-party asset licences.
