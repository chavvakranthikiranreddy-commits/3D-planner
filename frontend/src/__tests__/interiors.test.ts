import { describe, expect, it, beforeAll } from 'vitest';
import { applyH, computeHomography, floorMapper, openingOnSide, analyse, wandMask, renderRegions, orderQuad, guessSurface } from '../lib/photo';
import { insetPolygon, polygonArea } from '../lib/geometry';
import { buildEstimate } from '../lib/estimate';
import { ceilingClearance, defaultCeiling, CEILING_TYPES } from '../lib/interiors';
import { runCommand } from '../lib/chat';
import { sampleProject } from '../lib/templates';
import type { PhotoRegion, Pt } from '../lib/types';

beforeAll(() => {
  // Node has no ImageData; a minimal stand-in is enough for the pixel maths
  if (!(globalThis as { ImageData?: unknown }).ImageData) {
    (globalThis as Record<string, unknown>).ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
  }
});

const close = (a: Pt, b: Pt, eps = 1e-6) => { expect(a.x).toBeCloseTo(b.x, 5); expect(a.y).toBeCloseTo(b.y, 5); void eps; };

describe('photo perspective maths', () => {
  it('homography maps the four control points exactly', () => {
    const src = [{ x: 120, y: 400 }, { x: 900, y: 380 }, { x: 1100, y: 700 }, { x: 40, y: 760 }];
    const dst = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const H = computeHomography(src, dst);
    src.forEach((p, i) => close(applyH(H, p), dst[i]));
  });

  it('floor mapper turns photo clicks into metres and finds openings on the right wall', () => {
    // a 4 m × 3 m floor seen in perspective (far edge shorter)
    const corners = [{ x: 300, y: 500 }, { x: 700, y: 500 }, { x: 900, y: 800 }, { x: 100, y: 800 }];
    const map = floorMapper(corners, 4, 3);
    close(map(corners[2]), { x: 4, y: 3 });
    // door on the far wall (side A, v=0) from 1 m to 1.9 m
    const H = computeHomography([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], corners);
    const at = openingOnSide(map(applyH(H, { x: 1, y: 0.02 })), map(applyH(H, { x: 1.9, y: 0.03 })), 4, 3);
    expect(at.side).toBe(0);
    expect(at.center).toBeCloseTo(1.45, 2);
    expect(at.width).toBeCloseTo(0.9, 2);
    // window on the right wall (side 1, x = A)
    const w = openingOnSide({ x: 3.98, y: 0.8 }, { x: 4.01, y: 2.0 }, 4, 3);
    expect(w.side).toBe(1);
    expect(w.center).toBeCloseTo(1.4, 2);
  });

  it('orders quad corners and guesses surfaces from height in the photo', () => {
    const q = orderQuad([{ x: 10, y: 90 }, { x: 90, y: 10 }, { x: 10, y: 10 }, { x: 90, y: 90 }]);
    expect(q[0]).toEqual({ x: 10, y: 10 });
    expect(guessSurface({ x: 0, y: 5 }, 100)).toBe('ceiling');
    expect(guessSurface({ x: 0, y: 95 }, 100)).toBe('floor');
    expect(guessSurface({ x: 0, y: 50 }, 100)).toBe('wall');
  });
});

describe('photo repaint', () => {
  // 40×20 test image: left half grey plaster with soft shading, right half brown floor
  const W = 40, H = 20;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = 140 + 0.6 * y; // soft light fall-off down the wall
    const [r, g, b] = x < 20 ? [v, v, v - 4] : [110, 70, 40];
    px.set([r, g, b, 255], i);
  }
  const base = analyse({ data: px, width: W, height: H } as ImageData);

  it('magic select stays inside the similar-coloured area', () => {
    const all = new Uint8ClampedArray(W * H).fill(255);
    const m = wandMask(base, { x: 5, y: 10 }, 30, all);
    expect(m[10 * W + 5]).toBeGreaterThan(127);
    expect(m[10 * W + 35]).toBe(0);
  });

  it('paints the selected wall but keeps its shadows and leaves the floor untouched', () => {
    const r: PhotoRegion = { id: 'r', name: 'Wall', surface: 'wall', polygon: [], wand: { seed: { x: 5, y: 10 }, tolerance: 45 }, finish: { kind: 'paint', hex: '#3d4b63' }, smooth: 0, visible: true };
    const out = renderRegions(base, [r], { materials: {}, pattern: () => { throw new Error('no texture for paint'); } }).data;
    const at = (x: number, y: number) => [...out.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
    const lit = at(10, 12), shade = at(10, 1);
    expect(lit[2]).toBeGreaterThan(lit[0]); // navy-ish
    expect(shade[2]).toBeLessThan(lit[2]); // shadow kept
    expect(at(30, 10)).toEqual([110, 70, 40]); // floor untouched
  });
});

describe('false ceilings', () => {
  it('insets a room outline for the ceiling border', () => {
    const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const inner = insetPolygon(sq, 0.6)!;
    expect(Math.abs(polygonArea(inner))).toBeCloseTo(2.8 * 1.8, 5);
    expect(insetPolygon(sq, 2)).toBeNull();
  });

  it('flags low headroom and prices the ceiling per sq ft', () => {
    expect(ceilingClearance(3.0, defaultCeiling('cove-tray')).ok).toBe(true);
    expect(ceilingClearance(2.7, defaultCeiling('layered')).ok).toBe(false);
    const p = sampleProject();
    const room = p.scene.rooms[0];
    room.ceiling = defaultCeiling('cove-tray');
    const line = buildEstimate(p).find((l) => l.itemType === 'ceiling');
    expect(line).toBeTruthy();
    const sqft = Math.abs(polygonArea(room.polygon)) * 10.7639;
    const want = sqft * CEILING_TYPES.find((c) => c.type === 'cove-tray')!.ratePerSqft;
    expect(Math.abs(line!.total - want) / want).toBeLessThan(0.005);
  });

  it('chat can add a cove false ceiling to a named room', () => {
    const s = sampleProject().scene;
    const hall = s.rooms[0];
    const out = runCommand(`add a cove false ceiling with warm lights in the ${hall.name}`, { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    expect(out.ok).toBe(true);
    out.edit?.(s);
    expect(s.rooms.find((r) => r.id === hall.id)!.ceiling?.type).toBe('cove-tray');
  });
});
