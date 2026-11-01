/**
 * Design chat — turns plain-language commands into structured, undoable scene edits.
 *
 *   "use #C46A4A for the hall"            → paints the hall's inner wall faces
 *   "marble floor in the kitchen"          → floor material
 *   "place this image in the first bedroom"→ product approximation from the attached photo
 *   "put this image on the living room wall as art"
 *   "add an L-shaped sofa to the hall in #8A9099 with gold accent"
 *   "room 2 is a bedroom", "rename room 3 to Kids Room"
 *   "make the bedroom scandinavian", "evening lighting", "show 3d"
 *
 * Runs entirely in the browser. Geometry (walls, openings, room outlines) is never changed.
 */
import type { Material, Room, RoomType, Scene, SceneObject, Selection } from './types';
import { getAsset } from './catalog';
import type { AssetStyle } from './catalog';
import { polygonArea, fmtArea, setWallSpanMaterial } from './geometry';
import { parseColorInput, rgbToHex, hexToRgb } from './materials';
import { applyChanges, localProvider } from './ai';
import { findSpot, objectInRoom, roomWallSides } from './placement';
import { CEILING_TYPES, defaultCeiling } from './interiors';
import { makeObject, uid } from './templates';

export interface ChatImage {
  dataUrl: string; // processed (background removed when possible), ≤ 768px
  aspect: number; // height / width
  palette: string[];
  bgRemoved: boolean;
  name: string;
}

export interface ChatOutcome {
  reply: string;
  /** Scene edit to apply as ONE undo step. */
  edit?: (s: Scene) => void;
  select?: Selection;
  view?: '2d' | '3d' | 'split' | 'walk';
  camera?: 'perspective' | 'dollhouse' | 'top' | 'front';
  /** Async follow-up (AI style proposals). */
  async?: () => Promise<ChatOutcome>;
  usedImage?: boolean;
  suggestions?: string[];
  /** Destructive/bulk change: ask first; apply `confirm` only if the user answers yes. */
  confirm?: ChatOutcome;
  ok: boolean;
}

// ───────────────────────── vocabulary ─────────────────────────

