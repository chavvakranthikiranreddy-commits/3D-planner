/**
 * Modular kitchen & wardrobe planner: unit layouts, indicative costing (₹ per sq ft of front area,
 * the way Indian modular vendors usually quote), a panel cut list and 8×4 ft sheet estimate.
 * Rates are placeholders for comparison only — always take written quotes.
 */
import type { ModUnit, ModUnitType, ModularConfig, SceneObject } from './types';
import { uid } from './templates';

export const MODULAR_ASSETS: Record<string, { kind: ModularConfig['kind']; layout: 'run' | 'l' | 'base' | 'hinged' | 'sliding' }> = {
  'kitchen-parallel': { kind: 'kitchen', layout: 'run' },
  'kitchen-l': { kind: 'kitchen', layout: 'l' },
  'kitchen-base': { kind: 'kitchen', layout: 'base' },
  wardrobe: { kind: 'wardrobe', layout: 'hinged' },
  'wardrobe-sliding': { kind: 'wardrobe', layout: 'sliding' },
};
export const supportsModular = (assetId: string) => !!MODULAR_ASSETS[assetId];

export const UNIT_TYPES: Record<ModularConfig['kind'], { type: ModUnitType; label: string; w: number }[]> = {
  kitchen: [
    { type: 'drawers', label: 'Drawer stack', w: 0.6 }, { type: 'shutter', label: 'Shutter cabinet', w: 0.6 }, { type: 'sink', label: 'Sink unit', w: 0.8 },
    { type: 'hob', label: 'Hob unit + chimney', w: 0.9 }, { type: 'tall', label: 'Tall pantry', w: 0.6 }, { type: 'appliance', label: 'Oven / dishwasher', w: 0.6 },
    { type: 'corner', label: 'Corner (magic corner)', w: 0.9 }, { type: 'open', label: 'Open shelf', w: 0.3 },
  ],
  wardrobe: [
    { type: 'hanging', label: 'Long hanging', w: 0.6 }, { type: 'shelves', label: 'Shelves', w: 0.5 }, { type: 'drawers', label: 'Drawers + shelves', w: 0.6 },
    { type: 'mirror', label: 'Mirror shutter', w: 0.5 }, { type: 'open', label: 'Open display', w: 0.4 },
  ],
};
export const unitLabel = (kind: ModularConfig['kind'], t: ModUnitType) => UNIT_TYPES[kind].find((u) => u.type === t)?.label ?? t;

export const SHUTTERS: Record<ModularConfig['shutter'], { label: string; kitchen: number; wardrobe: number; rough: number; note: string }> = {
  laminate: { label: 'Laminate (matte/suede)', kitchen: 1500, wardrobe: 1350, rough: 0.55, note: 'Most popular, durable, budget friendly' },
  acrylic: { label: 'Acrylic (high gloss)', kitchen: 2100, wardrobe: 1800, rough: 0.1, note: 'Glossy, seamless, shows fingerprints' },
  pu: { label: 'PU paint (duco)', kitchen: 2800, wardrobe: 2500, rough: 0.3, note: 'Any colour, premium finish' },
  veneer: { label: 'Wood veneer', kitchen: 2500, wardrobe: 2200, rough: 0.6, note: 'Natural wood grain, needs polish' },
  glass: { label: 'Profile glass', kitchen: 2400, wardrobe: 2300, rough: 0.05, note: 'Aluminium frame + tinted/fluted glass' },
};
export const CARCASS: Record<ModularConfig['carcass'], { label: string; factor: number; note: string }> = {
  'bwp-ply': { label: 'BWP plywood (IS 710)', factor: 1, note: 'Boiling-water proof — best for sink and kitchen' },
  'mr-ply': { label: 'MR plywood (IS 303)', factor: 0.9, note: 'Moisture resistant — fine for wardrobes' },
  hdhmr: { label: 'HDHMR board', factor: 0.92, note: 'Dense, moisture resistant, smooth' },
  particle: { label: 'Pre-lam particle board', factor: 0.78, note: 'Cheapest, avoid near water' },
};
export const HANDLES: Record<ModularConfig['handle'], { label: string; factor: number }> = {
  profile: { label: 'Aluminium profile', factor: 1.03 }, gola: { label: 'Gola (handle-less groove)', factor: 1.06 },
  knob: { label: 'Knobs', factor: 1 }, bar: { label: 'Bar handles', factor: 1 }, push: { label: 'Push-to-open', factor: 1.02 },
};
export const COUNTERS: Record<NonNullable<ModularConfig['counter']>, { label: string; perRft: number; hex: string }> = {
  granite: { label: 'Granite (black galaxy)', perRft: 1000, hex: '#26262a' },
  quartz: { label: 'Quartz', perRft: 2600, hex: '#ecebe8' },
  marble: { label: 'Marble', perRft: 1600, hex: '#f1efea' },
  'solid-surface': { label: 'Solid surface (Corian-type)', perRft: 3000, hex: '#f4f4f2' },
};
const SQFT = 10.7639;
const FT = 3.28084;

