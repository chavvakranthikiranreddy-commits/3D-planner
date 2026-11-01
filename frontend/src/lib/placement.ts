/**
 * Room geometry helpers shared by the AI assistant, the design chat, materials and estimates:
 *  - which wall faces bound a room, and over which stretch of each wall (so a long wall shared by two
 *    rooms is painted/estimated per room, audit A13)
 *  - safe furniture placement: the whole rotated footprint inside the real (possibly concave) room,
 *    clear of other furniture and door swings (audit A11)
 */
import type { Room, Scene, SceneObject, Wall } from './types';
import { bbox, centroid, footprintInside, objectCorners, pointInPolygon, quadsOverlap, wallAngle, wallLength } from './geometry';

export interface RoomFace { wall: Wall; side: 'A' | 'B'; from: number; to: number; /** distance from wall centre-line to the room outline */ inset: number }

/** Wall faces that bound a room, with the stretch [from, to] (metres from wall start) the room covers. */
export function roomWallSides(scene: Scene, room: Room): RoomFace[] {
  const out: RoomFace[] = [];
  const poly = room.polygon;
  for (const w of scene.walls) {
    if (w.floorId !== room.floorId) continue;
    const L = wallLength(w);
    if (L < 0.05) continue;
    const ang = wallAngle(w);
    const u = { x: Math.cos(ang), y: Math.sin(ang) };
    const n = { x: -u.y, y: u.x };
    const tol = Math.max(0.25, w.thickness);
    const intervals: [number, number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const el = Math.hypot(q.x - p.x, q.y - p.y);
      if (el < 0.05) continue;
      // edge must be parallel to the wall and lie along its line
      const cross = Math.abs((q.x - p.x) * u.y - (q.y - p.y) * u.x) / el;
      if (cross > 0.06) continue;
      const dp = Math.abs((p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y);
      const dq = Math.abs((q.x - w.a.x) * n.x + (q.y - w.a.y) * n.y);
      if (dp > tol || dq > tol) continue;
      const tp = (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
      const tq = (q.x - w.a.x) * u.x + (q.y - w.a.y) * u.y;
      const a = Math.max(0, Math.min(tp, tq)), b = Math.min(L, Math.max(tp, tq));
      if (b - a > 0.05) intervals.push([a, b, Math.max(dp, dq)]);
    }
    if (!intervals.length) continue;
    intervals.sort((x, y) => x[0] - y[0]);
    const merged: [number, number, number][] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 0.05) { last[1] = Math.max(last[1], iv[1]); last[2] = Math.max(last[2], iv[2]); } else merged.push([...iv]);
    }
    // room outlines traced from a plan stop at inner wall faces: extend to the wall ends when close
    const snap = Math.max(0.3, w.thickness * 2);
    for (const [a0, b0, inset] of merged) {
      const a = a0 < snap ? 0 : a0, b = b0 > L - snap ? L : b0;
      const mid = (a + b) / 2;
      const off = w.thickness / 2 + 0.15;
      const pA = { x: w.a.x + u.x * mid + n.x * off, y: w.a.y + u.y * mid + n.y * off };
      out.push({ wall: w, side: pointInPolygon(pA, poly) ? 'A' : 'B', from: +a.toFixed(4), to: +b.toFixed(4), inset });
    }
  }
  return out;
}

export interface Candidate { x: number; y: number; rotation: number; dims: { w: number; d: number; h: number } }

/** Items that may overlap others: rugs lie under furniture; wall/ceiling items are above it. */
const passesOver = (o: Pick<SceneObject, 'assetId' | 'elevation' | 'dims'>) => o.assetId === 'rug' || o.elevation > 0.5 || o.dims.h < 0.03;

/** Keep-clear zone in front of and behind each door on the floor. */
function doorZones(scene: Scene, floorId: string) {
  const zones: { x: number; y: number }[][] = [];
  for (const o of scene.openings) {
    if (o.type !== 'door') continue;
    const w = scene.walls.find((x) => x.id === o.wallId && x.floorId === floorId);
    if (!w) continue;
    const ang = wallAngle(w);
    const c = { x: w.a.x + Math.cos(ang) * o.offset, y: w.a.y + Math.sin(ang) * o.offset };
    zones.push(objectCorners({ x: c.x, y: c.y, rotation: -ang, dims: { w: o.width + 0.1, d: Math.max(1.6, o.width * 2), h: 0 } }));
  }
  return zones;
}