const ROOM_WORDS: { type: RoomType; re: RegExp; label: string }[] = [
  { type: 'living', re: /\b(hall|living(?: room| area)?|lounge|drawing(?: room)?|family room|sitting room)\b/, label: 'living room / hall' },
  { type: 'bedroom', re: /\b(bed ?rooms?|master(?: bed ?room)?|guest room|kids? room|children'?s room)\b/, label: 'bedroom' },
  { type: 'kitchen', re: /\b(kitchen|pantry)\b/, label: 'kitchen' },
  { type: 'bathroom', re: /\b(bath ?rooms?|toilet|washroom|wash room|restroom|powder room|loo)\b/, label: 'bathroom' },
  { type: 'dining', re: /\b(dining(?: room| area)?)\b/, label: 'dining room' },
  { type: 'office', re: /\b(office|study(?: room)?|work ?room)\b/, label: 'study / office' },
  { type: 'balcony', re: /\b(balcony|balconies|sit ?out|terrace|veranda[h]?)\b/, label: 'balcony' },
  { type: 'pooja', re: /\b(pooja|puja|prayer|mandir)(?: room)?\b/, label: 'pooja room' },
  { type: 'utility', re: /\b(utility|laundry|store ?room|wash area)\b/, label: 'utility' },
  { type: 'hallway', re: /\b(passage|corridor|hallway|lobby|foyer|entrance)\b/, label: 'passage' },
];

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5, last: -1,
};
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export const COLOR_NAMES: Record<string, string> = {
  white: '#f4f1ea', 'off white': '#efe9dd', 'off-white': '#efe9dd', ivory: '#f3ecdc', cream: '#f1e8d6', beige: '#e6d9c4', sand: '#d9c7a7', greige: '#d8cfc2', taupe: '#b3a493',
  grey: '#a9aaa8', gray: '#a9aaa8', charcoal: '#3d3d3f', black: '#232323', silver: '#c0c2c4',
  sage: '#a8b5a0', green: '#7f9c74', olive: '#808055', mint: '#bfe0cf', emerald: '#2f6f55', teal: '#3f7d7a', 'bottle green': '#245a46',
  blue: '#6f8fb3', 'sky blue': '#a9c9e4', 'powder blue': '#b9cfe0', navy: '#2c3a52', indigo: '#3b3f7a', turquoise: '#47a9a3',
  pink: '#e8c4c0', blush: '#e8c4c0', peach: '#f2c6a8', coral: '#e8846b', red: '#b2443a', maroon: '#6b2430', wine: '#5e2132', burgundy: '#6d1f2f',
  terracotta: '#c46a4a', rust: '#b5653f', orange: '#e08a3c', mustard: '#d4a94e', yellow: '#e9d38a', lemon: '#f0e27a', gold: '#b38b4d', golden: '#b38b4d', brass: '#b38b4d',
  brown: '#8b6a47', chocolate: '#4e3426', tan: '#c19a6b', walnut: '#6b4a33', teak: '#9a6b3f',
  lavender: '#c9bfe0', lilac: '#c8a2c8', purple: '#6c4f86', mauve: '#b08e9e', earthy: '#cdb79e', pastel: '#dfe7e1',
};

const MATERIAL_WORDS: [RegExp, string][] = [
  [/\bwhite fluted|fluted white\b/, 'panel-fluted-white'], [/\bfluted\b/, 'panel-fluted-walnut'], [/\b(wood(en)? (slat|panel|panelling)s?|slat panel)\b/, 'panel-wood-slat'],
  [/\b(leaf|botanical|green) wallpaper\b/, 'wallpaper-botanical'], [/\bwall ?paper\b/, 'wallpaper-damask'], [/\b(stone cladding|cladding)\b/, 'stone-cladding'],
  [/\b(exposed )?brick\b/, 'brick-exposed'], [/\b(texture(d)? paint|textured)\b/, 'texture-plaster'],
  [/\bherring ?bone\b/, 'wood-herringbone'], [/\bwalnut\b/, 'wood-walnut'], [/\b(oak|wood|wooden|timber|laminate|parquet)\b/, 'wood-oak'],
  [/\b(italian marble|marble)\b/, 'stone-marble'], [/\bterrazzo\b/, 'stone-terrazzo'], [/\b(granite|slate|kota)\b/, 'tile-slate'],
  [/\b(vitrified|tiles?|ceramic)\b/, 'tile-vitrified'], [/\b(concrete|cement|microcement)\b/, 'concrete'], [/\b(linen|fabric)\b/, 'fabric-linen'],
];

const ITEM_WORDS: [RegExp, string][] = [
  [/\b(tv wall|tv panel|tv back ?panel|media wall)\b/, 'tv-wall'], [/\b(sliding wardrobe|wardrobe with loft|sliding almirah)\b/, 'wardrobe-sliding'],
  [/\b(l[- ]?shaped kitchen|l kitchen|modular kitchen)\b/, 'kitchen-l'], [/\b(parallel kitchen|straight kitchen|kitchen run)\b/, 'kitchen-parallel'],
  [/\b(floating shel(?:f|ves)|wall shel(?:f|ves))\b/, 'floating-shelves'], [/\b(book ?wall|library wall|niches?)\b/, 'book-wall'],
  [/\b(crockery unit|crockery cabinet|bar unit)\b/, 'crockery-unit'], [/\b(study unit|study table with storage)\b/, 'study-unit'],
  [/\b(dressing (table|unit)|dresser)\b/, 'dressing-unit'], [/\b(shoe (rack|cabinet)|foyer console)\b/, 'shoe-cabinet'],
  [/\b(jaali|jali|lattice)( partition| screen)?\b/, 'jaali-partition'], [/\b((fluted )?glass partition|partition)\b/, 'fluted-glass-partition'],
  [/\b(feature (wall )?panel|wall panel)\b/, 'feature-panel'], [/\b(curtains?|drapes)\b/, 'curtains'], [/\b(blinds?|roller blinds?)\b/, 'roller-blind'],
  [/\b(chandelier)\b/, 'chandelier'],
  [/\b(l[- ]?shaped?|sectional|corner) (sofa|couch|sofa set)\b|\bsectional\b/, 'sofa-l'], [/\b(loveseat|2[- ]seater|two[- ]seater)\b/, 'sofa-2'],
  [/\b(sofa set|sofa|couch|3[- ]seater)\b/, 'sofa-3'], [/\b(arm ?chair|accent chair|lounge chair)\b/, 'armchair'],
  [/\b(office chair|task chair|desk chair|study chair)\b/, 'office-chair'], [/\b(bar stools?|stools?)\b/, 'bar-stool'],
  [/\b(king(?: size)? bed)\b/, 'bed-king'], [/\b(queen(?: size)? bed|double bed)\b/, 'bed-queen'], [/\b(single bed|kids? bed|twin bed)\b/, 'bed-single'],
  [/\bbeds?\b/, 'bed-king'], [/\b(bedside(?: tables?)?|night ?stands?)\b/, 'nightstand'], [/\b(wardrobes?|almirahs?|closets?|cupboards?)\b/, 'wardrobe'],
  [/\b(book ?shel(?:f|ves)|book ?cases?|book rack)\b/, 'bookshelf'], [/\b(tv(?: unit| stand| cabinet| console)?|television)\b/, 'tv-unit'],
  [/\b(sideboard|crockery(?: unit)?|console(?: table)?|buffet)\b/, 'sideboard'], [/\b(4[- ]seater dining|small dining table|dining table for 4)\b/, 'dining-4'],
  [/\b(dining tables?|dinning tables?|dining set)\b/, 'dining-6'], [/\b(dining chairs?|chairs?)\b/, 'dining-chair'],
  [/\b(coffee table|centre table|center table|tea table)\b/, 'coffee-table'], [/\b(round (?:coffee )?table|ottomans?|pouf(?:fe)?s?)\b/, 'round-coffee'],
  [/\b(side tables?|end tables?)\b/, 'side-table'], [/\b(desk|study table|work ?table|computer table)\b/, 'desk'],
  [/\b(kitchen island|island)\b/, 'island'], [/\b(wall cabinets?|upper cabinets?|loft)\b/, 'kitchen-wall'],
  [/\b(modular kitchen|kitchen counter|kitchen cabinets?|counter ?top|base cabinets?)\b/, 'kitchen-base'], [/\b(fridge|refrigerator)\b/, 'fridge'],
  [/\b(vanity|wash ?basin|sink|basin)\b/, 'vanity'], [/\b(toilet seat|commode|wc|western toilet)\b/, 'wc'], [/\b(shower(?: enclosure| cubicle)?)\b/, 'shower'],
  [/\b(bath ?tub|tub)\b/, 'bathtub'], [/\b(floor lamp|lamp)\b/, 'floor-lamp'], [/\b(pendant(?: light)?|chandelier|hanging light)\b/, 'pendant'],
  [/\b(rug|carpet|dhurrie)\b/, 'rug'], [/\b(plants?|planter|pot)\b/, 'plant'], [/\b(mirror)\b/, 'mirror'],
  [/\b(painting|wall art|frame|poster|artwork)\b/, 'art'], [/\b(pooja unit|puja unit|mandir|temple)\b/, 'pooja-unit'], [/\btables?\b/, 'coffee-table'],
];

/** Items that belong against a wall, facing into the room. */
const WALL_ITEMS = new Set(['tv-wall', 'wardrobe-sliding', 'kitchen-l', 'kitchen-parallel', 'floating-shelves', 'book-wall', 'crockery-unit', 'study-unit', 'dressing-unit', 'shoe-cabinet', 'feature-panel', 'curtains', 'roller-blind', 'sofa-3', 'sofa-2', 'sofa-l', 'bed-king', 'bed-queen', 'bed-single', 'wardrobe', 'bookshelf', 'tv-unit', 'sideboard', 'kitchen-base', 'kitchen-wall', 'vanity', 'wc', 'desk', 'pooja-unit', 'art', 'mirror', 'fridge']);

const STYLE_WORDS: [RegExp, AssetStyle][] = [
  [/\bscandi(navian)?\b/, 'scandinavian'], [/\bindustrial\b/, 'industrial'], [/\b(indian|traditional indian|ethnic)\b/, 'indian-contemporary'],
  [/\bminimal(ist)?\b/, 'minimal'], [/\bboho|bohemian\b/, 'boho'], [/\b(luxury|luxurious|premium|royal)\b/, 'luxury'], [/\b(classic|vintage|traditional)\b/, 'classic'], [/\b(modern|contemporary)\b/, 'modern'],
];

const PRODUCT_DIMS: [RegExp, { w: number; d: number; h: number }, string][] = [
  [/\b(l[- ]?shaped?|sectional|corner)\b/, { w: 2.7, d: 1.8, h: 0.85 }, 'L-shaped sofa'], [/\b(sofa|couch)\b/, { w: 2.1, d: 0.9, h: 0.85 }, 'Sofa'],
  [/\bking\b/, { w: 1.95, d: 2.15, h: 1.0 }, 'King bed'], [/\b(bed|cot)\b/, { w: 1.65, d: 2.1, h: 1.0 }, 'Bed'], [/\b(wardrobe|almirah|cupboard)\b/, { w: 1.8, d: 0.6, h: 2.1 }, 'Wardrobe'],
  [/\b(dining table)\b/, { w: 1.6, d: 0.9, h: 0.75 }, 'Dining table'], [/\b(coffee table|centre table|center table)\b/, { w: 1.1, d: 0.6, h: 0.42 }, 'Coffee table'],
  [/\b(chair|armchair)\b/, { w: 0.8, d: 0.8, h: 0.9 }, 'Chair'], [/\b(tv|television)\b/, { w: 1.8, d: 0.42, h: 0.5 }, 'TV unit'], [/\b(lamp)\b/, { w: 0.4, d: 0.4, h: 1.6 }, 'Lamp'],
  [/\b(shelf|bookcase|bookshelf)\b/, { w: 1.0, d: 0.35, h: 1.9 }, 'Shelf'], [/\b(rug|carpet)\b/, { w: 2.4, d: 1.6, h: 0.015 }, 'Rug'],
];

// ───────────────────────── helpers ─────────────────────────

/** Most useful tone in a photo palette: skip near-white paper/walls and near-black shadows. */
const pickTone = (pal: string[]) => pal.find((h) => { const { r, g, b } = hexToRgb(h); const l = (r + g + b) / 3; return l > 35 && l < 225; }) ?? pal[0] ?? '#999999';

const lighten = (hex: string, k: number) => {
  const { r, g, b } = hexToRgb(hex);
  return k >= 0 ? rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgbToHex(r * (1 + k), g * (1 + k), b * (1 + k));
};

export function findColor(text: string, exclude?: RegExp): { hex: string; label: string } | null {
  const t = exclude ? text.replace(exclude, ' ') : text;
  const hex = t.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i)?.[0];
  if (hex) {
    const full = hex.length === 4 ? '#' + hex.slice(1).split('').map((c) => c + c).join('') : hex;
    return { hex: parseColorInput(full)!, label: full.toUpperCase() };
  }
  const bare = t.match(/(?:colou?r(?: code)?|code|hex)\s*[:=]?\s*([0-9a-f]{6})\b/i)?.[1];
  if (bare) return { hex: '#' + bare.toLowerCase(), label: '#' + bare.toUpperCase() };
  const rgb = t.match(/rgb\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)/i)?.[0];
  if (rgb) return { hex: parseColorInput(rgb)!, label: rgb };
  const names = Object.keys(COLOR_NAMES).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const m = t.match(new RegExp(`\\b(light|pale|soft|dark|deep)?\\s*${n.replace(/[-]/g, '[- ]')}\\b`));
    if (m) {
      let h = COLOR_NAMES[n];
      if (m[1] === 'light' || m[1] === 'pale' || m[1] === 'soft') h = lighten(h, 0.35);
      if (m[1] === 'dark' || m[1] === 'deep') h = lighten(h, -0.35);
      return { hex: h, label: `${m[1] ? m[1] + ' ' : ''}${n}` };
    }
  }
  return null;
}

