/**
 * Electrical & lighting layout: symbol catalogue, automatic first-draft layout per room (common
 * Indian residential practice), schedule / BOQ counts, and a printable electrical plan (SVG).
 * Everything here is a design aid — a licensed electrician must size circuits, wires and breakers.
 */
import type { ElecKind, ElecPoint, Pt, Room, Scene } from './types';
import { bbox, centroid, fmtLen, pointInPolygon, polygonArea, wallAngle, wallLength } from './geometry';
import { roomWallSides, type RoomFace } from './placement';
import { uid } from './templates';

export interface ElecMeta {
  kind: ElecKind; label: string; short: string; color: string; mount: 'wall' | 'ceiling';
  height: number; watts: number; group: 'Switches & sockets' | 'Lighting' | 'Appliance points' | 'Other';
  light?: { lumens: number; spot?: boolean };
}
export const ELEC: Record<ElecKind, ElecMeta> = {
  switchboard: { kind: 'switchboard', label: 'Switchboard', short: 'SB', color: '#f59e0b', mount: 'wall', height: 1.2, watts: 0, group: 'Switches & sockets' },
  socket: { kind: 'socket', label: '6A socket', short: '6A', color: '#38bdf8', mount: 'wall', height: 0.3, watts: 100, group: 'Switches & sockets' },
  'power-socket': { kind: 'power-socket', label: '16A power socket', short: '16A', color: '#ef4444', mount: 'wall', height: 1.1, watts: 1500, group: 'Switches & sockets' },
  'tv-point': { kind: 'tv-point', label: 'TV point (power + cable)', short: 'TV', color: '#a78bfa', mount: 'wall', height: 0.45, watts: 200, group: 'Switches & sockets' },
  data: { kind: 'data', label: 'Data / Wi-Fi (LAN)', short: 'LAN', color: '#22d3ee', mount: 'wall', height: 0.3, watts: 0, group: 'Switches & sockets' },
  ac: { kind: 'ac', label: 'AC point (20A)', short: 'AC', color: '#60a5fa', mount: 'wall', height: 2.2, watts: 1800, group: 'Appliance points' },
  geyser: { kind: 'geyser', label: 'Geyser point (16A)', short: 'GY', color: '#f97316', mount: 'wall', height: 1.9, watts: 2000, group: 'Appliance points' },
  exhaust: { kind: 'exhaust', label: 'Exhaust fan', short: 'EX', color: '#94a3b8', mount: 'wall', height: 2.2, watts: 40, group: 'Appliance points' },
  fan: { kind: 'fan', label: 'Ceiling fan', short: 'F', color: '#34d399', mount: 'ceiling', height: 0, watts: 60, group: 'Lighting' },
  light: { kind: 'light', label: 'Ceiling light', short: 'L', color: '#fde047', mount: 'ceiling', height: 0, watts: 18, group: 'Lighting', light: { lumens: 1800 } },
  downlight: { kind: 'downlight', label: 'Downlight / spot', short: 'DL', color: '#fef08a', mount: 'ceiling', height: 0, watts: 9, group: 'Lighting', light: { lumens: 800, spot: true } },
  pendant: { kind: 'pendant', label: 'Pendant / chandelier', short: 'PL', color: '#facc15', mount: 'ceiling', height: 0, watts: 24, group: 'Lighting', light: { lumens: 1600 } },
  'wall-light': { kind: 'wall-light', label: 'Wall light / mirror light', short: 'WL', color: '#fde68a', mount: 'wall', height: 2.0, watts: 10, group: 'Lighting', light: { lumens: 600 } },
  strip: { kind: 'strip', label: 'LED strip / profile', short: 'ST', color: '#fbbf24', mount: 'wall', height: 2.3, watts: 14, group: 'Lighting', light: { lumens: 900 } },
  db: { kind: 'db', label: 'Distribution board (DB)', short: 'DB', color: '#dc2626', mount: 'wall', height: 1.6, watts: 0, group: 'Other' },
  bell: { kind: 'bell', label: 'Doorbell', short: 'BL', color: '#c084fc', mount: 'wall', height: 1.4, watts: 5, group: 'Other' },
  cctv: { kind: 'cctv', label: 'CCTV / camera point', short: 'CC', color: '#64748b', mount: 'wall', height: 2.4, watts: 6, group: 'Other' },
};
export const ELEC_KINDS = Object.keys(ELEC) as ElecKind[];
export const isLight = (k: ElecKind) => !!ELEC[k].light;

