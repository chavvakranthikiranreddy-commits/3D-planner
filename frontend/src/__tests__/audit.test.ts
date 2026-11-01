/** Regression tests for the reproduced findings in the November 2026 audit (IDs match the report). */
import { describe, expect, it } from 'vitest';
import { detectPlan, type Gray } from '../lib/detect';
import { runCommand } from '../lib/chat';
import { parseProjectFile, ProjectValidationError } from '../lib/migrate';
import { applyAttachments, attachmentsAt, footprintInside, normalizeOpening, normalizeSceneOpenings, objectCorners, parseFeetInches, polygonArea, quadsOverlap, setWallSpanMaterial, validateGeometry, wallMaterialAt } from '../lib/geometry';
import { applyChanges, localProvider } from '../lib/ai';
import { buildEstimate } from '../lib/estimate';
import { makeObject, makeRoom, makeWall, newProject, sampleProject } from '../lib/templates';
import type { Opening, Wall } from '../lib/types';

function canvas(W: number, H: number, bg = 255) { return { data: new Uint8Array(W * H).fill(bg), width: W, height: H } as Gray & { data: Uint8Array }; }
function rect(g: Gray & { data: Uint8Array }, x0: number, y0: number, x1: number, y1: number, v = 0) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.data[y * g.width + x] = v;
}
/** Hollow rectangle "room" 10 px walls. */
function box(g: Gray & { data: Uint8Array }, x0: number, y0: number, x1: number, y1: number, v = 0, t = 10) {
  rect(g, x0, y0, x1, y0 + t, v); rect(g, x0, y1 - t, x1, y1, v); rect(g, x0, y0, x0 + t, y1, v); rect(g, x1 - t, y0, x1, y1, v);
}

describe('A04 · auto threshold works on clean and difficult drawings', () => {
  const variants: [string, (g: Gray & { data: Uint8Array }) => void][] = [
    ['pure black/white', () => {}],
    ['faint grey ink', (g) => { for (let i = 0; i < g.data.length; i++) if (g.data[i] === 0) g.data[i] = 150; }],
    ['inverted', (g) => { for (let i = 0; i < g.data.length; i++) g.data[i] = 255 - g.data[i]; }],
    ['scan noise', (g) => { let s = 7; for (let i = 0; i < g.data.length; i++) { s = (s * 1103515245 + 12345) >>> 0; g.data[i] = Math.max(0, Math.min(255, g.data[i] + ((s >>> 16) % 25) - 12)); } }],
    ['anti-aliased edges', (g) => { for (let y = 1; y < g.height - 1; y++) for (let x = 1; x < g.width - 1; x++) { const i = y * g.width + x; if (g.data[i] === 255 && (g.data[i - 1] === 0 || g.data[i + 1] === 0 || g.data[i - g.width] === 0 || g.data[i + g.width] === 0)) g.data[i] = 128; } }],
  ];
  for (const [name, fx] of variants) {
    it(name, () => {
      const g = canvas(500, 400);
      box(g, 50, 50, 450, 350);
      fx(g);
      const r = detectPlan(g, { pxPerMeter: 50 }); // no explicit threshold
      expect(r.walls.length).toBe(4);
      expect(r.rooms.length).toBe(1);
    });
  }
});

describe('A05 · irregular rooms keep their outline', () => {
  it('L-shaped room is not replaced by its bounding box', () => {
    const g = canvas(500, 500);
    const t = 10;
    rect(g, 50, 50, 450, 50 + t); rect(g, 50, 50, 50 + t, 450); rect(g, 50, 450 - t, 250, 450);
    rect(g, 250 - t, 250, 250, 450); rect(g, 250, 250 - t, 450, 250); rect(g, 450 - t, 50, 450, 250);
    const r = detectPlan(g, { pxPerMeter: 50 });
    expect(r.rooms.length).toBe(1);
    const room = r.rooms[0];
    expect(room.irregular).toBe(true);
    expect(room.polygon.length).toBeGreaterThanOrEqual(6);
    const area = polygonArea(room.polygon);
    expect(Math.abs(area - room.areaPx) / room.areaPx).toBeLessThan(0.06);
    const bboxArea = (room.x1 - room.x0) * (room.y1 - room.y0);
    expect(area).toBeLessThan(bboxArea * 0.85);
  });
});

