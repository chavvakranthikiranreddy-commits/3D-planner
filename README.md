# Archiform — Blueprint-to-3D Architecture & Interior Design Studio

Archiform is a browser app that turns a house or building floor plan into an **editable, measurable 3D model**. You can then design the interiors: paint walls with HEX colour codes, apply materials and textures, place furniture, upload product photos, try AI design proposals, walk through the rooms, compare versions and export renders and PDF reports.

The 3D model is built from structured geometry: walls, openings, rooms and floors, all with real dimensions. An AI-generated picture is never treated as the 3D conversion.

> **Status:** v0.2.0 controlled prototype. Stage 1 and Stage 2 of the November 2026 audit are implemented; see [docs/AUDIT_RESPONSE.md](docs/AUDIT_RESPONSE.md) for each finding, its fix and its regression test, plus what still needs real-device and real-user testing. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps the original specification.

---

## Features

| Area | What you get |
|---|---|
| **Electrical & lighting layout** *(new in 0.4)* | 17 symbols (switchboards, 6A/16A sockets, TV, LAN, AC, geyser, exhaust, fan, ceiling light, downlights, pendants, wall lights, LED strips, DB, bell, CCTV) placed on the 2D plan; wall points snap to the room side of the wall at standard heights. **Suggest points** drafts a full layout per room from its type, doors and walls. Schedule per room, **printable electrical plan (PNG/SVG)** with legend and switching lines, Excel-ready CSV, indicative cost per point in the estimate, and fixtures shown in 3D. |
| **Modular kitchen & wardrobe planner** *(new in 0.4)* | For straight, parallel and L-shaped kitchens and hinged/sliding wardrobes: split the run into drawers, shutters, sink, hob + chimney, tall pantry, oven, corner and open units; choose laminate / acrylic / PU / veneer / glass shutters, BWP / MR / HDHMR / particle carcass, gola / profile / knob / bar / push handles, two-tone colours, countertop, loft. The 3D model follows the plan (with a *Show inside* view), the cost updates live (₹ per sq ft of front area + drawers, pantry, corner, counter per running ft) and the **cut list** (mm sizes, 8×4 sheet counts, edge banding) downloads as CSV for the carpenter. |
| **Room style presets & matching palettes** *(new in 0.4)* | One click applies a whole look to a room — Modern Indian, Japandi, Scandinavian, Luxury, Minimal white, Industrial, Boho, Classic, Contemporary grey: wall colour, feature wall (fluted, slats, wallpaper, cladding, brick…), floor, false ceiling, furniture colours, and optionally the missing furniture. Or pick one colour (or a paint shade's HEX) to get four matching palettes (tonal, neighbouring, bold contrast, neutral + accent) with LRV guidance, applied to walls, one feature wall, ceiling and soft furnishings. |
| **360° panoramas and Day / Evening / Night views** *(new in 0.4)* | Switch the 3D view between daylight, evening and night: at night only artificial light remains — room brightness comes from the light points you planned, with glowing downlights, pendants, cove LEDs and strips. Download a **day vs night** side-by-side image. **360°** captures a 4096×2048 panorama from the middle of a room or from where you stand in the walkthrough, with an in-app viewer; the JPG carries GPano tags so Google Photos, Facebook and VR viewers open it as 360°. |
| **Photo Studio — design on your own room photos** *(new in 0.3)* | Building finished and ready for interiors? Upload photos of the raw rooms (bare plaster, cement floors are fine). **Magic select** a wall by clicking it, or **draw** an area, then try any paint colour (HEX or palette), panelling, wallpaper, stone cladding, brick or a floor tile. The real light and shadows of the photo are kept, and a *Hide raw plaster marks* slider gives a finished-paint look. Tiles follow the room's perspective (drag 4 corners). Drop in product photos (sofa, bed) with automatic background removal. **Before/after** slider and image download. |
| **Photo → measured 3D room** *(new in 0.3)* | In the same photo, click the 4 floor corners, type your tape measurements (side A, side B, height), and mark visible doors and windows by clicking the floor under their edges. Archiform builds the walls (4.5″/6″/9″ thickness), the room and its openings, and carries the photo's colours into 3D. |
| **Interior elements kit** *(new in 0.3)* | **False ceilings** per room: border band, cove/tray with hidden LED, layered, circular, wooden slats — with drop, border width, cove-light warmth and spotlights, a headroom warning and an indicative ₹/sq ft cost in the estimate. New **carpentry**: TV wall unit, sliding wardrobe, L-shaped and parallel modular kitchens, floating shelves, book wall, crockery unit, study unit, dressing unit, shoe cabinet. New **partitions & furnishing**: jaali screen, fluted-glass partition, feature panel, curtains, roller blind, chandelier. New wall finishes: fluted panels (white/walnut), wood slats, damask and botanical wallpaper, stone cladding, exposed brick, texture plaster, and 2025–26 colours (warm white, plaster pink, muted navy, olive, clay). The chat understands *"add a cove false ceiling with warm lights in the hall"*. |
| **Design chat** | Type plain commands and they are applied straight to the plan and 3D view. For example: *"use #C46A4A for the hall"*, *"marble floor in the kitchen"*, *"add an L-shaped sofa to the hall in #8A9099 with gold accent"*. You can attach, paste or drop an image and say *"place this image in the first bedroom"* or *"put this image on the hall wall as art"*. Rooms can be named the way you'd say them ("hall", "first bedroom", "room 3"), and *"room 2 is a bedroom"* sets a room's type. Every change is a single undo step. Runs offline. |
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
| **Catalog (FR-14)** | 53 parametric furniture, carpentry and fixture models, searchable and filterable by category, style, width and price. Licence and source are recorded for each item. |
| **Reports (FR-15)** | PDF report with a render, rooms and areas, finishes, a product list and indicative paint and flooring quantities and costs, plus disclaimers. Also JSON export. |
| **Multi-floor (FR-16)** | Add floors with elevation and ceiling height. Exterior walls are copied up, the floor below shows as a ghost, and overlapping floors are flagged. |
| **Privacy & saving** | Projects are **saved on this device** (IndexedDB) with revision-safe autosave. Use *Back up project file* to move or recover projects. The optional backend adds detection and AI only; it does not sync projects yet. |

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
npm test             # 52 unit tests incl. regression tests for every reproduced audit finding
npm run build        # production build in frontend/dist
```

To try it out: on the dashboard choose **Start from a blueprint**, then click *Download a sample plan to try* on the upload screen. Calibrate with the *12.00 m* dimension line at the bottom of the plan. You can also open **Sample 2BHK** to explore a furnished apartment.

### Optional backend (OpenCV detection, server AI, project API)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                       # local SQLite settings; .env is loaded automatically
alembic upgrade head
uvicorn app.main:app --reload              # API docs: http://localhost:8000/docs
pytest -q
```

Then, in the app, go to **Settings → Optional processing server**, enter `http://localhost:8000` and the token part of `API_TOKENS` (e.g. `change-me-to-a-long-random-string`), and click *Test connection*. It reports whether the server is reachable, whether your token was accepted, and whether an AI provider is configured. The import wizard now offers the **Server · OpenCV** engine, and the AI panel offers **Server AI**.

To enable an AI provider, set these in `backend/.env`:

```
AI_PROVIDER=anthropic        # or openai (any OpenAI-compatible gateway via AI_BASE_URL)
AI_API_KEY=...
AI_MODEL=claude-sonnet-5-5   # or your provider's model id
```

### Full stack with Docker

```bash
cp backend/.env.docker.example backend/.env.docker   # edit API_TOKENS (one user:token pair per person)
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
│   ├── src/pages/            dashboard, import wizard, editor, Photo Studio, settings
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

## Known limitations

See [docs/AUDIT_RESPONSE.md §5](docs/AUDIT_RESPONSE.md) for the full open list. In short:


- Automatic detection is built for **clean, orthogonal, single-floor plans** in which walls are drawn as thick dark strokes. Diagonal or curved walls, hatched walls, hand-drawn sketches and scanned photos may need manual tracing. You can always skip detection and trace over the blueprint underlay.
- Room names are not read from the plan yet (no OCR). You name rooms in the import wizard's last step, or later in the chat ("room 2 is a bedroom").
- The backend uses per-user API tokens. A public consumer service still needs a proper identity provider, rate limiting and malware scanning.
- PDF reports can only show Latin characters; the app warns you before exporting if names use other scripts.
- DWG/DXF import, AR preview, collaboration and share links, and supplier price catalogs are not built yet (P2/P3 in the specification).
- **Electrical layouts** are planning aids for discussing points with your electrician — circuits, wire sizes, earthing and MCB/RCCB ratings must be designed by a licensed electrician. Modular and electrical rates are 2026 placeholders for comparing options, not quotes.
- **Photo Studio** recolours areas by colour similarity and edges. Where two walls are almost the same shade, the magic select can run onto the next wall: use *Limit with outline* (a few clicks) or draw the area. On-screen colours are a guide — confirm with a physical shade card in daylight. Product photos placed on a room photo are flat pictures, not measured 3D items.
- **Photo → 3D room** assumes a rectangular room and a reasonably flat floor; accuracy depends on how well the four corners are marked. Openings are marked *detected* for you to confirm in the editor. AI-generated photorealistic redesigns are not included.
- "Product approximations" are textured blocks sized to the dimensions you enter. A single photo cannot produce exact 3D geometry.
- Renders capture the real-time WebGL view. Photoreal Blender rendering on the backend is the next step.
- **All quantities and prices are indicative.** Dimensions should be checked by a qualified professional before construction or purchasing.

## Licence

MIT. See [LICENSE](LICENSE). All built-in 3D models and textures are generated procedurally by this code, so there are no third-party asset licences.
