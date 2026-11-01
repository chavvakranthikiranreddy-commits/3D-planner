/**
 * Matching colour palettes (from one base colour) and one-click whole-room style presets.
 * Both write to the scene in a single undo step: wall faces of the room, one feature wall, floor,
 * ceiling + false ceiling, and the colours of furniture already in the room.
 */
import type { CeilingType, Material, Room, Scene, SceneObject } from './types';
import { hexToRgb, rgbToHex } from './materials';
import { objectInRoom, roomWallSides, type RoomFace } from './placement';
import { setWallSpanMaterial } from './geometry';
import { defaultCeiling } from './interiors';
import { getAsset, type AssetStyle } from './catalog';

// ───────────── colour maths ─────────────
export function hexToHsl(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}
/** Light Reflectance Value (0 black … 100 white) — how much light a paint bounces back. */
export function lrv(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return Math.round((0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) * 100);
}

export interface Palette {
  id: string; name: string; note: string;
  walls: string; feature: string; ceiling: string; trim: string; upholstery: string; soft: string; wood: string;
}
const WOODS = { light: '#c9a27a', mid: '#9a6b45', dark: '#5b3d2a' };

/** Four schemes built around one base colour, each with room roles (walls, feature wall, ceiling…). */
export function palettesFrom(base: string): Palette[] {
  const [h, s, l] = hexToHsl(base);
  const soft = (dl: number, ds = 0.7) => hslToHex(h, s * ds, Math.min(0.94, l + dl));
  const deep = Math.max(0.18, Math.min(0.42, l - 0.25));
  const ceilingTint = hslToHex(h, Math.min(0.25, s * 0.3), 0.96);
  const warm = h < 70 || h > 300;
  return [
    {
      id: 'tonal', name: 'Tonal calm', note: 'Same colour family in lighter and deeper shades — restful and spacious.',
      walls: soft(Math.max(0.12, 0.82 - l), 0.55), feature: base, ceiling: ceilingTint, trim: '#f4f1ea', upholstery: hslToHex(h, s * 0.35, 0.72), soft: hslToHex(h, s, deep), wood: warm ? WOODS.mid : WOODS.light,
    },
    {
      id: 'analogous', name: 'Neighbouring colours', note: 'Colours next to each other on the wheel — harmonious with gentle variety.',
      walls: hslToHex(h - 20, s * 0.45, 0.85), feature: base, ceiling: ceilingTint, trim: '#f5f2ec', upholstery: hslToHex(h + 25, s * 0.5, 0.6), soft: hslToHex(h + 35, Math.min(1, s * 0.9), 0.45), wood: WOODS.mid,
    },
    {
      id: 'complementary', name: 'Bold contrast', note: 'Base colour paired with its opposite in small doses — lively, good for living rooms.',
      walls: hslToHex(h, s * 0.3, 0.88), feature: base, ceiling: '#fbfaf7', trim: '#efebe4', upholstery: hslToHex(h + 180, s * 0.45, 0.55), soft: hslToHex(h + 180, Math.min(1, s * 0.85), 0.42), wood: WOODS.dark,
    },
    {
      id: 'neutral', name: 'Neutral with accent', note: 'Warm neutrals everywhere; the base colour only on the feature wall and cushions.',
      walls: warm ? '#efe8dd' : '#ecebe7', feature: base, ceiling: '#fbfaf7', trim: '#f6f3ee', upholstery: warm ? '#d9cfc1' : '#cfd0cc', soft: base, wood: warm ? WOODS.mid : WOODS.light,
    },
  ];
}