describe('A02 · chat never widens a destructive command', () => {
  it('unknown room → no change', () => {
    const s = sampleProject().scene;
    const out = runCommand('clear furniture in room 99', { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    expect(out.ok).toBe(false);
    expect(out.edit).toBeUndefined();
    expect(out.confirm).toBeUndefined();
  });
  it('no room named → asks for scope', () => {
    const s = sampleProject().scene;
    const out = runCommand('remove all furniture', { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    expect(out.edit).toBeUndefined();
    expect(out.reply).toMatch(/Which room/);
  });
  it('bulk removal needs confirmation and only touches that room', () => {
    const s = sampleProject().scene;
    const before = s.objects.length;
    const out = runCommand('clear all furniture in the kitchen', { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    expect(out.edit).toBeUndefined();
    expect(out.confirm?.edit).toBeDefined();
    out.confirm!.edit!(s);
    const kitchen = s.rooms.find((r) => r.name === 'Kitchen')!;
    expect(s.objects.length).toBeLessThan(before);
    expect(s.objects.filter((o) => o.x < 3.5 && o.y > 5.4).length).toBe(0);
    expect(s.objects.some((o) => o.name === '3-Seater Sofa')).toBe(true);
    expect(kitchen).toBeTruthy();
  });
});

describe('A06 · imported files are validated before anything is written', () => {
  it('rejects the audit sample with no floors', () => {
    expect(() => parseProjectFile('{"name":"bad","scene":{"walls":[],"floors":[]}}')).toThrow(ProjectValidationError);
  });
  it('rejects dangling references, non-finite numbers and future schemas', () => {
    const p = newProject('x');
    const w = makeWall('f0', { x: 0, y: 0 }, { x: 4, y: 0 });
    const bad1 = { ...p, scene: { ...p.scene, openings: [{ id: 'o', wallId: 'missing', type: 'door', offset: 1, width: 0.9, height: 2, sill: 0 }] } };
    const bad2 = { ...p, scene: { ...p.scene, walls: [{ ...w, a: { x: Number.NaN, y: 0 } }] } };
    const bad3 = { ...p, scene: { ...p.scene, schemaVersion: 99 } };
    const bad4 = { ...p, scene: { ...p.scene, walls: [{ ...w, floorId: 'nope' }] } };
    for (const b of [bad1, bad2, bad3, bad4]) expect(() => parseProjectFile(JSON.stringify(b).replace('null', 'null'))).toThrow();
  });
  it('fills optional arrays for minimal valid files', () => {
    const p = parseProjectFile(JSON.stringify({ name: 'ok', scene: { floors: [{ id: 'f0', name: 'G', level: 0, elevation: 0, ceilingHeight: 3 }] } }));
    expect(p.scene.rooms).toEqual([]);
    expect(p.scene.objects).toEqual([]);
    expect(p.assets).toEqual({});
  });
});

describe('A09 · one opening-placement rule everywhere', () => {
  const wall: Wall = makeWall('f0', { x: 0, y: 0 }, { x: 4, y: 0 }, 0.15, 3);
  const door: Opening = { id: 'd', wallId: wall.id, type: 'door', offset: 0, width: 0.9, height: 2.1, sill: 0, source: 'manual' };
  it('validation flags an opening past the wall end', () => {
    expect(validateGeometry([wall], [door]).some((m) => m.includes('past the end'))).toBe(true);
  });
  it('normalisation clamps the stored data (so 2D, 3D and walkthrough agree)', () => {
    expect(normalizeOpening(door, wall).offset).toBeCloseTo(0.45);
    const s = { ...newProject('x').scene, walls: [wall], openings: [door] };
    normalizeSceneOpenings(s);
    expect(s.openings[0].offset).toBeCloseTo(0.45);
    expect(validateGeometry(s.walls, s.openings)).toEqual([]);
  });
});

describe('A10 · connected edits keep walls joined', () => {
  it('moving a corner moves the attached wall end and room corner', () => {
    const p = sampleProject();
    const s = p.scene;
    const corner = { x: 11, y: 0 };
    const att = attachmentsAt(s, 'f0', corner);
    expect(att.walls.length).toBe(2);
    applyAttachments(s, att, { x: 11.5, y: 0 });
    const touching = s.walls.filter((w) => (w.a.x === 11.5 && w.a.y === 0) || (w.b.x === 11.5 && w.b.y === 0));
    expect(touching.length).toBe(2);
    expect(s.rooms.find((r) => r.name === 'Master Bedroom')!.polygon.some((q) => q.x === 11.5 && q.y === 0)).toBe(true);
  });
});

describe('A11 · AI furniture fits the real room', () => {
  it('every proposed item is inside an L-shaped room and nothing overlaps', async () => {
    const p = newProject('L');
    const s = p.scene;
    const L = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 8 }, { x: 0, y: 8 }];
    L.forEach((a, i) => s.walls.push(makeWall('f0', a, L[(i + 1) % L.length], 0.2, 3)));
    s.rooms.push(makeRoom('f0', 'Living', 'living', L));
    const prop = await localProvider.propose(s, { roomId: s.rooms[0].id, style: 'luxury', prompt: '', replaceFurniture: true });
    applyChanges(s, prop.changes);
    const floorItems = s.objects.filter((o) => o.assetId !== 'rug' && o.elevation < 0.5);
    expect(s.objects.length).toBeGreaterThan(3);
    for (const o of s.objects) expect(footprintInside(objectCorners(o), L)).toBe(true);
    for (let i = 0; i < floorItems.length; i++) for (let j = i + 1; j < floorItems.length; j++) {
      expect(quadsOverlap(objectCorners(floorItems[i], -0.01), objectCorners(floorItems[j], -0.01))).toBe(false);
    }
  });
});

describe('A13 · painting one room does not repaint its neighbour on a shared wall', () => {
  it('span painting', () => {
    const w = makeWall('f0', { x: 0, y: 0 }, { x: 10, y: 0 });
    setWallSpanMaterial(w, 'A', 0, 6, 'red');
    expect(wallMaterialAt(w, 'A', 3)).toBe('red');
    expect(wallMaterialAt(w, 'A', 8)).toBe('paint-white');
    expect(wallMaterialAt(w, 'B', 3)).toBe('paint-white');
  });
  it('chat: hall colour stays out of the master bedroom on the long top wall', () => {
    const s = sampleProject().scene;
    const out = runCommand('use #123456 for the hall', { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    out.edit!(s);
    const top = s.walls[0]; // (0,0)→(11,0): hall 0–6.5, master bedroom 6.5–11, same face
    expect(s.materials[wallMaterialAt(top, 'A', 3)].colorHex).toBe('#123456');
    expect(s.materials[wallMaterialAt(top, 'A', 9)].colorHex).not.toBe('#123456');
  });
});

describe('A20 · estimates', () => {
  it('same-looking items with different prices are not merged', () => {
    const p = newProject('x');
    const a = makeObject('sofa-3', 'f0', 1, 1); a.price = 100;
    const b = { ...makeObject('sofa-3', 'f0', 3, 1), price: 200 };
    p.scene.objects.push(a, b);
    const lines = buildEstimate(p).filter((l) => l.itemType === 'product');
    expect(lines.reduce((t, l) => t + l.total, 0)).toBe(300);
  });
  it('wall finish lines follow the actual paint on each stretch', () => {
    const p = sampleProject();
    runCommand('use #123456 for the hall', { scene: p.scene, selection: null, floorId: 'f0', image: null, units: 'm' }).edit!(p.scene);
    const hall = p.scene.rooms.find((r) => r.name === 'Living & Dining')!;
    const lines = buildEstimate(p).filter((l) => l.roomId === hall.id && l.itemType === 'paint');
    expect(lines.length).toBe(1);
    expect(lines[0].item).toMatch(/123456/);
  });
});

describe('A15 · feet-and-inches input', () => {
  it.each([[`10' 6"`, 10.5], ['10 6', 10.5], ['10.5', 10.5], [`126"`, 10.5], ['10 ft 6 in', 10.5], ['abc', null]])('%s', (txt, ft) => {
    const v = parseFeetInches(txt as string);
    if (ft === null) expect(v).toBeNull(); else expect(v).toBeCloseTo(ft as number);
  });
});

describe('A11 · rooms traced at inner wall faces (blueprint import)', () => {
  it('wall furniture still stands inside the room and against the wall', async () => {
    const p = newProject('inset');
    const s = p.scene;
    const C = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }];
    C.forEach((a, i) => s.walls.push(makeWall('f0', a, C[(i + 1) % 4], 0.23, 3)));
    const inner = [{ x: 0.15, y: 0.15 }, { x: 4.85, y: 0.15 }, { x: 4.85, y: 3.85 }, { x: 0.15, y: 3.85 }];
    s.rooms.push(makeRoom('f0', 'Bedroom 1', 'bedroom', inner, 'tile-vitrified', 'detected'));
    const out = runCommand('add a wardrobe to bedroom 1', { scene: s, selection: null, floorId: 'f0', image: null, units: 'm' });
    out.edit!(s);
    const w = s.objects.at(-1)!;
    expect(footprintInside(objectCorners(w), inner)).toBe(true);
    // against a wall: back edge within 10 cm of the room outline
    const minGap = Math.min(...objectCorners(w).flatMap((c) => [c.x - 0.15, 4.85 - c.x, c.y - 0.15, 3.85 - c.y]));
    expect(minGap).toBeLessThan(0.1);
  });
});
