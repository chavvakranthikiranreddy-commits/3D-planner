import type { Lighting, Material, Room, RoomType, Scene, SceneObject } from './types';
import { CATALOG, getAsset, type AssetStyle } from './catalog';
import { bbox, projectOnSegment, setWallMaterial, wallSideFacing } from './geometry';
import { makeObject, uid } from './templates';
import { parseColorInput } from './materials';

/**
 * AI design assistant — provider-agnostic.
 * A provider returns a *proposal*: a list of structured, reviewable scene edits.
 * Proposals can never move walls, rooms or openings; only finishes, furniture and lighting.
 */
export type Change =
  | { id: string; kind: 'paint-walls'; label: string; targets: { wallId: string; side: 'A' | 'B' }[]; material: Material }
  | { id: string; kind: 'floor'; label: string; roomId: string; materialId: string }
  | { id: string; kind: 'add'; label: string; object: SceneObject }
  | { id: string; kind: 'remove'; label: string; objectId: string }
  | { id: string; kind: 'lighting'; label: string; lighting: Partial<Lighting> };

export interface Proposal { provider: string; summary: string; changes: Change[]; estimatedCost: number; notes: string[] }
export interface DesignRequest { roomId: string; style: AssetStyle; prompt: string; budget?: number; palette?: string[]; replaceFurniture: boolean }

export interface DesignProvider {
  id: string;
  name: string;
  propose(scene: Scene, req: DesignRequest): Promise<Proposal>;
}

interface StyleProfile { wall: string; accentWall?: string; floor: string; upholstery: string; wood: string; metal: string; warmth: number; note: string }
const PROFILES: Record<AssetStyle, StyleProfile> = {
  modern: { wall: '#ecebe6', accentWall: '#3d4148', floor: 'tile-vitrified', upholstery: '#7c838b', wood: '#5c4636', metal: '#202022', warmth: 0.4, note: 'Clean lines, neutral greys and a single dark accent wall.' },
  scandinavian: { wall: '#f4f1ea', floor: 'wood-oak', upholstery: '#c9c3b6', wood: '#c7a57d', metal: '#202022', warmth: 0.5, note: 'Light oak, soft whites and textured neutrals for a bright, airy room.' },
  industrial: { wall: '#bdb7ae', accentWall: '#6e5a4b', floor: 'concrete', upholstery: '#6b4a33', wood: '#4a3527', metal: '#1d1d1f', warmth: 0.35, note: 'Raw concrete, leather tones and black metal.' },
  'indian-contemporary': { wall: '#efe6d6', accentWall: '#b5653f', floor: 'stone-marble', upholstery: '#b38b4d', wood: '#7a4f2c', metal: '#b38b4d', warmth: 0.65, note: 'Warm marble, teak-toned wood, terracotta accent and brass details.' },
  minimal: { wall: '#f6f5f2', floor: 'stone-terrazzo', upholstery: '#e0ddd6', wood: '#d6c2a6', metal: '#9a9a9a', warmth: 0.45, note: 'Pared-back whites with pale wood and minimal furniture.' },
  boho: { wall: '#ead9c3', accentWall: '#a8b5a0', floor: 'wood-herringbone', upholstery: '#c08a5b', wood: '#9a6b3f', metal: '#b38b4d', warmth: 0.7, note: 'Earthy sand, sage and rust with layered textures and plants.' },
  luxury: { wall: '#e9e4dc', accentWall: '#2c3a52', floor: 'stone-marble', upholstery: '#2f3a3a', wood: '#3b2a20', metal: '#b38b4d', warmth: 0.55, note: 'Marble, deep navy, walnut and brushed brass.' },
  classic: { wall: '#efe9dd', floor: 'wood-walnut', upholstery: '#8a6f55', wood: '#6b4a33', metal: '#b38b4d', warmth: 0.6, note: 'Traditional walnut, cream walls and warm upholstery.' },
};

const COLOR_WORDS: Record<string, string> = {
  green: '#a8b5a0', sage: '#a8b5a0', olive: '#8a8a5c', blue: '#9fb3c8', navy: '#2c3a52', teal: '#3f7d7a', white: '#f4f1ea',
  beige: '#e6d9c4', cream: '#f1e8d6', grey: '#b8b8b4', gray: '#b8b8b4', black: '#2b2b2b', pink: '#e8c4c0', blush: '#e8c4c0',
  terracotta: '#c46a4a', rust: '#b5653f', yellow: '#e9d38a', mustard: '#d4a94e', brown: '#8b6a47', earthy: '#cdb79e', pastel: '#dfe7e1',
};