// ───────────── wall-face helpers ─────────────
interface FaceGeo { face: RoomFace; u: Pt; nIn: Pt; len: number; doors: [number, number][]; blocks: [number, number][] }
function faceGeo(scene: Scene, f: RoomFace): FaceGeo {
  const ang = wallAngle(f.wall);
  const u = { x: Math.cos(ang), y: Math.sin(ang) };
  const n = { x: -u.y, y: u.x };
  const nIn = f.side === 'A' ? n : { x: -n.x, y: -n.y };
  const ops = scene.openings.filter((o) => o.wallId === f.wall.id && o.offset + o.width / 2 > f.from && o.offset - o.width / 2 < f.to);
  return {
    face: f, u, nIn, len: f.to - f.from,
    doors: ops.filter((o) => o.type === 'door').map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]),
    blocks: ops.map((o) => [o.offset - o.width / 2 - 0.12, o.offset + o.width / 2 + 0.12]),
  };
}
function onFace(g: FaceGeo, t: number): { p: Pt; facing: number } {
  const w = g.face.wall;
  const off = w.thickness / 2 + 0.02;
  return { p: { x: +(w.a.x + g.u.x * t + g.nIn.x * off).toFixed(3), y: +(w.a.y + g.u.y * t + g.nIn.y * off).toFixed(3) }, facing: Math.atan2(g.nIn.y, g.nIn.x) };
}
/** Nearest position to `t` on the face that is clear of doors/windows (for low or switch-height points). */
function clearT(g: FaceGeo, t: number, ignoreWindows = false): number | null {
  const blocks = ignoreWindows ? g.doors.map(([a, b]) => [a - 0.12, b + 0.12] as [number, number]) : g.blocks;
  const lo = g.face.from + 0.15, hi = g.face.to - 0.15;
  if (hi <= lo) return null;
  const ok = (x: number) => x >= lo && x <= hi && !blocks.some(([a, b]) => x > a && x < b);
  if (ok(t)) return t;
  for (let d = 0.05; d < g.len; d += 0.05) { if (ok(t + d)) return t + d; if (ok(t - d)) return t - d; }
  return null;
}