const mk = (type: ModUnitType, width: number, drawers?: number): ModUnit => ({ id: uid(), type, width: +width.toFixed(3), drawers });

/** Fill a run of length L with sensible units. */
export function defaultUnits(kind: ModularConfig['kind'], L: number, leg2 = false): ModUnit[] {
  const out: ModUnit[] = [];
  if (kind === 'kitchen') {
    const plan: [ModUnitType, number][] = leg2 ? [['corner', 0.9], ['drawers', 0.6], ['shutter', 0.6], ['tall', 0.6]] : [['tall', 0.6], ['drawers', 0.6], ['hob', 0.9], ['drawers', 0.45], ['sink', 0.8], ['shutter', 0.6]];
    let left = L;
    for (const [t, w] of plan) { if (left < w - 0.01) continue; out.push(mk(t, w, t === 'drawers' ? 3 : t === 'hob' ? 2 : undefined)); left -= w; }
    while (left >= 0.3) { const w = Math.min(0.6, left); out.push(mk(w >= 0.45 ? 'shutter' : 'open', w)); left -= w; }
    if (left > 0.01 && out.length) out[out.length - 1].width = +(out[out.length - 1].width + left).toFixed(3);
  } else {
    const n = Math.max(1, Math.round(L / 0.55));
    const w = L / n;
    const pattern: ModUnitType[] = ['hanging', 'drawers', 'shelves', 'hanging', 'shelves', 'drawers'];
    for (let i = 0; i < n; i++) out.push(mk(pattern[i % pattern.length], w, pattern[i % pattern.length] === 'drawers' ? 3 : undefined));
  }
  return out;
}

export function defaultConfig(o: SceneObject): ModularConfig | null {
  const a = MODULAR_ASSETS[o.assetId]; if (!a) return null;
  if (a.kind === 'kitchen') {
    const depth = 0.62;
    return {
      kind: 'kitchen', units: defaultUnits('kitchen', o.dims.w), units2: a.layout === 'l' ? defaultUnits('kitchen', Math.max(0.6, o.dims.d - depth), true) : undefined,
      shutter: 'laminate', carcass: 'bwp-ply', handle: 'profile', shutterHex: o.colorHex || '#e8e4dc', upperHex: o.colorHex || '#e8e4dc',
      counter: 'quartz', loft: o.dims.h > 2.5, wallUnits: a.layout !== 'base',
    };
  }
  return { kind: 'wardrobe', units: defaultUnits('wardrobe', o.dims.w), shutter: 'laminate', carcass: 'mr-ply', handle: a.layout === 'sliding' ? 'profile' : 'bar', shutterHex: o.colorHex || '#e9e4da', loft: o.dims.h > 2.4, wallUnits: false };
}

/** Units scaled so they exactly fill a run of length L (rendering & costing use these). */
export function fitUnits(units: ModUnit[], L: number): ModUnit[] {
  const sum = units.reduce((a, u) => a + u.width, 0);
  if (!units.length || sum <= 0) return [];
  const k = L / sum;
  return units.map((u) => ({ ...u, width: u.width * k }));
}
export const unitsTotal = (u: ModUnit[]) => u.reduce((a, x) => a + x.width, 0);