function findMaterial(text: string): string | null {
  for (const [re, id] of MATERIAL_WORDS) if (re.test(text)) return id;
  return null;
}

function findItem(text: string): { assetId: string; count: number; span: string } | null {
  for (const [re, id] of ITEM_WORDS) {
    const m = text.match(re);
    if (m) {
      const before = text.slice(0, m.index).trim().split(/\s+/).pop() ?? '';
      const count = /^\d+$/.test(before) ? Math.min(12, +before) : NUM_WORDS[before] ?? (/s\b/.test(m[0]) && !/(glass|ss)$/.test(m[0]) ? 2 : 1);
      return { assetId: id, count: Math.max(1, count), span: m[0] };
    }
  }
  return null;
}

function parseDims(text: string): { w: number; d: number; h?: number } | null {
  const toM = (v: number, u?: string) => {
    if (u === 'cm') return v / 100; if (u === 'mm') return v / 1000; if (u === 'ft' || u === 'feet' || u === "'") return v / 3.28084; if (u === 'in' || u === 'inch' || u === 'inches') return v * 0.0254;
    return v > 15 ? v / 100 : v; // bare numbers > 15 are almost certainly centimetres
  };
  const m = text.match(/(\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet|in|inch)?\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet|in|inch)?(?:\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet|in|inch)?)?/);
  if (m) {
    const u = m[6] ?? m[4] ?? m[2];
    return { w: toM(+m[1], m[2] ?? u), d: toM(+m[3], m[4] ?? u), h: m[5] ? toM(+m[5], m[6] ?? u) : undefined };
  }
  const wide = text.match(/(\d+(?:\.\d+)?)\s*(m|cm|ft|feet)\s*(?:wide|width|long|length)/);
  if (wide) return { w: toM(+wide[1], wide[2]), d: 0 };
  return null;
}

interface RoomHit { room: Room | null; span: string; error?: string; candidates?: Room[] }