/** Wall-mounted point at (or near) a position along a face. */
export function snapToWall(scene: Scene, floorId: string, p: Pt, maxDist = 0.6): { p: Pt; facing: number } | null {
  let best: { p: Pt; facing: number; d: number } | null = null;
  for (const w of scene.walls) {
    if (w.floorId !== floorId) continue;
    const L = wallLength(w); if (L < 0.05) continue;
    const ang = wallAngle(w), u = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -u.y, y: u.x };
    const t = Math.max(0, Math.min(L, (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y));
    const s = (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y;
    const d = Math.abs(s) - w.thickness / 2;
    if (d > maxDist || (best && d >= best.d)) continue;
    const side = s >= 0 ? 1 : -1, off = w.thickness / 2 + 0.02;
    best = { p: { x: +(w.a.x + u.x * t + n.x * off * side).toFixed(3), y: +(w.a.y + u.y * t + n.y * off * side).toFixed(3) }, facing: Math.atan2(n.y * side, n.x * side), d };
  }
  return best ? { p: best.p, facing: best.facing } : null;
}

export function makePoint(floorId: string, kind: ElecKind, p: Pt, facing?: number, extra: Partial<ElecPoint> = {}): ElecPoint {
  return { id: uid(), floorId, kind, x: p.x, y: p.y, height: ELEC[kind].height, facing, source: 'manual', ...extra };
}

// ───────────── automatic first-draft layout ─────────────
/** Ceiling grid of n×m points inside the room (falls back to centroid for awkward shapes). */
function grid(room: Room, nx: number, ny: number): Pt[] {
  const b = bbox(room.polygon), out: Pt[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const p = { x: +(b.minX + ((i + 0.5) * (b.maxX - b.minX)) / nx).toFixed(3), y: +(b.minY + ((j + 0.5) * (b.maxY - b.minY)) / ny).toFixed(3) };
    if (pointInPolygon(p, room.polygon)) out.push(p);
  }
  return out.length ? out : [centroid(room.polygon)];
}

/**
 * Suggest a first-draft electrical layout for a room from its type, size, doors and walls.
 * Typical practice: switchboard beside the entry door at 1.2 m; sockets at 0.3 m; kitchen counter sockets at 1.1 m;
 * AC 2.2 m; geyser 1.9 m; fan + lights on the ceiling. The user moves or deletes anything that doesn't fit.
 */
export function suggestForRoom(scene: Scene, room: Room): ElecPoint[] {
  const faces = roomWallSides(scene, room).map((f) => faceGeo(scene, f)).filter((g) => g.len > 0.4);
  const out: ElecPoint[] = [];
  const fId = room.floorId;
  const area = Math.abs(polygonArea(room.polygon));
  const add = (kind: ElecKind, g: FaceGeo | undefined, t: number, extra: Partial<ElecPoint> = {}, ignoreWindows = false) => {
    if (!g) return;
    const tt = clearT(g, t, ignoreWindows); if (tt === null) return;
    const { p, facing } = onFace(g, tt);
    out.push(makePoint(fId, kind, p, facing, { source: 'ai', ...extra }));
  };
  const ceil = (kind: ElecKind, p: Pt, extra: Partial<ElecPoint> = {}) => out.push(makePoint(fId, kind, p, undefined, { source: 'ai', ...extra }));
  if (!faces.length) { ceil('light', centroid(room.polygon)); return out; }

  // entry: the face holding a door, switchboard just beside the door on the longer remaining side
  const doorFace = faces.find((g) => g.doors.length) ?? faces[0];
  const door = doorFace.doors[0];
  const sbT = door ? (door[0] - doorFace.face.from > doorFace.face.to - door[1] ? door[0] - 0.25 : door[1] + 0.25) : doorFace.face.from + 0.4;
  const byLen = [...faces].sort((a, b) => b.len - a.len);
  // the wall facing the entry (furthest face from the switchboard) — usual bed / TV / sofa wall
  const sb = onFace(doorFace, sbT).p;
  const far = [...faces].filter((g) => g !== doorFace).sort((a, b) => {
    const da = a.doors.length ? 1 : 0, db = b.doors.length ? 1 : 0;
    if (da !== db) return da - db; // a wall without doors makes a better bed / TV / counter wall
    const pa = onFace(a, (a.face.from + a.face.to) / 2).p, pb = onFace(b, (b.face.from + b.face.to) / 2).p;
    return Math.hypot(pb.x - sb.x, pb.y - sb.y) - Math.hypot(pa.x - sb.x, pa.y - sb.y);
  })[0] ?? byLen[0];
  const mid = (g: FaceGeo) => (g.face.from + g.face.to) / 2;
  const side = faces.filter((g) => g !== doorFace && g !== far).sort((a, b) => b.len - a.len)[0] ?? far;
  /** About `n` downlights in an even grid matching the room's proportions, kept clear of a central fan. */
  const ceilingLights = (n: number, avoidCentre = false) => {
    const b = bbox(room.polygon), w = b.maxX - b.minX, h = b.maxY - b.minY;
    const nx = Math.max(1, Math.min(4, Math.round(Math.sqrt((n * w) / Math.max(0.5, h))))), ny = Math.max(1, Math.min(4, Math.ceil(n / nx)));
    const c = centroid(room.polygon);
    grid(room, nx, ny).filter((p) => !avoidCentre || Math.hypot(p.x - c.x, p.y - c.y) > 0.6).forEach((p) => ceil('downlight', p));
  };

  switch (room.roomType) {
    case 'bedroom':
      add('switchboard', doorFace, sbT, { gang: 8, note: 'Lights, fan regulator, 6A socket' }, true);
      ceil('fan', centroid(room.polygon));
      ceilingLights(4, true);
      add('socket', far, mid(far) - 1.05, { height: 0.75, gang: 4, note: 'Bedside: lamp + phone charger + 2-way switch' });
      add('socket', far, mid(far) + 1.05, { height: 0.75, gang: 4, note: 'Bedside: lamp + phone charger' });
      add('ac', side, mid(side), { note: 'Split AC — keep 15 cm below ceiling' }, true);
      add('tv-point', doorFace === far ? side : doorFace, mid(doorFace === far ? side : doorFace) + 0.6, { note: 'Wall-mounted TV opposite the bed' });
      if (area > 11) add('socket', side, side.face.from + 0.6, { note: 'Study / dressing table' });
      break;
    case 'living':
      add('switchboard', doorFace, sbT, { gang: 12, note: 'Main lights, fan, cove, spots' }, true);
      add('bell', doorFace, door ? (sbT < door[0] ? door[0] - 0.4 : door[1] + 0.4) : sbT + 0.3, { note: 'Outside the main door' }, true);
      ceil('fan', centroid(room.polygon));
      ceilingLights(area > 25 ? 8 : 6, true);
      add('tv-point', far, mid(far), { gang: 6, note: 'TV + set-top box + soundbar' });
      add('socket', far, mid(far) + 0.5, { gang: 2 });
      add('data', far, mid(far) - 0.5, { note: 'Wi-Fi router / LAN' });
      add('ac', side, mid(side), {}, true);
      add('socket', side, side.face.from + 0.5, { note: 'Sofa end — lamp / charger' });
      add('strip', far, mid(far), { note: 'TV wall back-light' });
      break;
    case 'kitchen': {
      add('switchboard', doorFace, sbT, { gang: 6 }, true);
      ceilingLights(2);
      const counter = far;
      [-0.9, 0, 0.9].forEach((d) => add('power-socket', counter, mid(counter) + d, { note: 'Counter appliances (mixer, kettle, toaster)' }, true));
      add('power-socket', counter, mid(counter) - 0.3, { height: 2.1, note: 'Chimney' }, true);
      add('power-socket', side, side.face.from + 0.5, { height: 0.3, note: 'Refrigerator' });
      add('power-socket', counter, counter.face.to - 0.4, { height: 0.5, note: 'RO / water purifier (under counter)' });
      add('exhaust', side, mid(side), {}, true);
      add('strip', counter, mid(counter), { height: 1.5, note: 'Under-cabinet LED' });
      break;
    }
    case 'bathroom':
      add('switchboard', doorFace, sbT, { gang: 4, note: 'Fit outside the wet area' }, true);
      ceil('light', centroid(room.polygon), { note: 'IP44 or better' });
      add('geyser', far, mid(far), {}, true);
      add('exhaust', side, mid(side), {}, true);
      add('wall-light', side === far ? doorFace : side, mid(side === far ? doorFace : side), { note: 'Mirror light' });
      add('socket', side === far ? doorFace : side, mid(side === far ? doorFace : side) + 0.4, { height: 1.2, note: 'Shaver / hair-dryer (shuttered)' });
      break;
    case 'dining':
      add('switchboard', doorFace, sbT, { gang: 4 }, true);
      ceil('pendant', centroid(room.polygon), { note: 'Over the dining table' });
      ceilingLights(2);
      add('socket', side, mid(side), { height: 0.9, note: 'Sideboard / hot case' });
      break;
    case 'utility':
      add('switchboard', doorFace, sbT, { gang: 2 }, true);
      ceil('light', centroid(room.polygon));
      add('power-socket', far, mid(far), { height: 1.0, note: 'Washing machine' });
      add('power-socket', side, mid(side), { height: 1.0, note: 'Dryer / dishwasher' });
      break;
    case 'balcony':
      add('switchboard', doorFace, sbT, { gang: 2 }, true);
      ceil('light', centroid(room.polygon));
      add('socket', far, mid(far), { height: 0.9, note: 'Weather-proof socket' });
      break;
    case 'pooja':
      add('switchboard', doorFace, sbT, { gang: 2 }, true);
      add('strip', far, mid(far), { height: 1.8, note: 'Back-lit mandir panel' });
      add('socket', far, mid(far) + 0.4, { height: 0.9, note: 'Diya / lamp' });
      break;
    case 'office':
      add('switchboard', doorFace, sbT, { gang: 6 }, true);
      ceil('fan', centroid(room.polygon));
      ceilingLights(4, true);
      add('socket', far, mid(far), { height: 0.8, gang: 4, note: 'Desk: PC, monitor, charger' });
      add('data', far, mid(far) + 0.3, { height: 0.8 });
      add('ac', side, mid(side), {}, true);
      break;
    default:
      add('switchboard', doorFace, sbT, { gang: 2 }, true);
      ceil('light', centroid(room.polygon));
  }
  return out;
}

// ───────────── schedule / counts ─────────────
export interface ElecRow { room: string; kind: ElecKind; label: string; qty: number; heights: string; notes: string }
export function roomOf(scene: Scene, e: ElecPoint): Room | undefined {
  const rooms = scene.rooms.filter((r) => r.floorId === e.floorId);
  return rooms.find((r) => pointInPolygon(e, r.polygon)) ?? rooms.find((r) => {
    const b = bbox(r.polygon); return e.x > b.minX - 0.4 && e.x < b.maxX + 0.4 && e.y > b.minY - 0.4 && e.y < b.maxY + 0.4;
  });
}
export function schedule(scene: Scene, units: 'm' | 'ft', floorId?: string): ElecRow[] {
  const map = new Map<string, ElecRow>();
  for (const e of scene.electrical ?? []) {
    if (floorId && e.floorId !== floorId) continue;
    const room = roomOf(scene, e)?.name ?? 'Unassigned';
    const k = room + '|' + e.kind;
    const r = map.get(k) ?? { room, kind: e.kind, label: ELEC[e.kind].label, qty: 0, heights: '', notes: '' };
    r.qty++;
    const h = ELEC[e.kind].mount === 'ceiling' ? 'ceiling' : fmtLen(e.height, units);
    if (!r.heights.split(', ').includes(h)) r.heights = r.heights ? `${r.heights}, ${h}` : h;
    if (e.note && !r.notes.includes(e.note)) r.notes = r.notes ? `${r.notes}; ${e.note}` : e.note;
    map.set(k, r);
  }
  return [...map.values()].sort((a, b) => a.room.localeCompare(b.room) || ELEC_KINDS.indexOf(a.kind) - ELEC_KINDS.indexOf(b.kind));
}
export function totals(scene: Scene) {
  const t: Partial<Record<ElecKind, number>> = {};
  let watts = 0;
  for (const e of scene.electrical ?? []) { t[e.kind] = (t[e.kind] ?? 0) + 1; watts += ELEC[e.kind].watts; }
  return { counts: t, watts, points: (scene.electrical ?? []).length };
}
const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function scheduleCsv(scene: Scene, units: 'm' | 'ft'): string {
  const rows = schedule(scene, units);
  const head = ['Room', 'Point', 'Qty', 'Mounting height', 'Notes'];
  return [head, ...rows.map((r) => [r.room, r.label, r.qty, r.heights, r.notes])].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

// ───────────── printable plan ─────────────
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Standalone SVG of one floor: walls, openings, room names and electrical symbols, with a legend. */
export function electricalPlanSvg(scene: Scene, floorId: string, title: string, units: 'm' | 'ft'): { svg: string; w: number; h: number } {
  const walls = scene.walls.filter((w) => w.floorId === floorId);
  const rooms = scene.rooms.filter((r) => r.floorId === floorId);
  const pts = (scene.electrical ?? []).filter((e) => e.floorId === floorId);
  const all = [...walls.flatMap((w) => [w.a, w.b]), ...rooms.flatMap((r) => r.polygon), ...pts];
  const b = all.length ? bbox(all) : { minX: 0, minY: 0, maxX: 10, maxY: 8 };
  const S = 90; // px per metre
  const pad = 60, legendW = 300;
  const W = Math.round((b.maxX - b.minX) * S + pad * 2 + legendW), H = Math.max(Math.round((b.maxY - b.minY) * S + pad * 2 + 50), 620);
  const X = (x: number) => ((x - b.minX) * S + pad).toFixed(1), Y = (y: number) => ((y - b.minY) * S + pad + 40).toFixed(1);
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<text x="${pad}" y="34" font-size="20" font-weight="700" fill="#111">${esc(title)}</text>`);
  for (const r of rooms) {
    parts.push(`<polygon points="${r.polygon.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}" fill="#f6f5f2" stroke="none"/>`);
    const c = centroid(r.polygon);
    parts.push(`<text x="${X(c.x)}" y="${Y(c.y)}" font-size="13" fill="#9a958d" text-anchor="middle">${esc(r.name)}</text>`);
  }
  for (const w of walls) parts.push(`<line x1="${X(w.a.x)}" y1="${Y(w.a.y)}" x2="${X(w.b.x)}" y2="${Y(w.b.y)}" stroke="#333" stroke-width="${(w.thickness * S).toFixed(1)}" stroke-linecap="square"/>`);
  for (const o of scene.openings) {
    const w = walls.find((x) => x.id === o.wallId); if (!w) continue;
    const ang = wallAngle(w), c = { x: w.a.x + Math.cos(ang) * o.offset, y: w.a.y + Math.sin(ang) * o.offset }, hw = o.width / 2;
    parts.push(`<line x1="${X(c.x - Math.cos(ang) * hw)}" y1="${Y(c.y - Math.sin(ang) * hw)}" x2="${X(c.x + Math.cos(ang) * hw)}" y2="${Y(c.y + Math.sin(ang) * hw)}" stroke="${o.type === 'door' ? '#fff' : '#bfe3f5'}" stroke-width="${(w.thickness * S - 2).toFixed(1)}"/>`);
  }
  // switchboard → ceiling light/fan "switching" links (dashed), per room
  for (const r of rooms) {
    const inR = pts.filter((e) => pointInPolygon(e, r.polygon) || roomOf(scene, e)?.id === r.id);
    const sbp = inR.find((e) => e.kind === 'switchboard');
    if (!sbp) continue;
    for (const e of inR) if (ELEC[e.kind].mount === 'ceiling') parts.push(`<path d="M${X(sbp.x)},${Y(sbp.y)} Q${X((sbp.x + e.x) / 2 + 0.3)},${Y((sbp.y + e.y) / 2 - 0.3)} ${X(e.x)},${Y(e.y)}" fill="none" stroke="#bbb" stroke-dasharray="4 4" stroke-width="1"/>`);
  }
  for (const e of pts) parts.push(symbolSvg(e, +X(e.x), +Y(e.y)));
  // legend
  const lx = W - legendW + 10;
  parts.push(`<text x="${lx}" y="${pad + 40}" font-size="14" font-weight="700" fill="#111">Legend</text>`);
  const used = ELEC_KINDS.filter((k) => pts.some((p) => p.kind === k));
  used.forEach((k, i) => {
    const y = pad + 66 + i * 30, n = pts.filter((p) => p.kind === k).length;
    parts.push(symbolSvg({ kind: k } as ElecPoint, lx + 12, y));
    parts.push(`<text x="${lx + 32}" y="${y + 4}" font-size="12" fill="#222">${esc(ELEC[k].label)} × ${n}${ELEC[k].mount === 'wall' ? ` · ${fmtLen(ELEC[k].height, units)}` : ''}</text>`);
  });
  const ny = pad + 80 + used.length * 30;
  parts.push(`<text x="${lx}" y="${ny}" font-size="10" fill="#666"><tspan x="${lx}" dy="0">Heights are to the centre of the box from</tspan><tspan x="${lx}" dy="13">finished floor level. Indicative layout —</tspan><tspan x="${lx}" dy="13">circuits, wire sizes and MCBs to be</tspan><tspan x="${lx}" dy="13">designed by a licensed electrician.</tspan></text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
  return { svg, w: W, h: H };
}

export function symbolSvg(e: Pick<ElecPoint, 'kind'>, x: number, y: number, r = 11): string {
  const m = ELEC[e.kind];
  const c = m.color;
  const sw = (k: number) => (r * k).toFixed(3);
  if (e.kind === 'fan') return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${c}" stroke-width="${sw(0.18)}"/>${[0, 120, 240].map((a) => `<ellipse cx="${x}" cy="${y - r * 0.5}" rx="${r * 0.22}" ry="${r * 0.5}" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join('')}</g>`;
  if (m.light) return `<g><circle cx="${x}" cy="${y}" r="${e.kind === 'downlight' ? r * 0.7 : r}" fill="${c}" stroke="#a16207" stroke-width="${sw(0.14)}"/><path d="M${x - r * 0.5} ${y - r * 0.5} L${x + r * 0.5} ${y + r * 0.5} M${x + r * 0.5} ${y - r * 0.5} L${x - r * 0.5} ${y + r * 0.5}" stroke="#a16207" stroke-width="${sw(0.11)}"/></g>`;
  if (e.kind === 'switchboard' || e.kind === 'db') return `<g><rect x="${x - r}" y="${y - r * 0.7}" width="${r * 2}" height="${r * 1.4}" rx="${sw(0.18)}" fill="${c}" stroke="#111" stroke-width="${sw(0.09)}"/><text x="${x}" y="${y + r * 0.3}" font-size="${r * 0.8}" font-weight="700" fill="#111" text-anchor="middle">${m.short}</text></g>`;
  return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${c}" stroke-width="${sw(0.2)}"/><text x="${x}" y="${y + r * 0.3}" font-size="${m.short.length > 2 ? r * 0.62 : r * 0.8}" font-weight="700" fill="${c}" text-anchor="middle">${m.short}</text></g>`;
}

/** Rasterise an SVG string to a PNG data URL (browser only). */
export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not draw the plan.')); img.src = url; });
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext('2d')!; ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