// ───────────── costing ─────────────
export interface CostLine { label: string; qty: number; unit: string; rate: number; total: number }
export function modularCost(o: SceneObject, c: ModularConfig): { lines: CostLine[]; total: number; frontSqft: number } {
  const lines: CostLine[] = [];
  const layout = MODULAR_ASSETS[o.assetId]?.layout ?? 'run';
  const rate = SHUTTERS[c.shutter][c.kind] * CARCASS[c.carcass].factor * HANDLES[c.handle].factor;
  let front = 0; // m²
  const legs: [ModUnit[], number][] = [[fitUnits(c.units, o.dims.w), o.dims.w]];
  if (layout === 'l' && c.units2) legs.push([fitUnits(c.units2, Math.max(0.3, o.dims.d - 0.62)), o.dims.d - 0.62]);
  let drawers = 0, tall = 0, corner = 0, counterLen = 0;
  if (c.kind === 'kitchen') {
    for (const [units] of legs) for (const u of units) {
      if (u.type === 'tall') { front += u.width * 2.1; tall++; continue; }
      front += u.width * 0.82; // base fronts incl. plinth
      counterLen += u.width;
      if (c.wallUnits && u.type !== 'hob') front += u.width * 0.7;
      if (c.loft) front += u.width * 0.5;
      if (u.type === 'drawers' || u.type === 'hob') drawers += u.drawers ?? (u.type === 'hob' ? 2 : 3);
      if (u.type === 'corner') corner++;
    }
  } else {
    front = o.dims.w * o.dims.h;
    for (const u of c.units) if (u.type === 'drawers') drawers += u.drawers ?? 3;
  }
  const sqft = front * SQFT;
  lines.push({ label: `${c.kind === 'kitchen' ? 'Kitchen cabinets' : 'Wardrobe'} — ${SHUTTERS[c.shutter].label}, ${CARCASS[c.carcass].label}, ${HANDLES[c.handle].label}`, qty: Math.round(sqft), unit: 'sq ft', rate: Math.round(rate), total: Math.round(sqft * rate) });
  if (drawers) lines.push({ label: 'Soft-close tandem drawer systems', qty: drawers, unit: 'nos', rate: 3500, total: drawers * 3500 });
  if (tall) lines.push({ label: 'Tall-unit pantry pull-out', qty: tall, unit: 'nos', rate: 9000, total: tall * 9000 });
  if (corner) lines.push({ label: 'Corner carousel / magic corner', qty: corner, unit: 'nos', rate: 14000, total: corner * 14000 });
  if (c.kind === 'kitchen' && c.counter) {
    const rft = Math.ceil(counterLen * FT);
    lines.push({ label: `Countertop — ${COUNTERS[c.counter].label}`, qty: rft, unit: 'running ft', rate: COUNTERS[c.counter].perRft, total: rft * COUNTERS[c.counter].perRft });
  }
  if (c.kind === 'wardrobe' && c.units.some((u) => u.type === 'mirror')) {
    const n = c.units.filter((u) => u.type === 'mirror').length;
    lines.push({ label: 'Mirror on shutter', qty: n, unit: 'nos', rate: 2500, total: n * 2500 });
  }
  return { lines, total: lines.reduce((a, l) => a + l.total, 0), frontSqft: Math.round(sqft) };
}

