import type { Opening, Pt, Scene, SceneObject, Units, Wall } from './types';

export const FT_PER_M = 3.28084;

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const wallLength = (w: Pick<Wall, 'a' | 'b'>) => dist(w.a, w.b);
export const wallAngle = (w: Pick<Wall, 'a' | 'b'>) => Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function centroid(poly: Pt[]): Pt {
  if (poly.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  poly.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / poly.length, y: y / poly.length };
}

export function bbox(points: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 8 };
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point: q, distance: dist(p, q) };
}

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
export const snapPt = (p: Pt, step: number): Pt => ({ x: snap(p.x, step), y: snap(p.y, step) });

/** Snap p to an existing wall endpoint if within tolerance. */
export function snapToEndpoints(p: Pt, walls: Wall[], tol: number): Pt {
  let best: Pt | null = null, bestD = tol;
  for (const w of walls) for (const e of [w.a, w.b]) {
    const d = dist(p, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? { ...best } : p;
}

/** Constrain b so that segment a→b is horizontal or vertical when close to it (ortho assist). */
export function orthoAssist(a: Pt, b: Pt, degTol = 8): Pt {
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const m = ((ang % 90) + 90) % 90;
  if (m < degTol || m > 90 - degTol) {
    return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  }
  return b;
}

export interface WallPiece {
  /** start/end along wall (m), bottom/top height (m) */
  s0: number; s1: number; z0: number; z1: number;
}

/**
 * Split a wall into solid box pieces around its openings.
 * Openings are clamped to the wall and overlapping openings are merged visually.
 */
export function segmentWall(wall: Wall, openings: Opening[]): { pieces: WallPiece[]; holes: Opening[] } {
  const L = wallLength(wall);
  const H = wall.height;
  const holes = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const w = Math.min(o.width, L);
      const c = Math.max(w / 2, Math.min(L - w / 2, o.offset));
      const sill = o.type === 'door' ? 0 : Math.max(0, Math.min(o.sill, H - 0.05));
      const h = Math.min(o.height, H - sill);
      return { ...o, offset: c, width: w, sill, height: h };
    })
    .sort((a, b) => a.offset - b.offset);

  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of holes) {
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    if (s0 > cursor + 1e-4) pieces.push({ s0: cursor, s1: s0, z0: 0, z1: H });
    const a = Math.max(s0, cursor);
    if (s1 > a + 1e-4) {
      if (o.sill > 1e-4) pieces.push({ s0: a, s1, z0: 0, z1: o.sill });
      if (o.sill + o.height < H - 1e-4) pieces.push({ s0: a, s1, z0: o.sill + o.height, z1: H });
    }
    cursor = Math.max(cursor, s1);
  }
  if (cursor < L - 1e-4) pieces.push({ s0: cursor, s1: L, z0: 0, z1: H });
  return { pieces, holes };
}

/** Which face of a wall looks into the given polygon. */
export function wallSideFacing(w: Pick<Wall, 'a' | 'b' | 'thickness'>, poly: Pt[]): 'A' | 'B' {
  const ang = wallAngle(w);
  const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  const off = w.thickness / 2 + 0.15;
  const pA = { x: m.x - Math.sin(ang) * off, y: m.y + Math.cos(ang) * off };
  return pointInPolygon(pA, poly) ? 'A' : 'B';
}
export const wallMaterialFor = (w: Wall, side: 'A' | 'B') => (side === 'B' ? w.materialIdB ?? w.materialId : w.materialId);

/** Finish on one face at distance `at` along the wall, honouring per-room spans. */
export function wallMaterialAt(w: Wall, side: 'A' | 'B', at: number): string {
  const sp = (w.spans ?? []).filter((x) => x.side === side && at >= x.from - 1e-6 && at <= x.to + 1e-6);
  return sp.length ? sp[sp.length - 1].materialId : wallMaterialFor(w, side);
}