type Role = { role: string; ids: string[]; place: (b: ReturnType<typeof bbox>, d: { w: number; d: number }) => { x: number; y: number; r: number } | null };
const inset = 0.15;
const LAYOUTS: Partial<Record<RoomType, Role[]>> = {
  living: [
    { role: 'sofa', ids: ['sofa-l', 'sofa-3', 'sofa-2'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.maxY - d.d / 2 - inset, r: Math.PI }) },
    { role: 'rug', ids: ['rug'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + 0.3, r: 0 }) },
    { role: 'coffee', ids: ['round-coffee', 'coffee-table'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + 0.3, r: 0 }) },
    { role: 'tv', ids: ['tv-unit', 'sideboard'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + d.d / 2 + inset, r: 0 }) },
    { role: 'armchair', ids: ['armchair'], place: (b, d) => (b.maxX - b.minX > 4 ? { x: b.minX + d.d / 2 + inset + 0.2, y: (b.minY + b.maxY) / 2, r: Math.PI / 2 } : null) },
    { role: 'lamp', ids: ['floor-lamp'], place: (b) => ({ x: b.maxX - 0.4, y: b.maxY - 0.4, r: 0 }) },
    { role: 'plant', ids: ['plant'], place: (b) => ({ x: b.minX + 0.4, y: b.minY + 0.4, r: 0 }) },
    { role: 'art', ids: ['art'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: b.maxY - 0.06, r: Math.PI }) },
  ],
  bedroom: [
    { role: 'bed', ids: ['bed-king', 'bed-queen', 'bed-single'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + d.d / 2 + inset, r: 0 }) },
    { role: 'ns1', ids: ['nightstand'], place: (b) => ({ x: (b.minX + b.maxX) / 2 - 1.3, y: b.minY + 0.35, r: 0 }) },
    { role: 'ns2', ids: ['nightstand'], place: (b) => ({ x: (b.minX + b.maxX) / 2 + 1.3, y: b.minY + 0.35, r: 0 }) },
    { role: 'wardrobe', ids: ['wardrobe'], place: (b, d) => (b.maxY - b.minY > 3.4 ? { x: (b.minX + b.maxX) / 2, y: b.maxY - d.d / 2 - inset, r: Math.PI } : null) },
    { role: 'rug', ids: ['rug'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + 1.9, r: 0 }) },
    { role: 'plant', ids: ['plant'], place: (b) => ({ x: b.maxX - 0.4, y: b.maxY - 0.4, r: 0 }) },
    { role: 'art', ids: ['art'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + 0.05, r: 0 }) },
  ],
  kitchen: [
    { role: 'base', ids: ['kitchen-base'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.maxY - d.d / 2 - inset + 0.05, r: Math.PI }) },
    { role: 'wall', ids: ['kitchen-wall'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.maxY - d.d / 2 - inset + 0.05, r: Math.PI }) },
    { role: 'fridge', ids: ['fridge'], place: (b, d) => ({ x: b.maxX - d.d / 2 - inset, y: b.minY + d.w / 2 + 0.4, r: -Math.PI / 2 }) },
    { role: 'island', ids: ['island'], place: (b) => (b.maxX - b.minX > 3.6 && b.maxY - b.minY > 3.6 ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, r: 0 } : null) },
  ],
  dining: [
    { role: 'table', ids: ['dining-6', 'dining-4'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, r: 0 }) },
    { role: 'pendant', ids: ['pendant'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, r: 0 }) },
    { role: 'sideboard', ids: ['sideboard'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + d.d / 2 + inset, r: 0 }) },
  ],
  bathroom: [
    { role: 'vanity', ids: ['vanity'], place: (b, d) => ({ x: b.maxX - d.w / 2 - inset, y: b.maxY - d.d / 2 - inset, r: Math.PI }) },
    { role: 'wc', ids: ['wc'], place: (b, d) => ({ x: b.minX + d.w / 2 + 0.3, y: b.maxY - d.d / 2 - inset, r: Math.PI }) },
    { role: 'shower', ids: ['shower', 'bathtub'], place: (b, d) => ({ x: b.minX + d.w / 2 + inset, y: b.minY + d.d / 2 + inset, r: 0 }) },
    { role: 'mirror', ids: ['mirror'], place: (b) => ({ x: b.maxX - 0.6, y: b.maxY - 0.05, r: Math.PI }) },
  ],
  office: [
    { role: 'desk', ids: ['desk'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + d.d / 2 + inset, r: 0 }) },
    { role: 'chair', ids: ['office-chair'], place: (b) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + 1.05, r: Math.PI }) },
    { role: 'shelf', ids: ['bookshelf'], place: (b, d) => ({ x: b.maxX - d.d / 2 - inset, y: (b.minY + b.maxY) / 2, r: -Math.PI / 2 }) },
    { role: 'plant', ids: ['plant'], place: (b) => ({ x: b.minX + 0.4, y: b.maxY - 0.4, r: 0 }) },
  ],
  pooja: [{ role: 'pooja', ids: ['pooja-unit'], place: (b, d) => ({ x: (b.minX + b.maxX) / 2, y: b.minY + d.d / 2 + inset, r: 0 }) }],
};