// ───────────── cut list ─────────────
export interface Part { part: string; unit: string; qty: number; l: number; w: number; t: number; material: string; edge: string }
export function cutList(o: SceneObject, c: ModularConfig): { parts: Part[]; sheets18: number; sheets8: number; shutterSheets: number; edgeM: number } {
  const T = 18, BACK = 8;
  const parts: Part[] = [];
  const carcass = CARCASS[c.carcass].label;
  const shut = SHUTTERS[c.shutter].label;
  const box = (name: string, W: number, H: number, D: number, shelves: number, doors: number, drawers: number, openFront = false) => {
    const w = Math.round(W * 1000), h = Math.round(H * 1000), d = Math.round(D * 1000);
    parts.push({ part: 'Side', unit: name, qty: 2, l: h, w: d, t: T, material: carcass, edge: 'front' });
    parts.push({ part: 'Top / bottom', unit: name, qty: 2, l: w - 2 * T, w: d, t: T, material: carcass, edge: 'front' });
    parts.push({ part: 'Back', unit: name, qty: 1, l: h, w: w, t: BACK, material: carcass, edge: '—' });
    if (shelves) parts.push({ part: 'Shelf', unit: name, qty: shelves, l: w - 2 * T - 2, w: d - 20, t: T, material: carcass, edge: 'front' });
    if (openFront) return;
    if (drawers) {
      parts.push({ part: 'Drawer front', unit: name, qty: drawers, l: w - 4, w: Math.round(h / drawers) - 4, t: T, material: shut, edge: 'all' });
      parts.push({ part: 'Drawer box side', unit: name, qty: drawers * 2, l: d - 50, w: 150, t: 12, material: carcass, edge: 'top' });
      parts.push({ part: 'Drawer box back/front', unit: name, qty: drawers * 2, l: w - 2 * T - 90, w: 150, t: 12, material: carcass, edge: 'top' });
    }
    if (doors) parts.push({ part: 'Shutter', unit: name, qty: doors, l: h - 4, w: Math.round(w / doors) - 4, t: T, material: shut, edge: 'all' });
  };
  const layout = MODULAR_ASSETS[o.assetId]?.layout ?? 'run';
  if (c.kind === 'kitchen') {
    const legs: ModUnit[][] = [fitUnits(c.units, o.dims.w)];
    if (layout === 'l' && c.units2) legs.push(fitUnits(c.units2, Math.max(0.3, o.dims.d - 0.62)));
    legs.forEach((units, li) => units.forEach((u, i) => {
      const name = `${li ? 'B' : 'A'}${i + 1} ${unitLabel('kitchen', u.type)}`;
      const doors = u.width > 0.5 ? 2 : 1;
      if (u.type === 'tall') { box(name, u.width, 2.1, 0.56, 4, 2, 0); return; }
      const dr = u.type === 'drawers' ? u.drawers ?? 3 : u.type === 'hob' ? u.drawers ?? 2 : 0;
      box(name + ' (base)', u.width, 0.72, 0.56, dr || u.type === 'appliance' ? 0 : 1, dr || u.type === 'appliance' ? 0 : u.type === 'open' ? 0 : doors, dr, u.type === 'open' || u.type === 'appliance');
      if (c.wallUnits && u.type !== 'hob') box(name + ' (wall)', u.width, 0.7, 0.33, 1, doors, 0);
      if (c.loft) box(name + ' (loft)', u.width, 0.45, 0.33, 0, doors, 0);
    }));
    const run = legs.flat().filter((u) => u.type !== 'tall').reduce((a, u) => a + u.width, 0);
    parts.push({ part: 'Plinth / skirting', unit: 'All', qty: 1, l: Math.round(run * 1000), w: 100, t: T, material: carcass, edge: 'top' });
  } else {
    const loftH = c.loft ? Math.min(0.6, o.dims.h * 0.2) : 0;
    const H = o.dims.h - 0.075 - loftH, D = o.dims.d - 0.04;
    const units = fitUnits(c.units, o.dims.w);
    units.forEach((u, i) => {
      const name = `W${i + 1} ${unitLabel('wardrobe', u.type)}`;
      const sliding = layout === 'sliding';
      const doors = sliding || u.type === 'open' ? 0 : u.width > 0.55 ? 2 : 1;
      const shelves = u.type === 'shelves' ? 5 : u.type === 'drawers' ? 3 : u.type === 'open' ? 4 : 1;
      box(name, u.width, H, D, shelves, doors, 0);
      if (u.type === 'drawers') {
        const n = u.drawers ?? 3;
        parts.push({ part: 'Internal drawer front', unit: name, qty: n, l: Math.round(u.width * 1000) - 40, w: 180, t: T, material: carcass, edge: 'all' });
      }
      if (u.type === 'hanging') parts.push({ part: 'Hanging rod (aluminium oval)', unit: name, qty: 1, l: Math.round(u.width * 1000) - 2 * T, w: 0, t: 0, material: 'Hardware', edge: '—' });
      if (c.loft) box(name + ' (loft)', u.width, loftH, D, 0, sliding ? 0 : u.width > 0.55 ? 2 : 1, 0);
    });
    if (layout === 'sliding') {
      const panels = o.dims.w > 2.2 ? 3 : 2;
      parts.push({ part: 'Sliding shutter', unit: 'All', qty: panels, l: Math.round(H * 1000), w: Math.round((o.dims.w / panels + 0.03) * 1000), t: T, material: shut, edge: 'all' });
      parts.push({ part: 'Sliding track set (top + bottom)', unit: 'All', qty: 1, l: Math.round(o.dims.w * 1000), w: 0, t: 0, material: 'Hardware', edge: '—' });
    }
  }
  const area = (t: number, match: (p: Part) => boolean) => parts.filter((p) => p.t === t && match(p)).reduce((a, p) => a + (p.l * p.w * p.qty) / 1e6, 0);
  const SHEET = 2.44 * 1.22;
  const sheets18 = Math.ceil((area(T, (p) => p.material === carcass) * 1.15) / SHEET) + Math.ceil((area(12, () => true) * 1.15) / SHEET);
  const sheets8 = Math.ceil((area(BACK, () => true) * 1.1) / SHEET);
  const shutterSheets = Math.ceil((area(T, (p) => p.material !== carcass && p.material !== 'Hardware') * 1.15) / SHEET);
  const edgeM = parts.reduce((a, p) => a + (p.edge === 'all' ? (2 * (p.l + p.w) * p.qty) / 1000 : p.edge === 'front' || p.edge === 'top' ? (p.l * p.qty) / 1000 : 0), 0);
  return { parts, sheets18, sheets8, shutterSheets, edgeM: Math.round(edgeM) };
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function cutListCsv(o: SceneObject, c: ModularConfig): string {
  const { parts, sheets18, sheets8, shutterSheets, edgeM } = cutList(o, c);
  const rows: (string | number)[][] = [['Unit', 'Part', 'Qty', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Edge banding']];
  for (const p of parts) rows.push([p.unit, p.part, p.qty, p.l, p.w || '', p.t || '', p.material, p.edge]);
  rows.push([], ['Summary'], ['18 mm carcass/drawer boards (8×4 ft, +15% wastage)', sheets18], ['8 mm back panels (8×4 ft)', sheets8], ['Shutter boards (8×4 ft)', shutterSheets], ['Edge banding (m)', edgeM]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
