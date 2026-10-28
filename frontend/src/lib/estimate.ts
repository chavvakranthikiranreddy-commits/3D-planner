import type { Project, Room, Scene } from './types';
import { polygonArea, polygonPerimeter, wallLength, wallMaterialFor } from './geometry';
import { roomWallSides, wallsOfRoom } from './ai';

/** Indicative quantities & costs. Every line records its source and confidence (spec: EstimateLine). */
export interface EstimateLine {
  roomId?: string; item: string; itemType: 'flooring' | 'paint' | 'product';
  quantity: number; unit: string; unitPrice: number; total: number;
  source: string; confidence: 'measured' | 'estimated';
}

const PAINT_COVERAGE_M2_PER_L = 10; // per coat
const COATS = 2;
const FLOOR_WASTAGE = 1.1;

export function roomWallArea(scene: Scene, room: Room) {
  const floor = scene.floors.find((f) => f.id === room.floorId);
  const h = floor?.ceilingHeight ?? 3;
  const walls = wallsOfRoom(scene, room);
  const openingArea = scene.openings.filter((o) => walls.some((w) => w.id === o.wallId)).reduce((s, o) => s + o.width * o.height, 0);
  // room perimeter is a better proxy for the inside face than summing shared walls
  return Math.max(0, polygonPerimeter(room.polygon) * h - openingArea);
}

export function buildEstimate(p: Project): EstimateLine[] {
  const s = p.scene;
  const lines: EstimateLine[] = [];
  for (const r of s.rooms) {
    const area = polygonArea(r.polygon);
    const fm = s.materials[r.floorMaterialId];
    const qty = +(area * FLOOR_WASTAGE).toFixed(2);
    lines.push({ roomId: r.id, item: `${r.name} — ${fm?.name ?? 'Flooring'} (+10% wastage)`, itemType: 'flooring', quantity: qty, unit: 'm²', unitPrice: fm?.pricePerM2 ?? 0, total: qty * (fm?.pricePerM2 ?? 0), source: 'Plan area × catalog rate', confidence: r.source === 'detected' ? 'estimated' : 'measured' });
    const wa = roomWallArea(s, r);
    const sides = roomWallSides(s, r);
    const wm = sides[0] ? s.materials[wallMaterialFor(sides[0].wall, sides[0].side)] : undefined;
    const litres = +((wa * COATS) / PAINT_COVERAGE_M2_PER_L).toFixed(1);
    lines.push({ roomId: r.id, item: `${r.name} — ${wm?.name ?? 'Wall paint'} (${COATS} coats, ${wa.toFixed(1)} m²)`, itemType: 'paint', quantity: litres, unit: 'L', unitPrice: (wm?.pricePerM2 ?? 40) * PAINT_COVERAGE_M2_PER_L / COATS, total: wa * (wm?.pricePerM2 ?? 40), source: 'Perimeter × ceiling height − openings', confidence: 'estimated' });
  }
  const groups = new Map<string, { name: string; qty: number; price: number; estimated: boolean; dims: string }>();
  for (const o of s.objects) {
    const key = `${o.assetId}|${o.name}|${o.colorHex}|${o.dims.w}x${o.dims.d}x${o.dims.h}`;
    const g = groups.get(key) ?? { name: o.name, qty: 0, price: o.price ?? 0, estimated: !!o.estimated, dims: `${o.dims.w.toFixed(2)}×${o.dims.d.toFixed(2)}×${o.dims.h.toFixed(2)} m` };
    g.qty++;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    lines.push({ item: `${g.name} (${g.dims})${g.estimated ? ' — approximation' : ''}`, itemType: 'product', quantity: g.qty, unit: 'pcs', unitPrice: g.price, total: g.qty * g.price, source: g.estimated ? 'User reference image' : 'Built-in catalog (indicative)', confidence: g.estimated ? 'estimated' : 'measured' });
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