/** Paint a whole face (or both). Clears the per-room spans on the painted face(s). */
export function setWallMaterial(w: Wall, side: 'A' | 'B' | 'both', id: string) {
  if (side === 'both') { w.materialId = id; w.materialIdB = id; w.spans = []; return; }
  if (side === 'A') { if (w.materialIdB === undefined) w.materialIdB = w.materialId; w.materialId = id; }
  else w.materialIdB = id;
  w.spans = (w.spans ?? []).filter((x) => x.side !== side);
}

/**
 * Paint only [from, to] of one face — used when a room covers part of a long wall,
 * so neighbouring rooms on the same face keep their own finish.
 */
export function setWallSpanMaterial(w: Wall, side: 'A' | 'B', from: number, to: number, id: string) {
  const L = wallLength(w);
  const a = Math.max(0, Math.min(from, to)), b = Math.min(L, Math.max(from, to));
  if (b - a < 0.01) return;
  if (a < 0.02 && b > L - 0.02) { setWallMaterial(w, side, id); return; }
  const kept: NonNullable<Wall['spans']> = [];
  for (const sp of w.spans ?? []) {
    if (sp.side !== side || sp.to <= a + 1e-6 || sp.from >= b - 1e-6) { kept.push(sp); continue; }
    if (sp.from < a - 1e-6) kept.push({ ...sp, to: a });
    if (sp.to > b + 1e-6) kept.push({ ...sp, from: b });
  }
  kept.push({ side, from: +a.toFixed(4), to: +b.toFixed(4), materialId: id });
  w.spans = kept;
}

/** Distances along the wall where the finish changes on either face. */
export function spanBreaks(w: Wall): number[] {
  const out = new Set<number>();
  for (const sp of w.spans ?? []) { out.add(sp.from); out.add(sp.to); }
  return [...out].sort((x, y) => x - y);
}

// ---------- openings: one placement rule shared by 2D, 3D, collision and estimates ----------
/** Clamp an opening so it fits its wall: width ≤ length, half-width ≤ centre ≤ length − half-width. */
export function normalizeOpening<T extends Pick<Opening, 'offset' | 'width' | 'height' | 'sill' | 'type'>>(o: T, wall: Pick<Wall, 'a' | 'b' | 'height'>): T {
  const L = wallLength(wall);
  const width = Math.max(0.1, Math.min(o.width, L));
  const offset = Math.max(width / 2, Math.min(L - width / 2, o.offset));
  const sill = o.type === 'door' ? 0 : Math.max(0, Math.min(o.sill, wall.height - 0.1));
  const height = Math.max(0.1, Math.min(o.height, wall.height - sill));
  return { ...o, width: +width.toFixed(4), offset: +offset.toFixed(4), sill: +sill.toFixed(4), height: +height.toFixed(4) };
}

/** Normalise every opening in place (run after each edit so stored data never disagrees with the views). */
export function normalizeSceneOpenings(s: Scene) {
  const walls = new Map(s.walls.map((w) => [w.id, w]));
  s.openings = s.openings.filter((o) => walls.has(o.wallId));
  s.openings.forEach((o, i) => {
    const n = normalizeOpening(o, walls.get(o.wallId)!);
    if (n.offset !== o.offset || n.width !== o.width || n.sill !== o.sill || n.height !== o.height) s.openings[i] = n;
  });
}

// ---------- connected editing ----------
/**
 * Move a plan vertex and everything attached to it on the same floor:
 * coincident wall endpoints and room corners follow, so walls stay joined.
 */
export function moveVertex(s: Scene, floorId: string, from: Pt, to: Pt, tol = 0.02, skip?: { wallId: string; end: 'a' | 'b' }) {
  for (const w of s.walls) {
    if (w.floorId !== floorId) continue;
    for (const end of ['a', 'b'] as const) {
      if (skip && skip.wallId === w.id && skip.end === end) continue;
      if (dist(w[end], from) <= tol) w[end] = { ...to };
    }
  }
  for (const r of s.rooms) {
    if (r.floorId !== floorId) continue;
    r.polygon = r.polygon.map((p) => (dist(p, from) <= tol ? { ...to } : p));
  }
}