// ───────────── style presets ─────────────
export interface RoomStylePreset {
  id: string; name: string; blurb: string; assetStyle: AssetStyle;
  walls: string; featureMaterial: string | null; featureHex?: string;
  floor: string; ceiling: CeilingType; warmth: number;
  upholstery: string; wood: string; metal: string; soft: string;
}
export const ROOM_STYLES: RoomStylePreset[] = [
  { id: 'modern-indian', name: 'Modern Indian', blurb: 'Warm whites, walnut fluting, brass and terracotta accents, cove-lit ceiling.', assetStyle: 'indian-contemporary', walls: '#f2ece1', featureMaterial: 'panel-fluted-walnut', floor: 'stone-marble', ceiling: 'cove-tray', warmth: 0.8, upholstery: '#c46a4a', wood: '#7b4f33', metal: '#b38b4d', soft: '#e0a33b' },
  { id: 'japandi', name: 'Japandi', blurb: 'Soft greige, light oak slats, linen and black details; calm and uncluttered.', assetStyle: 'minimal', walls: '#e6dfd3', featureMaterial: 'panel-wood-slat', floor: 'wood-oak', ceiling: 'wooden-slats', warmth: 0.6, upholstery: '#d8d0c3', wood: '#c9a27a', metal: '#2b2b2b', soft: '#8a8a5c' },
  { id: 'scandi', name: 'Scandinavian', blurb: 'Bright white walls, pale wood, soft grey fabrics and greenery.', assetStyle: 'scandinavian', walls: '#f4f3ef', featureMaterial: null, featureHex: '#a8b5a0', floor: 'wood-oak', ceiling: 'border', warmth: 0.45, upholstery: '#b9bcbf', wood: '#d4b48c', metal: '#2b2b2b', soft: '#a8b5a0' },
  { id: 'luxury', name: 'Luxury', blurb: 'Marble, deep navy feature wall, brass trims and layered ceiling glow.', assetStyle: 'luxury', walls: '#ece6dc', featureMaterial: null, featureHex: '#2c3a52', floor: 'stone-marble', ceiling: 'layered', warmth: 0.75, upholstery: '#2f3a3a', wood: '#5b3d2a', metal: '#c9a25b', soft: '#c9a25b' },
  { id: 'minimal', name: 'Minimal white', blurb: 'All-white shell, concrete-look floor, hidden lighting — gallery-like.', assetStyle: 'minimal', walls: '#f6f5f1', featureMaterial: 'texture-plaster', floor: 'concrete', ceiling: 'cove-tray', warmth: 0.4, upholstery: '#e5e3de', wood: '#d9cbb6', metal: '#9a9a9a', soft: '#3d3d3f' },
  { id: 'industrial', name: 'Industrial', blurb: 'Exposed brick, charcoal, black metal and leather tones.', assetStyle: 'industrial', walls: '#d6d2cb', featureMaterial: 'brick-exposed', floor: 'concrete', ceiling: 'none', warmth: 0.7, upholstery: '#7a4b2e', wood: '#5b3d2a', metal: '#1f1f1f', soft: '#3d3d3f' },
  { id: 'boho', name: 'Boho', blurb: 'Clay and olive tones, botanical wallpaper, rattan-warm woods.', assetStyle: 'boho', walls: '#efe2d0', featureMaterial: 'wallpaper-botanical', floor: 'wood-herringbone', ceiling: 'circular', warmth: 0.85, upholstery: '#a46a4f', wood: '#b07d4f', metal: '#b38b4d', soft: '#8a8a5c' },
  { id: 'classic', name: 'Classic', blurb: 'Damask feature wall, warm beige, dark wood and a chandelier-ready ceiling.', assetStyle: 'classic', walls: '#e9dcc6', featureMaterial: 'wallpaper-damask', floor: 'wood-herringbone', ceiling: 'layered', warmth: 0.85, upholstery: '#7d5a44', wood: '#4a2f22', metal: '#b38b4d', soft: '#8c2f39' },
  { id: 'contemporary', name: 'Contemporary grey', blurb: 'Greige walls, stone cladding feature, slate floor and cool light.', assetStyle: 'modern', walls: '#d8cfc2', featureMaterial: 'stone-cladding', floor: 'tile-slate', ceiling: 'border', warmth: 0.35, upholstery: '#8a9099', wood: '#6b5040', metal: '#3a3a3c', soft: '#3d4b63' },
];

// ───────────── applying to a room ─────────────
/** Feature wall = the longest face with no door (windows allowed), else the longest face. */
export function featureFace(scene: Scene, room: Room, faces = roomWallSides(scene, room)): RoomFace | undefined {
  const len = (f: RoomFace) => f.to - f.from;
  const hasDoor = (f: RoomFace) => scene.openings.some((o) => o.wallId === f.wall.id && o.type === 'door' && o.offset > f.from && o.offset < f.to);
  return [...faces].sort((a, b) => len(b) - len(a)).find((f) => !hasDoor(f)) ?? [...faces].sort((a, b) => len(b) - len(a))[0];
}
const paint = (id: string, name: string, hex: string): Material => ({ id, name, kind: 'paint', colorHex: hex, roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 45 });

