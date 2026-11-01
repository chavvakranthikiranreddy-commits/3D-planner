import type { Project, Room, Scene } from './types';
import { polygonArea, wallLength, wallMaterialAt } from './geometry';
import { roomWallSides } from './placement';

/**
 * Indicative quantities & costs. Every line records its source and confidence (spec: EstimateLine).
 * Catalog rates are placeholder values in the project's currency symbol; changing the symbol does not convert them.
 */
export interface EstimateLine {
  roomId?: string; item: string; itemType: 'flooring' | 'paint' | 'product';
  quantity: number; unit: string; unitPrice: number; total: number;
  source: string; confidence: 'measured' | 'estimated';
}

const PAINT_COVERAGE_M2_PER_L = 10; // per coat
const COATS = 2;
const FLOOR_WASTAGE = 1.1;

/**
 * Wall finish areas inside a room, per material — computed from the actual wall faces and the
 * stretch of each wall the room covers, minus the openings in that stretch.
 */
export function roomWallFinishes(scene: Scene, room: Room): Map<string, number> {
  const out = new Map<string, number>();
  const floor = scene.floors.find((f) => f.id === room.floorId);
  for (const f of roomWallSides(scene, room)) {
    const h = Math.min(f.wall.height, floor?.ceilingHeight ?? f.wall.height);
    // sample the face in 10 cm steps so partial spans of different paint are each counted
    const L = wallLength(f.wall);
    const step = 0.1;
    for (let a = f.from; a < f.to - 1e-6; a += step) {
      const b = Math.min(f.to, a + step);
      const mid = (a + b) / 2;
      if (mid > L) break;
      let open = 0;
      for (const o of scene.openings) {
        if (o.wallId !== f.wall.id) continue;
        const ov = Math.max(0, Math.min(b, o.offset + o.width / 2) - Math.max(a, o.offset - o.width / 2));
        open += ov * Math.min(o.height, h - o.sill);
      }
      const area = (b - a) * h - open;
      const m = wallMaterialAt(f.wall, f.side, mid);
      out.set(m, (out.get(m) ?? 0) + Math.max(0, area));
    }
  }
  return out;
}

/** Total paintable wall area of a room (m²). */
export const roomWallArea = (scene: Scene, room: Room) => [...roomWallFinishes(scene, room).values()].reduce((a, b) => a + b, 0);

export function buildEstimate(p: Project): EstimateLine[] {
  const s = p.scene;
  const lines: EstimateLine[] = [];
  for (const r of s.rooms) {
    const area = polygonArea(r.polygon);
    const fm = s.materials[r.floorMaterialId];
    const qty = +(area * FLOOR_WASTAGE).toFixed(2);
    lines.push({ roomId: r.id, item: `${r.name} — ${fm?.name ?? 'Flooring'} (+10% wastage)`, itemType: 'flooring', quantity: qty, unit: 'm²', unitPrice: fm?.pricePerM2 ?? 0, total: qty * (fm?.pricePerM2 ?? 0), source: 'Plan area × catalog rate', confidence: r.source === 'detected' ? 'estimated' : 'measured' });
    for (const [matId, wa] of roomWallFinishes(s, r)) {
      if (wa < 0.05) continue;
      const wm = s.materials[matId];
      const rate = wm?.pricePerM2 ?? 40;
      const isPaint = !wm || wm.kind === 'paint' || wm.kind === 'custom';
      lines.push(isPaint
        ? { roomId: r.id, item: `${r.name} — ${wm?.name ?? 'Wall paint'} (${COATS} coats, ${wa.toFixed(1)} m²)`, itemType: 'paint', quantity: +((wa * COATS) / PAINT_COVERAGE_M2_PER_L).toFixed(1), unit: 'L', unitPrice: (rate * PAINT_COVERAGE_M2_PER_L) / COATS, total: wa * rate, source: 'Wall faces × ceiling height − openings', confidence: 'estimated' }
        : { roomId: r.id, item: `${r.name} — ${wm.name} wall finish`, itemType: 'paint', quantity: +wa.toFixed(2), unit: 'm²', unitPrice: rate, total: wa * rate, source: 'Wall faces × ceiling height − openings', confidence: 'estimated' });
    }
  }
  // group identical products only when price, brand and verification status also match (audit A20)
  const groups = new Map<string, { name: string; qty: number; price: number; estimated: boolean; dims: string; brand?: string }>();
  for (const o of s.objects) {
    const price = o.price ?? 0;
    const key = [o.assetId, o.name, o.colorHex, `${o.dims.w}x${o.dims.d}x${o.dims.h}`, price, o.brand ?? '', o.estimated ? 1 : 0].join('|');
    const g = groups.get(key) ?? { name: o.name, qty: 0, price, estimated: !!o.estimated, brand: o.brand, dims: `${o.dims.w.toFixed(2)}×${o.dims.d.toFixed(2)}×${o.dims.h.toFixed(2)} m` };
    g.qty++;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    lines.push({ item: `${g.name}${g.brand ? ` (${g.brand})` : ''} (${g.dims})${g.estimated ? ' — approximation' : ''}`, itemType: 'product', quantity: g.qty, unit: 'pcs', unitPrice: g.price, total: g.qty * g.price, source: g.estimated ? 'User reference image' : 'Built-in catalog (placeholder price)', confidence: g.estimated ? 'estimated' : 'measured' });
  }
  return lines;
}

export function sceneStats(s: Scene) {
  return {
    floorArea: s.rooms.reduce((a, r) => a + polygonArea(r.polygon), 0),
    wallLength: s.walls.reduce((a, w) => a + wallLength(w), 0),
    doors: s.openings.filter((o) => o.type === 'door').length,
    windows: s.openings.filter((o) => o.type === 'window').length,
    objects: s.objects.length,
  };
}
