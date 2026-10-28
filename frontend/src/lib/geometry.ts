import type { Opening, Pt, Units, Wall } from './types';

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
export function setWallMaterial(w: Wall, side: 'A' | 'B' | 'both', id: string) {
  if (side === 'both') { w.materialId = id; w.materialIdB = id; }
  else if (side === 'A') { if (w.materialIdB === undefined) w.materialIdB = w.materialId; w.materialId = id; }
  else w.materialIdB = id;
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
/** Convert user-entered value in display units to metres. */
export const toMeters = (v: number, units: Units) => (units === 'ft' ? v / FT_PER_M : v);
export const fromMeters = (m: number, units: Units) => (units === 'ft' ? m * FT_PER_M : m);