function recolour(o: SceneObject, c: { upholstery: string; wood: string; metal?: string; soft: string }) {
  const a = getAsset(o.assetId);
  if (!a || o.modular) return;
  if (['seating', 'beds'].includes(a.category)) { o.colorHex = c.upholstery; if (a.category === 'beds') o.accentHex = c.wood; }
  else if (a.category === 'tables' || (a.category === 'storage' && o.assetId !== 'tv-unit')) o.colorHex = c.wood;
  else if (a.category === 'lighting' && c.metal) o.colorHex = c.metal;
  else if (a.category === 'furnishing' || o.assetId === 'rug') o.colorHex = c.soft;
}

export interface ApplyOpts { walls?: boolean; feature?: boolean; ceilingColour?: boolean; furniture?: boolean }
export function applyPalette(s: Scene, roomId: string, p: Palette, opts: ApplyOpts = { walls: true, feature: true, ceilingColour: true, furniture: true }) {
  const room = s.rooms.find((r) => r.id === roomId); if (!room) return;
  const faces = roomWallSides(s, room);
  const feat = opts.feature ? featureFace(s, room, faces) : undefined;
  const key = (hex: string) => hex.slice(1).toLowerCase();
  const wm = paint(`pal-${key(p.walls)}`, `Palette ${p.walls.toUpperCase()}`, p.walls), fm = paint(`pal-${key(p.feature)}`, `Feature ${p.feature.toUpperCase()}`, p.feature);
  const cm: Material = { ...paint(`pal-c-${key(p.ceiling)}`, `Ceiling ${p.ceiling.toUpperCase()}`, p.ceiling), roughness: 0.95 };
  if (opts.walls) s.materials[wm.id] = wm;
  if (feat) s.materials[fm.id] = fm;
  for (const f of faces) {
    const w = s.walls.find((x) => x.id === f.wall.id); if (!w) continue;
    if (feat && f.wall.id === feat.wall.id && f.side === feat.side && f.from === feat.from) setWallSpanMaterial(w, f.side, f.from, f.to, fm.id);
    else if (opts.walls) setWallSpanMaterial(w, f.side, f.from, f.to, wm.id);
  }
  if (opts.ceilingColour) { s.materials[cm.id] = cm; room.ceilingMaterialId = cm.id; }
  if (opts.furniture) for (const o of s.objects) if (o.floorId === room.floorId && objectInRoom(o, room)) recolour(o, p);
}

export function applyRoomStyle(s: Scene, roomId: string, st: RoomStylePreset, opts: { ceiling?: boolean; floor?: boolean; furniture?: boolean } = { ceiling: true, floor: true, furniture: true }) {
  const room = s.rooms.find((r) => r.id === roomId); if (!room) return;
  const faces = roomWallSides(s, room);
  const feat = featureFace(s, room, faces);
  const wm = paint(`style-${st.id}-wall`, `${st.name} wall`, st.walls);
  s.materials[wm.id] = wm;
  let featId: string | null = st.featureMaterial && s.materials[st.featureMaterial] ? st.featureMaterial : null;
  if (!featId && st.featureHex) { const m = paint(`style-${st.id}-feature`, `${st.name} feature`, st.featureHex); s.materials[m.id] = m; featId = m.id; }
  for (const f of faces) {
    const w = s.walls.find((x) => x.id === f.wall.id); if (!w) continue;
    const isFeat = feat && featId && f.wall.id === feat.wall.id && f.side === feat.side && f.from === feat.from;
    setWallSpanMaterial(w, f.side, f.from, f.to, isFeat ? featId! : wm.id);
  }
  // wet areas keep a tile floor
  if (opts.floor !== false) room.floorMaterialId = ['bathroom', 'balcony', 'utility'].includes(room.roomType) ? (st.floor === 'tile-slate' ? 'tile-slate' : 'tile-vitrified') : st.floor;
  if (opts.ceiling !== false && room.roomType !== 'bathroom') room.ceiling = st.ceiling === 'none' ? undefined : { ...defaultCeiling(st.ceiling), lightWarmth: st.warmth };
  room.ceilingMaterialId = 'ceiling-white';
  if (opts.furniture !== false) for (const o of s.objects) if (o.floorId === room.floorId && objectInRoom(o, room)) recolour(o, st);
}