export interface Attachments { walls: { id: string; end: 'a' | 'b' }[]; rooms: { id: string; idx: number }[] }
/** Everything that shares a vertex at `p` on a floor (wall ends + room corners). Captured once when a drag starts. */
export function attachmentsAt(s: Scene, floorId: string, p: Pt, tol = 0.02): Attachments {
  const out: Attachments = { walls: [], rooms: [] };
  for (const w of s.walls) if (w.floorId === floorId) for (const end of ['a', 'b'] as const) if (dist(w[end], p) <= tol) out.walls.push({ id: w.id, end });
  for (const r of s.rooms) if (r.floorId === floorId) r.polygon.forEach((q, idx) => { if (dist(q, p) <= tol) out.rooms.push({ id: r.id, idx }); });
  return out;
}
export function applyAttachments(s: Scene, att: Attachments, to: Pt) {
  for (const { id, end } of att.walls) { const w = s.walls.find((x) => x.id === id); if (w) w[end] = { ...to }; }
  for (const { id, idx } of att.rooms) { const r = s.rooms.find((x) => x.id === id); if (r && r.polygon[idx]) r.polygon[idx] = { ...to }; }
}

// ---------- polygon offset (false-ceiling borders) ----------
const signedArea = (poly: Pt[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;

/**
 * Inset a simple polygon by distance d (miter joins). Works for convex and orthogonal concave rooms
 * when d is smaller than half the shortest edge. Returns null if the inset collapses.
 */
export function insetPolygon(poly: Pt[], d: number): Pt[] | null {
  const n = poly.length;
  if (n < 3) return null;
  const sgn = signedArea(poly) > 0 ? 1 : -1; // y-down plans: positive area = clockwise on screen
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1e-9;
    const nx = (-(q.y - p.y) / len) * sgn, ny = ((q.x - p.x) / len) * sgn; // inward normal
    return { p: { x: p.x + nx * d, y: p.y + ny * d }, dir: { x: (q.x - p.x) / len, y: (q.y - p.y) / len } };
  });
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n], b = lines[i];
    const den = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
    if (Math.abs(den) < 1e-9) { out.push(b.p); continue; }
    const t = ((b.p.x - a.p.x) * b.dir.y - (b.p.y - a.p.y) * b.dir.x) / den;
    out.push({ x: a.p.x + a.dir.x * t, y: a.p.y + a.dir.y * t });
  }
  const area = Math.abs(signedArea(out));
  if (area < 0.25 || Math.sign(signedArea(out)) !== Math.sign(signedArea(poly)) || area >= Math.abs(signedArea(poly))) return null;
  if (!out.every((p) => pointInPolygon(p, poly))) return null;
  return out;
}

// ---------- footprints ----------
export function objectCorners(o: Pick<SceneObject, 'x' | 'y' | 'rotation' | 'dims'>, pad = 0): Pt[] {
  const hw = o.dims.w / 2 + pad, hd = o.dims.d / 2 + pad;
  // plan front vector is (sin r, cos r); right vector is (cos r, -sin r)
  const c = Math.cos(o.rotation), sn = Math.sin(o.rotation);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => ({ x: o.x + x * c + z * sn, y: o.y - x * sn + z * c }));
}
function project(poly: Pt[], ax: Pt) {
  let mn = Infinity, mx = -Infinity;
  for (const p of poly) { const v = p.x * ax.x + p.y * ax.y; mn = Math.min(mn, v); mx = Math.max(mx, v); }
  return [mn, mx];
}
/** Separating-axis overlap test for two convex quads. */
export function quadsOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.y - p.y), y: q.x - p.x };
      const [a0, a1] = project(a, ax), [b0, b1] = project(b, ax);
      if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
    }
  }
  return true;
}
/** All footprint corners inside the polygon and no polygon edge crossing the footprint (handles concave rooms). */
export function footprintInside(corners: Pt[], poly: Pt[]): boolean {
  if (!corners.every((c) => pointInPolygon(c, poly))) return false;
  const cross = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return d(p1, p2, p3) * d(p1, p2, p4) < -1e-9 && d(p3, p4, p1) * d(p3, p4, p2) < -1e-9;
  };
  for (let i = 0; i < corners.length; i++) for (let j = 0; j < poly.length; j++) {
    if (cross(corners[i], corners[(i + 1) % corners.length], poly[j], poly[(j + 1) % poly.length])) return false;
  }
  return true;
}