/** Walls bounding a room, with the face that looks into it. */
export function roomWallSides(scene: Scene, room: Room) {
  return wallsOfRoom(scene, room).map((w) => ({ wall: w, side: wallSideFacing(w, room.polygon) }));
}

/** Walls that bound a room: both endpoints lie on the room outline. */
export function wallsOfRoom(scene: Scene, room: Room) {
  const edges = room.polygon.map((p, i) => [p, room.polygon[(i + 1) % room.polygon.length]] as const);
  return scene.walls.filter((w) => w.floorId === room.floorId && [w.a, w.b, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }]
    .filter((p) => edges.some(([e0, e1]) => projectOnSegment(p, e0, e1).distance < Math.max(0.25, w.thickness))).length >= 2);
}

function pickAsset(ids: string[], style: AssetStyle, b: ReturnType<typeof bbox>) {
  const fits = (id: string) => { const a = getAsset(id)!; return a.dims.w < b.maxX - b.minX - 0.3 && a.dims.d < b.maxY - b.minY - 0.3; };
  return ids.find((id) => fits(id) && getAsset(id)!.styles.includes(style)) ?? ids.find(fits);
}

export const localProvider: DesignProvider = {
  id: 'local-rules',
  name: 'Built-in design rules (offline)',
  async propose(scene, req) {
    const room = scene.rooms.find((r) => r.id === req.roomId);
    if (!room) throw new Error('Select a room first.');
    const prof = { ...PROFILES[req.style] };
    const text = req.prompt.toLowerCase();
    const notes: string[] = [prof.note];
    // prompt colour words / explicit hex codes override the profile wall colour
    const hex = req.prompt.match(/#[0-9a-f]{6}\b/i)?.[0];
    const word = Object.keys(COLOR_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(text));
    const chosen = (hex && parseColorInput(hex)) || (req.palette && req.palette[0]) || (word && COLOR_WORDS[word]) || null;
    if (chosen) { prof.wall = chosen; notes.push(`Wall colour taken from your ${hex ? 'HEX code' : req.palette ? 'palette' : `"${word}" prompt`}.`); }
    if (/\b(dark|moody)\b/.test(text)) { prof.wall = '#4a4a4f'; prof.warmth = 0.6; }
    if (/\b(bright|airy|light)\b/.test(text)) prof.warmth = Math.min(prof.warmth, 0.45);
    if (/\bwarm|cosy|cozy\b/.test(text)) prof.warmth = 0.75;

    const changes: Change[] = [];
    const walls = roomWallSides(scene, room);
    if (walls.length) {
      const mat: Material = { id: 'ai-' + uid(), name: `${req.style} wall`, kind: 'paint', colorHex: prof.wall, roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 40 };
      const accentIdx = prof.accentWall && walls.length > 2 && !chosen ? 0 : -1;
      changes.push({ id: uid(), kind: 'paint-walls', label: `Paint ${walls.length - (accentIdx >= 0 ? 1 : 0)} walls ${prof.wall}`, targets: walls.filter((_, i) => i !== accentIdx).map((w) => ({ wallId: w.wall.id, side: w.side })), material: mat });
      if (accentIdx >= 0) {
        const am: Material = { ...mat, id: 'ai-' + uid(), name: `${req.style} accent`, colorHex: prof.accentWall! };
        changes.push({ id: uid(), kind: 'paint-walls', label: `Accent wall ${prof.accentWall}`, targets: [{ wallId: walls[accentIdx].wall.id, side: walls[accentIdx].side }], material: am });
      }
    }
    const floorId = /\bwood|oak|timber\b/.test(text) ? 'wood-oak' : /\bmarble\b/.test(text) ? 'stone-marble' : /\btile\b/.test(text) ? 'tile-vitrified' : room.roomType === 'bathroom' ? 'tile-vitrified' : prof.floor;
    if (floorId !== room.floorMaterialId) changes.push({ id: uid(), kind: 'floor', label: `Floor → ${scene.materials[floorId]?.name ?? floorId}`, roomId: room.id, materialId: floorId });

    const inRoom = scene.objects.filter((o) => o.floorId === room.floorId && o.x >= bbox(room.polygon).minX && o.x <= bbox(room.polygon).maxX && o.y >= bbox(room.polygon).minY && o.y <= bbox(room.polygon).maxY);
    if (req.replaceFurniture) inRoom.forEach((o) => changes.push({ id: uid(), kind: 'remove', label: `Remove ${o.name}`, objectId: o.id }));
    const layout = LAYOUTS[room.roomType] ?? LAYOUTS.living!;
    const b = bbox(room.polygon);
    let cost = 0;
    const minimal = req.style === 'minimal' || /\bminimal|sparse\b/.test(text);
    for (const role of layout) {
      if (minimal && ['plant', 'art', 'armchair', 'rug', 'lamp'].includes(role.role)) continue;
      if (!req.replaceFurniture && inRoom.some((o) => role.ids.includes(o.assetId))) continue;
      const id = pickAsset(role.ids, req.style, b);
      if (!id) continue;
      const a = getAsset(id)!;
      if (req.budget && cost + a.price > req.budget) { notes.push(`Skipped ${a.name} to stay within budget.`); continue; }
      const pos = role.place(b, a.dims);
      if (!pos) continue;
      const o = makeObject(id, room.floorId, +pos.x.toFixed(2), +pos.y.toFixed(2), pos.r, 'ai');
      if (['seating', 'beds'].includes(a.category)) o.colorHex = prof.upholstery;
      else if (['tables', 'storage'].includes(a.category) && !['tv-unit'].includes(id)) o.colorHex = prof.wood;
      if (a.category === 'lighting') o.colorHex = prof.metal;
      cost += a.price;
      changes.push({ id: uid(), kind: 'add', label: `Add ${a.name}`, object: o });
    }
    changes.push({ id: uid(), kind: 'lighting', label: `Lighting warmth ${Math.round(prof.warmth * 100)}%`, lighting: { warmth: prof.warmth } });
    return {
      provider: this.name,
      summary: `${req.style.replace('-', ' ')} concept for ${room.name}`,
      changes, estimatedCost: cost,
      notes: [...notes, 'Geometry (walls, openings, room outline) is never changed by the assistant.'],
    };
  },
};

/** Server provider: the backend holds API keys; the browser never sees them. */
export function remoteProvider(baseUrl: string, token: string): DesignProvider {
  return {
    id: 'remote',
    name: 'Server AI provider',
    async propose(scene, req) {
      const room = scene.rooms.find((r) => r.id === req.roomId);
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/ai/design-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ room, request: req, catalog: CATALOG.map((a) => ({ id: a.id, name: a.name, category: a.category, dims: a.dims, styles: a.styles, price: a.price })) }),
      });
      if (!res.ok) throw new Error(res.status === 501 ? 'The server has no AI provider configured.' : `Server error ${res.status}`);
      const data = await res.json();
      // The server returns high-level suggestions; we turn them into safe structured edits locally.
      const base = await localProvider.propose(scene, { ...req, style: data.style ?? req.style, prompt: `${req.prompt} ${data.wall_color ?? ''}`.trim() });
      return { ...base, provider: data.provider ?? 'Server AI', summary: data.summary ?? base.summary, notes: [...(data.notes ?? []), ...base.notes] };
    },
  };
}

/** Apply only the accepted changes; validates every reference. */
export function applyChanges(s: Scene, changes: Change[]) {
  for (const c of changes) {
    if (c.kind === 'paint-walls') {
      s.materials[c.material.id] = c.material;
      for (const t of c.targets) { const w = s.walls.find((x) => x.id === t.wallId); if (w) setWallMaterial(w, t.side, c.material.id); }
    } else if (c.kind === 'floor') {
      const r = s.rooms.find((x) => x.id === c.roomId);
      if (r && s.materials[c.materialId]) r.floorMaterialId = c.materialId;
    } else if (c.kind === 'add') {
      if (getAsset(c.object.assetId)) s.objects.push({ ...c.object, id: uid() });
    } else if (c.kind === 'remove') {
      s.objects = s.objects.filter((o) => o.id !== c.objectId);
    } else if (c.kind === 'lighting') {
      s.lighting = { ...s.lighting, ...c.lighting };
    }
  }
}