export function fits(scene: Scene, room: Room, cand: Candidate & { assetId?: string; elevation?: number }, others: SceneObject[], zones = doorZones(scene, room.floorId)): boolean {
  const corners = objectCorners(cand);
  // a small margin keeps footprints off the wall centre-lines (touching counts as outside)
  if (!footprintInside(objectCorners(cand, 0.02), room.polygon)) return false;
  const self = { assetId: cand.assetId ?? '', elevation: cand.elevation ?? 0, dims: cand.dims };
  if (passesOver(self)) return true;
  if (zones.some((z) => quadsOverlap(corners, z))) return false;
  return !others.some((o) => o.floorId === room.floorId && !passesOver(o) && quadsOverlap(corners, objectCorners(o, -0.01)));
}

/**
 * Find a valid spot for an item in a room.
 *  - preferred spot is used if it fits
 *  - 'wall' items slide along each bounding wall face (longest first), facing into the room
 *  - other items search a grid inside the room, nearest to the preferred point / centroid first
 * Returns null when nothing fits ("no safe fit").
 */
export function findSpot(scene: Scene, room: Room, item: { dims: Candidate['dims']; assetId?: string; elevation?: number }, opts: { kind: 'wall' | 'center'; preferred?: { x: number; y: number; rotation: number }; others?: SceneObject[] }): Candidate | null {
  const others = opts.others ?? scene.objects;
  const zones = doorZones(scene, room.floorId);
  const base = { dims: item.dims, assetId: item.assetId, elevation: item.elevation };
  if (opts.preferred) {
    const c = { ...base, ...opts.preferred };
    if (fits(scene, room, c, others, zones)) return { x: c.x, y: c.y, rotation: c.rotation, dims: c.dims };
  }
  if (opts.kind === 'wall') {
    const faces = roomWallSides(scene, room).sort((a, b) => (b.to - b.from) - (a.to - a.from));
    for (const f of faces) {
      const ang = wallAngle(f.wall);
      const u = { x: Math.cos(ang), y: Math.sin(ang) };
      let n = { x: -u.y, y: u.x };
      if (f.side === 'B') n = { x: -n.x, y: -n.y };
      // stand just inside the room outline (plans traced at inner wall faces sit further from the centre-line)
      const off = Math.max(f.wall.thickness / 2, f.inset) + item.dims.d / 2 + 0.04;
      const rotation = Math.atan2(n.x, n.y);
      const mid = (f.from + f.to) / 2;
      for (let k = 0; k <= (f.to - f.from) / 2; k += 0.1) {
        for (const along of k === 0 ? [mid] : [mid + k, mid - k]) {
          const c = { ...base, x: f.wall.a.x + u.x * along + n.x * off, y: f.wall.a.y + u.y * along + n.y * off, rotation };
          if (fits(scene, room, c, others, zones)) return { x: +c.x.toFixed(3), y: +c.y.toFixed(3), rotation, dims: item.dims };
        }
      }
    }
    return null;
  }
  const b = bbox(room.polygon);
  const target = opts.preferred ?? { ...centroid(room.polygon), rotation: 0 };
  const pts: { x: number; y: number; d: number }[] = [];
  for (let x = b.minX; x <= b.maxX; x += 0.15) for (let y = b.minY; y <= b.maxY; y += 0.15) pts.push({ x, y, d: (x - target.x) ** 2 + (y - target.y) ** 2 });
  pts.sort((p, q) => p.d - q.d);
  for (const p of pts) {
    for (const rotation of [target.rotation, target.rotation + Math.PI / 2]) {
      const c = { ...base, x: p.x, y: p.y, rotation };
      if (fits(scene, room, c, others, zones)) return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), rotation, dims: item.dims };
    }
  }
  return null;
}

export const objectInRoom = (o: Pick<SceneObject, 'x' | 'y' | 'floorId'>, r: Room) => o.floorId === r.floorId && pointInPolygon(o, r.polygon);
