# Changelog

## 0.4.0 — Services, carpentry and presentation
- **Electrical & lighting layout** (`lib/electrical.ts`, *Electrical & lighting* panel, `electric` plan tool): 17 point types, wall snapping with facing, per-room auto-suggestion, schedule + CSV, printable plan (SVG/PNG), estimate lines, 3D fixtures. Stored in `Scene.electrical`.
- **Modular kitchen & wardrobe planner** (`lib/modular.ts`, `ModularSection`): units per run (two legs for L kitchens), finishes, carcass, handles, countertop, loft, wall cabinets, two-tone; parametric 3D with *Show inside*; live cost; cut list CSV with sheet and edge-band totals. Stored in `SceneObject.modular`.
- **Room style presets & palettes** (`lib/roomStyle.ts`, *Room style & palettes* panel): 9 whole-room styles and 4 palette schemes from one colour, LRV readout, feature-wall selection.
- **Day / Evening / Night** lighting modes (`Lighting.mode`) driven by planned fixtures; day-vs-night image export.
- **360° panorama** export (`lib/panorama.ts`) with GPano XMP and an in-app viewer.
- 67 unit tests.


## 0.3.1 — New project dialog fixes
- Floors box no longer jumps between 1 and 5 while typing; any number from 1 to 30 can be entered.
- Ceiling height follows the chosen units (feet-inches for Imperial, e.g. `10' 6"`) and allows up to 9 m / ~29 ft for double-height spaces.
- Pressing Enter in number fields commits the value instead of submitting the form with the old one.

## 0.3.0 — Interiors from room photos
- **Photo Studio** (`#/photos/<project>`; *Photos* button in the editor, *Start from room photos* on the dashboard): upload raw-site room photos; magic select (colour + edge aware, small blotches filled) or drawn areas; paint/panelling/wallpaper/cladding/brick/tile finishes that keep the photo's light and shadows; perspective corners for tiles; *Hide raw plaster marks*; product cut-outs; before/after slider; JPG download; link a photo to a 3D room and push its colours into 3D.
- **Photo → measured 3D room**: 4 floor corners + tape measurements + doors/windows clicked on the floor → walls, room and openings (openings marked *detected* for review).
- **False ceilings** per room (border, cove/tray LED, layered, circular, wooden slats) rendered in 3D with spotlights and cove glow, headroom warning, ₹/sq ft estimate lines, and chat support.
- 16 new catalog items (carpentry, partitions, furnishings) and 8 new wall finishes + 5 trend paints.
- Tests: perspective maths, opening placement, repaint shading, magic select, ceiling inset/estimate, ceiling chat command (60 unit tests total).

## 0.2.0 — Audit fixes
See [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md).
