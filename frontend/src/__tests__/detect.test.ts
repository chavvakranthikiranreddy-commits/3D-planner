import { describe, expect, it } from 'vitest';
import { detectPlan, type Gray } from '../lib/detect';
import { segmentWall, polygonArea, validateGeometry } from '../lib/geometry';
import type { Wall, Opening } from '../lib/types';

/** Draw a synthetic 10 m × 8 m plan at 50 px/m: outer walls, one partition with a door gap, one window. */
export function synthPlan(): Gray {
  const ppm = 50, W = 600, H = 500, ox = 50, oy = 50;
  const data = new Uint8Array(W * H).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) data[y * W + x] = v;
  };
  const t = 0.2 * ppm;
  rect(ox, oy, ox + 10 * ppm, oy + t); // top
  rect(ox, oy + 8 * ppm - t, ox + 10 * ppm, oy + 8 * ppm); // bottom
  rect(ox, oy, ox + t, oy + 8 * ppm); // left
  rect(ox + 10 * ppm - t, oy, ox + 10 * ppm, oy + 8 * ppm); // right
  // partition at x = 6 m with a 0.9 m door gap from y=3 m to 3.9 m
  rect(ox + 6 * ppm - 4, oy, ox + 6 * ppm + 4, oy + 3 * ppm);
  rect(ox + 6 * ppm - 4, oy + 3.9 * ppm, ox + 6 * ppm + 4, oy + 8 * ppm);
  // window gap in top wall from x=2..3.5 m with two thin lines
  rect(ox + 2 * ppm, oy, ox + 3.5 * ppm, oy + t, 255);
  rect(ox + 2 * ppm, oy + 2, ox + 3.5 * ppm, oy + 4, 0);
  rect(ox + 2 * ppm, oy + t - 4, ox + 3.5 * ppm, oy + t - 2, 0);
  return { data, width: W, height: H };
}

describe('detectPlan', () => {
  const res = detectPlan(synthPlan(), { pxPerMeter: 50, darkThreshold: 128 });
  it('finds the four outer walls and the partition', () => {
    expect(res.walls.length).toBe(5);
    expect(res.walls.filter((w) => w.orient === 'v').length).toBe(3);
  });
  it('turns gaps into a door and a window', () => {
    const types = res.openings.map((o) => o.type).sort();
    expect(types).toEqual(['door', 'window']);
    const door = res.openings.find((o) => o.type === 'door')!;
    expect(door.width / 50).toBeGreaterThan(0.8);
    expect(door.width / 50).toBeLessThan(1.0);
  });
  it('finds two enclosed rooms', () => {
    expect(res.rooms.length).toBe(2);
  });
  it('gives every wall a confidence score', () => {
    res.walls.forEach((w) => { expect(w.confidence).toBeGreaterThan(0); expect(w.confidence).toBeLessThanOrEqual(1); });
  });
});

describe('geometry', () => {
  const wall: Wall = { id: 'w', floorId: 'f', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, height: 3, thickness: 0.2, materialId: 'm', source: 'manual' };
  it('segments a wall around a window', () => {
    const o: Opening = { id: 'o', wallId: 'w', type: 'window', offset: 2, width: 1, height: 1.2, sill: 0.9, source: 'manual' };
    const { pieces } = segmentWall(wall, [o]);
    expect(pieces.length).toBe(4); // left, right, below, above
    const solid = pieces.reduce((s, p) => s + (p.s1 - p.s0) * (p.z1 - p.z0), 0);
    expect(solid).toBeCloseTo(4 * 3 - 1 * 1.2, 5);
  });
  it('computes polygon area', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBe(12);
  });
  it('flags overlapping openings', () => {
    const a: Opening = { id: 'a', wallId: 'w', type: 'door', offset: 1, width: 1, height: 2, sill: 0, source: 'manual' };
    const b: Opening = { ...a, id: 'b', offset: 1.5 };
    expect(validateGeometry([wall], [a, b]).some((s) => s.includes('overlap'))).toBe(true);
  });
});

describe('opening placement', () => {
  it('places the window centre relative to the snapped wall start', () => {
    const r = detectPlan(synthPlan(), { pxPerMeter: 50, darkThreshold: 128 });
    const win = r.openings.find((o) => o.type === 'window')!;
    const wall = r.walls.find((w) => w.id === win.wallId)!;
    expect(wall.x0 + win.center).toBeCloseTo(50 + 2.75 * 50, -1);
  });
});