/** Validation for FR "validate geometry". Returns human-readable issues. */
export function validateGeometry(walls: Wall[], openings: Opening[]): string[] {
  const issues: string[] = [];
  for (const w of walls) {
    const L = wallLength(w);
    if (L < 0.05) issues.push(`A wall is shorter than 5 cm (${w.id.slice(0, 5)}).`);
    if (w.height < 1.8 || w.height > 12) issues.push(`Wall height ${w.height.toFixed(2)} m looks out of range.`);
    if (w.thickness < 0.05 || w.thickness > 1) issues.push(`Wall thickness ${w.thickness.toFixed(2)} m looks out of range.`);
    const os = openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < os.length; i++) {
      const o = os[i];
      if (o.width > L + 1e-3) issues.push(`A ${o.type} is wider than its wall.`);
      else if (o.offset < o.width / 2 - 1e-3 || o.offset > L - o.width / 2 + 1e-3) issues.push(`A ${o.type} extends past the end of its wall.`);
      if (i > 0) {
        const p = os[i - 1];
        if (p.offset + p.width / 2 > o.offset - o.width / 2 + 1e-3) issues.push(`Two openings overlap on the same wall.`);
      }
    }
  }
  // disconnected walls: endpoints not touching any other wall
  const tol = 0.12;
  let loose = 0;
  for (const w of walls) for (const e of [w.a, w.b]) {
    const touching = walls.some((o) => o.id !== w.id && projectOnSegment(e, o.a, o.b).distance < Math.max(tol, o.thickness));
    if (!touching) loose++;
  }
  if (walls.length > 1 && loose > 0) issues.push(`${loose} wall end(s) are not connected to another wall.`);
  return issues;
}

// ---------- unit formatting ----------
export function fmtLen(m: number, units: Units, digits = 2): string {
  if (units === 'ft') {
    const totalIn = m * FT_PER_M * 12;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn - ft * 12);
    return inch === 12 ? `${ft + 1}′ 0″` : `${ft}′ ${inch}″`;
  }
  return `${m.toFixed(digits)} m`;
}
export function fmtArea(m2: number, units: Units): string {
  return units === 'ft' ? `${(m2 * FT_PER_M * FT_PER_M).toFixed(0)} sq ft` : `${m2.toFixed(2)} m²`;
}
/** Parse feet-and-inches input: 10'6", 10' 6, 10 ft 6 in, 10.5, 126" → feet. */
export function parseFeetInches(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/feet|foot|ft/g, "'").replace(/inches|inch|in\b/g, '"').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
  if (m) return +m[1] + (m[2] ? +m[2] / 12 : 0);
  m = t.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (m) return +m[1] / 12;
  m = t.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] + +m[2] / 12;
  m = t.match(/^-?\d+(?:\.\d+)?$/);
  return m ? +m[0] : null;
}

/** Convert user-entered value in display units to metres. */
export const toMeters = (v: number, units: Units) => (units === 'ft' ? v / FT_PER_M : v);
export const fromMeters = (m: number, units: Units) => (units === 'ft' ? m * FT_PER_M : m);