/** Resolve "the hall", "first bedroom", "bedroom 2", "room 3", "master bedroom", "this room". */
export function findRoom(text: string, scene: Scene, selection: Selection, floorId: string): RoomHit {
  const rooms = [...scene.rooms].sort((a, b) => (a.floorId === floorId ? 0 : 1) - (b.floorId === floorId ? 0 : 1));
  if (/\b(this|selected|current) room\b/.test(text)) {
    const r = selection?.kind === 'room' ? scene.rooms.find((x) => x.id === selection.id) : null;
    return r ? { room: r, span: 'this room' } : { room: null, span: '', error: 'Select a room first (click it in the plan), or name it, e.g. "the hall".' };
  }
  // exact room names, longest first ("master bedroom" before "bedroom")
  for (const r of [...rooms].sort((a, b) => b.name.length - a.name.length)) {
    const n = r.name.toLowerCase().trim();
    if (n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) return { room: r, span: n };
  }
  // "room 3"
  const rn = text.match(/\broom\s*(?:no\.?|number|#)?\s*(\d+)\b/);
  if (rn) {
    const r = rooms[+rn[1] - 1];
    return r ? { room: r, span: rn[0] } : { room: null, span: rn[0], error: `There is no room ${rn[1]} — this project has ${rooms.length} rooms.` };
  }
  for (const w of ROOM_WORDS) {
    const m = text.match(w.re);
    if (!m) continue;
    const ofType = rooms.filter((r) => r.roomType === w.type || w.re.test(r.name.toLowerCase()));
    // ordinal before ("first bedroom") or number after ("bedroom 2")
    const before = text.slice(0, m.index).trim().split(/\s+/).pop() ?? '';
    const after = text.slice((m.index ?? 0) + m[0].length).match(/^\s*(\d+)\b/);
    let n = ORDINALS[before] ?? (after ? +after[1] : 0);
    const span = `${ORDINALS[before] ? before + ' ' : ''}${m[0]}${after ? after[0] : ''}`;
    if (/master/.test(m[0])) {
      const master = ofType.find((r) => /master/i.test(r.name)) ?? [...ofType].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
      if (master) return { room: master, span };
    }
    if (ofType.length === 0) {
      return { room: null, span, error: `I can't find a ${w.label} yet. Your rooms are: ${rooms.map((r, i) => `${i + 1}. ${r.name}`).join(', ')}. Tell me which one it is, e.g. "room ${rooms.length > 1 ? 2 : 1} is a ${w.type === 'living' ? 'hall' : w.label.split(' /')[0]}".` };
    }
    if (n === -1) n = ofType.length;
    if (n > 0) return ofType[n - 1] ? { room: ofType[n - 1], span } : { room: null, span, error: `There are only ${ofType.length} ${w.label}s: ${ofType.map((r) => r.name).join(', ')}.` };
    if (ofType.length > 1 && !/\b(all|every|both)\b/.test(text)) {
      return { room: null, span, candidates: ofType, error: `You have ${ofType.length} ${w.label}s — ${ofType.map((r) => r.name).join(', ')}. Which one? (e.g. "first ${m[0]}" or "${ofType[0].name}")` };
    }
    return { room: ofType[0], span };
  }
  return { room: null, span: '' };
}

/** Place an item safely inside the room (whole footprint inside, clear of furniture and door swings). */
function placeInRoom(scene: Scene, room: Room, item: { dims: { w: number; d: number; h: number }; assetId?: string; elevation?: number }, againstWall: boolean, placed: SceneObject[]) {
  const others = [...scene.objects, ...placed];
  return findSpot(scene, room, item, { kind: againstWall ? 'wall' : 'center', others })
    ?? (againstWall ? findSpot(scene, room, item, { kind: 'center', others }) : null);
}

const roomList = (scene: Scene) => scene.rooms.map((r, i) => `${i + 1}. ${r.name} (${r.roomType})`).join('\n');

export const HELP = [
  'use #C46A4A for the hall',
  'paint the first bedroom sage green',
  'marble floor in the kitchen',
  'place this image in the master bedroom',
  'put this image on the hall wall as art',
  'add an L-shaped sofa to the hall in #8A9099 with gold accent',
  'room 2 is a bedroom',
  'make the bedroom scandinavian',
  'use the colours from this image for the hall',
  'evening lighting',
];

function help(scene: Scene): ChatOutcome {
  return {
    ok: true,
    reply: `Here's what I can do — name a room the way you'd say it ("hall", "first bedroom", "room 3", "master bedroom"):\n\n• Colours: HEX (#C46A4A), rgb(…), or names like sage, navy, light grey\n• Walls, floor or ceiling of a room, or a single item ("make the sofa navy")\n• Materials: oak, walnut, herringbone, marble, granite, terrazzo, tiles, concrete\n• Attach an image → place it as a product, hang it as wall art, or use its colours\n• Add furniture: sofa, L-shaped sofa, king bed, wardrobe, TV unit, dining table, 4 chairs…\n• Rooms: "room 2 is a bedroom", "rename room 3 to Kids Room", "list rooms"\n• Style: "make the hall luxury" · Light: "evening lighting" · View: "show 3d", "walkthrough"\n\nEvery change is one undo step.${scene.rooms.length ? `\n\nYour rooms:\n${roomList(scene)}` : ''}`,
    suggestions: HELP.slice(0, 4),
  };
}

// ───────────────────────── main entry ─────────────────────────

export function runCommand(
  raw: string,
  ctx: { scene: Scene; selection: Selection; floorId: string; image?: ChatImage | null; units: 'm' | 'ft' },
): ChatOutcome {
  const text = ' ' + raw.toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim() + ' ';
  const { scene, image } = ctx;
  const t = text.trim();

  if (!t && image) return { ok: true, reply: `Got the image${image.bgRemoved ? ' (background removed)' : ''}. What should I do with it?`, suggestions: ['place this image in the hall', 'put this image on the hall wall as art', 'use the colours from this image for the hall'] };
  if (/^(help|\?|hi|hello|hey|what can you do|commands)\b/.test(t)) return help(scene);
  if (/\b(list|show|what are)( the| my)? rooms\b|^rooms$/.test(t)) {
    return { ok: true, reply: scene.rooms.length ? `Rooms in this project:\n${scene.rooms.map((r, i) => `${i + 1}. ${r.name} — ${r.roomType}, ${fmtArea(polygonArea(r.polygon), ctx.units)}`).join('\n')}` : 'There are no rooms yet. Draw one with the Room tool (R) or import a blueprint.' };
  }

  // ── views & lighting (no room needed)
  if (/\b(walk ?through|walk mode|first person)\b/.test(t)) return { ok: true, reply: 'Switched to walkthrough — click the 3D view, then use W A S D.', view: 'walk' };
  if (/\b(show|switch to|open)\b.*\b(3d|3 d)\b/.test(t)) return { ok: true, reply: 'Showing the 3D view.', view: '3d' };
  if (/\b(show|switch to|open)\b.*\b(2d|plan)\b/.test(t)) return { ok: true, reply: 'Showing the 2D plan.', view: '2d' };
  if (/\b(top view|from above|bird'?s eye)\b/.test(t)) return { ok: true, reply: 'Top view.', camera: 'top', view: '3d' };
  if (/\bdoll ?house\b/.test(t)) return { ok: true, reply: 'Dollhouse view.', camera: 'dollhouse', view: '3d' };
  const light = t.match(/\b(morning|noon|afternoon|golden hour|sunset|evening|night)\b(?=.*\blight)|\b(warmer|cooler|brighter|darker) (?:lights?|lighting)\b/);
  if (light && !/\b(paint|colou?r|floor|wall)\b/.test(t)) {
    const presets: Record<string, Partial<Scene['lighting']>> = {
      morning: { sunAzimuth: 90, sunElevation: 25, sunIntensity: 2.0, warmth: 0.6, ambient: 0.5 }, noon: { sunAzimuth: 180, sunElevation: 70, sunIntensity: 2.6, warmth: 0.35, ambient: 0.6 },
      afternoon: { sunAzimuth: 220, sunElevation: 45, sunIntensity: 2.3, warmth: 0.5 }, 'golden hour': { sunAzimuth: 260, sunElevation: 12, sunIntensity: 1.8, warmth: 0.9, ambient: 0.4 },
      sunset: { sunAzimuth: 270, sunElevation: 6, sunIntensity: 1.2, warmth: 0.95, ambient: 0.35 }, evening: { sunAzimuth: 280, sunElevation: 4, sunIntensity: 0.4, warmth: 0.8, ambient: 0.25, roomLights: true },
      night: { sunElevation: 2, sunIntensity: 0.05, ambient: 0.15, warmth: 0.85, roomLights: true },
    };
    const key = light[1] ?? light[2];
    return {
      ok: true, reply: `Lighting set to ${key}.`,
      edit: (s) => {
        if (presets[key]) s.lighting = { ...s.lighting, ...presets[key] };
        else if (key === 'warmer') s.lighting.warmth = Math.min(1, s.lighting.warmth + 0.2);
        else if (key === 'cooler') s.lighting.warmth = Math.max(0, s.lighting.warmth - 0.2);
        else if (key === 'brighter') { s.lighting.sunIntensity = Math.min(5, s.lighting.sunIntensity + 0.6); s.lighting.ambient = Math.min(1.5, s.lighting.ambient + 0.15); }
        else { s.lighting.sunIntensity = Math.max(0, s.lighting.sunIntensity - 0.6); s.lighting.ambient = Math.max(0, s.lighting.ambient - 0.15); }
      },
    };
  }

  // ── room naming: "room 2 is a bedroom", "rename room 3 to kids room", "call the hall living room"
  const ren = t.match(/^(?:rename|call|name)\s+(.+?)\s+(?:to|as)\s+(.+)$/);
  const isA = t.match(/^(.+?)\s+(?:is|=|should be)\s+(?:a|an|the|my)?\s*(.+)$/);
  if (ren || (isA && /\broom\b|\d/.test(isA[1]) && !findColor(isA[2]) && !findMaterial(isA[2]))) {
    const target = (ren ? ren[1] : isA![1]).trim();
    const newName = (ren ? ren[2] : isA![2]).trim().replace(/[.!]$/, '');
    const hit = findRoom(' ' + target + ' ', scene, ctx.selection, ctx.floorId);
    if (!hit.room) return { ok: false, reply: hit.error ?? `I couldn't tell which room "${target}" is.\n${roomList(scene)}` };
    const type = ROOM_WORDS.find((w) => w.re.test(' ' + newName + ' '))?.type;
    const pretty = newName.replace(/\b\w/g, (c) => c.toUpperCase());
    const id = hit.room.id, old = hit.room.name;
    const generic = /^room \d+$/i.test(old);
    return {
      ok: true,
      reply: `${old} → ${ren || generic || !type ? `renamed “${pretty}”` : `kept the name`}${type ? `, type set to ${type}` : ''}.`,
      edit: (s) => { const r = s.rooms.find((x) => x.id === id)!; if (type) r.roomType = type; if (ren || generic || !type) r.name = pretty; },
      select: { kind: 'room', id },
    };
  }

  // ── resolve the room the command is about
  const hit = findRoom(text, scene, ctx.selection, ctx.floorId);
  // A room was named but could not be resolved (unknown, ambiguous, missing): stop here.
  // Never fall back to "all rooms" — that turned "clear furniture in room 99" into a project-wide delete.
  if (hit.error) return { ok: false, reply: hit.error, suggestions: hit.candidates?.slice(0, 3).map((r) => raw.trim().replace(new RegExp(hit.span.trim(), 'i'), r.name.toLowerCase())) };
  const rest = hit.span ? text.replace(hit.span, ' ') : text;
  const wantsImage = !!image && (/\b(this|the|that|my|attached|uploaded)\s+(image|photo|pic|picture|design|product|one|sofa|bed|item)\b|\b(it|this)\b/.test(t) || !findItem(rest));
  const room = hit.room;
  const needRoom = (): ChatOutcome => ({ ok: false, reply: hit.error ?? `Which room? Say e.g. "the hall", "first bedroom" or "room 2".${scene.rooms.length ? `\n${roomList(scene)}` : ''}`, suggestions: scene.rooms.slice(0, 3).map((r) => `${raw.trim()} in ${r.name}`) });

  // ── false ceiling: "add cove false ceiling to the hall", "remove false ceiling from kitchen"
  if (/\b(false ceiling|pop ceiling|gypsum ceiling|ceiling design|cove( light(ing)?)?|tray ceiling|layered ceiling|circular ceiling|wooden ceiling|slat ceiling)\b/.test(t)) {
    if (!room) return needRoom();
    const id = room.id;
    if (/\b(remove|delete|no|without|clear)\b/.test(t)) return { ok: true, reply: `Removed the false ceiling from ${room.name}.`, edit: (s) => { const r = s.rooms.find((x) => x.id === id); if (r) r.ceiling = undefined; }, select: { kind: 'room', id } };
    const type = /\blayer|2[- ]step|double\b/.test(t) ? 'layered' : /\bcircular|round|circle\b/.test(t) ? 'circular' : /\bwood|slat\b/.test(t) ? 'wooden-slats' : /\bborder|simple|plain|spot/.test(t) && !/\bcove\b/.test(t) ? 'border' : 'cove-tray';
    const ct = CEILING_TYPES.find((c) => c.type === type)!;
    const design = defaultCeiling(type);
    if (/\bcool|white light\b/.test(t)) design.lightWarmth = 0.15;
    if (/\bwarm\b/.test(t)) design.lightWarmth = 0.85;
    const area = polygonArea(room.polygon) * 10.7639;
    const fl = scene.floors.find((f) => f.id === room.floorId);
    const low = fl && fl.ceilingHeight < 2.85 && type !== 'border';
    return {
      ok: true,
      reply: `Added a ${ct.label.toLowerCase()} false ceiling to ${room.name} (about ${Math.round(area)} sq ft × ~₹${ct.ratePerSqft}/sq ft ≈ ₹${Math.round(area * ct.ratePerSqft).toLocaleString('en-IN')}, indicative).${low ? ' Note: this room is under 9.5 ft high — a slim border ceiling keeps more headroom.' : ''} Turn on “Ceilings” in the 3D view or walk inside to see it.`,
      edit: (s) => { const r = s.rooms.find((x) => x.id === id); if (r) r.ceiling = design; },
      select: { kind: 'room', id },
    };
  }

  // ── style: "make the hall luxury"
  const style = STYLE_WORDS.find(([re]) => re.test(rest))?.[1];
  if (style && /\b(make|style|design|decorate|theme|turn|look|redo|give)\b/.test(t) && !findItem(rest)) {
    if (!room) return needRoom();
    const r = room;
    return {
      ok: true, reply: `Designing ${r.name} in a ${style.replace('-', ' ')} style…`,
      async: async () => {
        const prop = await localProvider.propose(scene, { roomId: r.id, style, prompt: raw, replaceFurniture: /\b(replace|redo|from scratch|new furniture)\b/.test(t) });
        return {
          ok: true,
          reply: `${prop.summary}: ${prop.changes.map((c) => c.label).join(' · ')}.\nIndicative furniture cost: ${prop.estimatedCost.toLocaleString('en-IN')}. Geometry unchanged.`,
          edit: (s) => applyChanges(s, prop.changes),
          select: { kind: 'room', id: r.id },
        };
      },
    };
  }

  // ── image actions
  if (image && wantsImage) {
    // palette
    if (/\bcolou?rs?\b|\bpalette\b|\bshades?\b|\bmatch\b/.test(t) && !/\b(place|put|add|hang|keep)\b/.test(t)) {
      const surf = /\bfloor/.test(rest) ? 'floor' : /\bceiling/.test(rest) ? 'ceiling' : findItem(rest) ? 'item' : 'walls';
      const hex = image.palette.find((h) => { const { r, g, b } = hexToRgb(h); return Math.max(r, g, b) - Math.min(r, g, b) > 12 || (r + g + b) / 3 < 235; }) ?? image.palette[0];
      if (!hex) return { ok: false, reply: 'I could not read colours from that image.' };
      if (surf === 'item') {
        const it = findItem(rest)!;
        const targets = scene.objects.filter((o) => o.assetId === it.assetId && (!room || o.floorId === room.floorId));
        if (!targets.length) return { ok: false, reply: `There's no ${it.span} to recolour${room ? ` in ${room.name}` : ''}.` };
        return { ok: true, usedImage: true, reply: `Recoloured ${targets.length} ${it.span} to ${hex.toUpperCase()} (sampled from the image). Palette: ${image.palette.slice(0, 5).join(' ')}`, edit: (s) => s.objects.forEach((o) => { if (targets.some((x) => x.id === o.id)) { o.colorHex = hex; o.materialId = undefined; } }) };
      }
      if (!room) return needRoom();
      return { ...paintRoom(scene, room, surf, { hex, label: `${hex.toUpperCase()} from your image` }, null), usedImage: true, reply: `Painted ${room.name} ${surf} ${hex.toUpperCase()} (sampled from the image). Other colours in it: ${image.palette.slice(1, 5).join(' ')} — say e.g. "use ${image.palette[1] ?? '#…'} for the ceiling".` };
    }
    if (!room) return needRoom();
    const asArt = /\b(art|wall art|painting|frame|poster|hang|on the wall|on a wall|wall)\b/.test(rest) && !/\b(sofa|bed|wardrobe|table|chair)\b/.test(rest);
    const dimsIn = parseDims(rest);
    if (asArt) {
      const w = Math.min(2.4, Math.max(0.3, dimsIn?.w || (image.aspect > 1.2 ? 0.7 : 1.0)));
      const h = +(w * image.aspect).toFixed(2);
      // wall art hangs above furniture, so only walls/doors matter
      const spot = findSpot(scene, room, { dims: { w, d: 0.04, h }, assetId: 'art', elevation: 1.2 }, { kind: 'wall', others: [] });
      if (!spot) return { ok: false, reply: `${room.name} has no free wall wide enough to hang it on.` };
      const o: SceneObject = { ...makeObject('art', room.floorId, spot.x, spot.y, spot.rotation, 'manual'), name: `Art · ${image.name}`.slice(0, 40), dims: { w, h, d: 0.04 }, elevation: +Math.max(0.9, 1.55 - h / 2).toFixed(2), imageDataUrl: image.dataUrl, price: 0, estimated: false, colorHex: '#1f1f1f' };
      return { ok: true, usedImage: true, reply: `Hung the image on the longest free wall of ${room.name} (${w.toFixed(2)} × ${h.toFixed(2)} m, centre at eye level). Drag it in the plan or set its size in Properties.`, edit: (s) => { s.objects.push(o); }, select: { kind: 'object', id: o.id }, view: 'split' };
    }
    const pd = PRODUCT_DIMS.find(([re]) => re.test(rest) || re.test(image.name.toLowerCase()));
    const base = pd?.[1] ?? { w: 1.0, d: 0.6, h: 0.9 };
    const dims = { w: dimsIn?.w || base.w, d: dimsIn?.d || base.d, h: dimsIn?.h || base.h };
    const against = !!pd && !/table|lamp|rug|chair/.test(pd[2].toLowerCase());
    const spot = placeInRoom(scene, room, { dims, assetId: 'box' }, against, []);
    if (!spot) return { ok: false, reply: `There's no free spot in ${room.name} for a ${dims.w}×${dims.d} m item. Try a smaller size, e.g. "place this image in ${room.name.toLowerCase()} 120 x 60 cm", or make room first.` };
    const o: SceneObject = {
      ...makeObject('box', room.floorId, spot.x, spot.y, spot.rotation, 'manual'),
      name: (pd?.[2] ?? 'Product') + ' (from photo)', dims, imageDataUrl: image.dataUrl, estimated: true, price: 0, colorHex: pickTone(image.palette),
    };
    const tips: string[] = [];
    if (!dimsIn) tips.push(pd ? `I used typical ${pd[2].toLowerCase()} dimensions (${dims.w}×${dims.d}×${dims.h} m) — tell me the real size, e.g. "make it 240 x 160 x 85 cm".` : `What is it, and how big? e.g. "it's an L-shaped sofa, 270 x 180 x 85 cm".`);
    if (!image.bgRemoved) tips.push('The photo has a busy background, so it shows as a picture on a block.');
    const cat = pd && ITEM_WORDS.find(([re]) => re.test(pd[2].toLowerCase()))?.[1];
    if (cat) tips.push(`For a real 3D shape try: "add ${getAsset(cat)!.name.toLowerCase()} to ${room.name.toLowerCase()} in ${pickTone(image.palette).toUpperCase()}".`);
    return { ok: true, usedImage: true, reply: `Placed your image in ${room.name} as a ${dims.w}×${dims.d} m approximation (marked “estimated”). ${tips.join(' ')}`, edit: (s) => { s.objects.push(o); }, select: { kind: 'object', id: o.id }, view: 'split' };
  }

  // ── describe the selected photo item: "it's an L-shaped sofa, 270 x 180 x 85 cm"
  if (/^(it'?s|it is|this is|that is|that'?s)\b/.test(t) && ctx.selection?.kind === 'object') {
    const id = ctx.selection.id;
    const o = scene.objects.find((x) => x.id === id);
    const pd = PRODUCT_DIMS.find(([re]) => re.test(t));
    const dd = parseDims(t);
    if (o && (pd || dd)) {
      const dims = { w: dd?.w || pd?.[1].w || o.dims.w, d: dd?.d || pd?.[1].d || o.dims.d, h: dd?.h || pd?.[1].h || o.dims.h };
      return {
        ok: true,
        reply: `Updated: ${pd ? pd[2] + ', ' : ''}${dims.w.toFixed(2)} × ${dims.d.toFixed(2)} × ${dims.h.toFixed(2)} m.${o.imageDataUrl && pd ? ` Tip: "add ${pd[2].toLowerCase()} to this room in ${o.colorHex.toUpperCase()}" gives a real 3D shape.` : ''}`,
        edit: (s) => { const x = s.objects.find((q) => q.id === id); if (x) { x.dims = dims; if (pd && x.imageDataUrl) x.name = `${pd[2]} (from photo)`; } },
      };
    }
  }

  // ── resize the selected item: "make it 240 x 160 cm"
  const dimsCmd = parseDims(t);
  if (dimsCmd && /\b(make|resize|set|size|change)\b/.test(t) && /\b(it|this|that|size|selected)\b/.test(t) && ctx.selection?.kind === 'object') {
    const id = ctx.selection.id;
    return { ok: true, reply: `Resized to ${dimsCmd.w.toFixed(2)} × ${(dimsCmd.d || 0).toFixed(2)}${dimsCmd.h ? ` × ${dimsCmd.h.toFixed(2)}` : ''} m.`, edit: (s) => { const o = s.objects.find((x) => x.id === id); if (o) { o.dims.w = dimsCmd.w; if (dimsCmd.d) o.dims.d = dimsCmd.d; if (dimsCmd.h) o.dims.h = dimsCmd.h; } } };
  }

  // ── remove furniture
  if (/\b(remove|delete|clear|take out|get rid of)\b/.test(t)) {
    const it = findItem(rest);
    const all = /\b(all|every|everything|furniture)\b/.test(rest);
    if (!it && !all) return { ok: false, reply: 'What should I remove? e.g. "remove the rug from the hall" or "clear all furniture in bedroom 2".' };
    // Scope must be explicit: a room, or the words "whole house / entire project / everywhere".
    const wholeProject = /\b(whole (house|home|project|floor plan)|entire (house|home|project)|everywhere|all rooms|every room)\b/.test(t);
    if (!room && !wholeProject) return { ok: false, reply: `Which room should I remove ${it ? 'the ' + it.span : 'furniture'} from? Name a room (e.g. "from the hall"), or say "from the whole house" to include every room.`, suggestions: scene.rooms.slice(0, 3).map((r) => `remove ${it ? 'the ' + it.span : 'all furniture'} from ${r.name.toLowerCase()}`) };
    const inScope = (o: SceneObject) => (room ? o.floorId === room.floorId && objectInRoom(o, room) : true);
    const victims = scene.objects.filter((o) => inScope(o) && (all && !it ? true : o.assetId === it!.assetId));
    if (!victims.length) return { ok: false, reply: `Nothing to remove${room ? ` in ${room.name}` : ''}.` };
    const ids = new Set(victims.map((v) => v.id));
    const where = room ? room.name : 'the whole project';
    const rooms = [...new Set(victims.map((v) => scene.rooms.find((r) => r.floorId === v.floorId && objectInRoom(v, r))?.name ?? 'outside rooms'))];
    const done: ChatOutcome = { ok: true, reply: `Removed ${victims.length} item(s) from ${where}.`, edit: (s) => { s.objects = s.objects.filter((o) => !ids.has(o.id)); } };
    if (victims.length === 1) return done;
    return { ok: true, reply: `This will remove ${victims.length} items (${[...new Set(victims.map((v) => v.name))].slice(0, 6).join(', ')}${victims.length > 6 ? '…' : ''}) from ${rooms.join(', ')}. Reply "yes" to confirm or "no" to cancel.`, confirm: done, suggestions: ['yes', 'no'] };
  }

  // ── add catalog furniture
  const item = findItem(rest);
  const color = findColor(rest, /\b(with |and )?(gold|golden|brass|silver|black)? ?(accents?|trim|legs|handles)\b.*$/);
  const accent = rest.match(/\b(?:with |and )?(gold|golden|brass|silver|black|white|#[0-9a-f]{6})\s*(?:accents?|trim|legs|handles|details)\b|\baccents?\s*(#[0-9a-f]{6}|\w+)/);
  if (item && /\b(add|place|put|insert|keep|need|want|include|bring)\b/.test(t)) {
    if (!room) return needRoom();
    const a = getAsset(item.assetId)!;
    const objs: SceneObject[] = [];
    let missing = 0;
    for (let k = 0; k < item.count; k++) {
      const spot = placeInRoom(scene, room, { dims: a.dims, assetId: a.id, elevation: a.elevation }, WALL_ITEMS.has(a.id), objs);
      if (!spot) { missing++; continue; }
      const o = makeObject(a.id, room.floorId, spot.x, spot.y, spot.rotation, 'manual');
      if (color && !/\b(floor|wall|ceiling)\b/.test(rest)) { o.colorHex = color.hex; }
      const acc = accent?.[1] ?? accent?.[2];
      if (acc) o.accentHex = findColor(acc)?.hex ?? o.accentHex;
      objs.push(o);
    }
    if (!objs.length) return { ok: false, reply: `There's no free spot in ${room.name} for a ${a.name} (${a.dims.w}×${a.dims.d} m) — the room is too small or doors and furniture are in the way. Remove or move something first.` };
    return {
      ok: true,
      reply: `Added ${objs.length > 1 ? objs.length + ' × ' : ''}${a.name} to ${room.name}${missing ? ` (${missing} more didn't fit)` : ''}${color ? ` in ${color.label}` : ''}${accent ? ` with ${accent[1] ?? accent[2]} accents` : ''}${WALL_ITEMS.has(a.id) ? ', against the longest free wall' : ''}. Drag it in the plan or use Move/Rotate in 3D to fine-tune.`,
      edit: (s) => { s.objects.push(...objs); },
      select: { kind: 'object', id: objs[0].id },
    };
  }

  // ── recolour existing items: "make the sofa navy"
  if (item && (color || findMaterial(rest))) {
    const mat = findMaterial(rest);
    const targets = scene.objects.filter((o) => o.assetId === item.assetId && (!room || (o.floorId === room.floorId && objectInRoom(o, room))));
    if (!targets.length) return { ok: false, reply: `There's no ${item.span}${room ? ` in ${room.name}` : ''} yet. Say "add a ${item.span}${room ? ` to ${room.name.toLowerCase()}` : ' to the hall'}" first.` };
    const ids = new Set(targets.map((x) => x.id));
    return {
      ok: true, reply: `Changed ${targets.length} ${item.span} to ${color ? color.label : scene.materials[mat!]?.name}.`,
      edit: (s) => s.objects.forEach((o) => { if (ids.has(o.id)) { if (color) { o.colorHex = color.hex; o.materialId = undefined; } else { o.materialId = mat!; o.colorHex = s.materials[mat!].colorHex; } } }),
      select: { kind: 'object', id: targets[0].id },
    };
  }

  // ── paint / finish a room surface
  const mat = findMaterial(rest);
  const col = color ?? findColor(rest);
  if (col || mat) {
    if (!room) return needRoom();
    const surf = /\bfloor(ing)?\b/.test(rest) ? 'floor' : /\bceiling\b/.test(rest) ? 'ceiling' : mat && !/\bwall/.test(rest) && ['wood-oak', 'wood-walnut', 'wood-herringbone', 'stone-marble', 'stone-terrazzo', 'tile-slate', 'tile-vitrified', 'concrete'].includes(mat) ? 'floor' : 'walls';
    return paintRoom(scene, room, surf, col, mat);
  }

  if (image) return { ok: false, reply: 'Where should this image go? e.g. "place this image in the hall" or "put this image on the bedroom wall as art".', suggestions: scene.rooms.slice(0, 3).map((r) => `place this image in ${r.name.toLowerCase()}`) };
  if (hit.error) return { ok: false, reply: hit.error };
  return { ok: false, reply: `I didn't catch that. Try one of these:`, suggestions: HELP.slice(0, 5) };
}

function paintRoom(scene: Scene, room: Room, surf: 'walls' | 'floor' | 'ceiling', col: { hex: string; label: string } | null, matId: string | null): ChatOutcome {
  let m: Material;
  if (matId && !col) m = scene.materials[matId];
  else if (matId && col) {
    const base = scene.materials[matId];
    m = { ...base, id: `${matId}-${col.hex.slice(1)}`, name: `${base.name} ${col.hex.toUpperCase()}`, colorHex: col.hex };
  } else {
    m = { id: `custom-${col!.hex.slice(1)}-90-0`, name: `Custom ${col!.hex.toUpperCase()}`, kind: 'paint', colorHex: col!.hex, roughness: surf === 'floor' ? 0.5 : 0.9, metalness: 0, pattern: 'none', pricePerM2: surf === 'floor' ? 900 : 40 };
  }
  const id = room.id;
  const sides = surf === 'walls' ? roomWallSides(scene, room) : [];
  if (surf === 'walls' && !sides.length) return { ok: false, reply: `I couldn't find walls around ${room.name}. Check its outline lines up with the walls in the plan.` };
  const what = col ? col.label : m.name;
  return {
    ok: true,
    reply: surf === 'walls'
      ? `Painted the ${sides.length} wall faces inside ${room.name} ${what}${col && !col.label.startsWith('#') ? ` (${col.hex.toUpperCase()})` : ''}. Neighbouring rooms keep their own colour.`
      : `${room.name} ${surf} → ${what}.`,
    edit: (s) => {
      s.materials[m.id] = m;
      const r = s.rooms.find((x) => x.id === id);
      if (!r) return;
      if (surf === 'floor') r.floorMaterialId = m.id;
      else if (surf === 'ceiling') r.ceilingMaterialId = m.id;
      // only this room's stretch of each wall face — neighbours on the same long wall keep their finish
      else for (const sd of sides) { const w = s.walls.find((x) => x.id === sd.wall.id); if (w) setWallSpanMaterial(w, sd.side, sd.from, sd.to, m.id); }
    },
    select: { kind: 'room', id },
  };
}

export const newChatId = uid;
