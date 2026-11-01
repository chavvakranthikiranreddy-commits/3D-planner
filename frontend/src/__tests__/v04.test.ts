import { describe, expect, it } from 'vitest';
import { sampleProject, makeObject } from '../lib/templates';
import { ELEC, roomOf, schedule, scheduleCsv, snapToWall, suggestForRoom, electricalPlanSvg } from '../lib/electrical';
import { hexToHsl, hslToHex, lrv, palettesFrom, applyPalette, applyRoomStyle, ROOM_STYLES } from '../lib/roomStyle';
import { cutList, cutListCsv, defaultConfig, fitUnits, modularCost, unitsTotal } from '../lib/modular';
import { withGPano } from '../lib/panorama';
import { buildEstimate } from '../lib/estimate';
import { wallMaterialAt, pointInPolygon } from '../lib/geometry';
import { roomWallSides } from '../lib/placement';
import { migrateScene } from '../lib/migrate';

describe('electrical layout', () => {
  it('suggests a sensible first draft for every room type, with wall points on the room side of a wall', () => {
    const p = sampleProject(); const s = p.scene;
    for (const r of s.rooms) {
      const pts = suggestForRoom(s, r);
      expect(pts.some((e) => e.kind === 'switchboard')).toBe(true);
      for (const e of pts) {
        if (ELEC[e.kind].mount === 'ceiling') expect(pointInPolygon(e, r.polygon)).toBe(true);
        else { expect(e.facing).toBeTypeOf('number'); expect(roomOf({ ...s, electrical: [e] }, e)?.id).toBe(r.id); }
      }
    }
    const bed = s.rooms.find((r) => r.roomType === 'bedroom')!;
    const kinds = suggestForRoom(s, bed).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['fan', 'ac', 'tv-point', 'downlight']));
    const kit = s.rooms.find((r) => r.roomType === 'kitchen')!;
    expect(suggestForRoom(s, kit).filter((e) => e.kind === 'power-socket').length).toBeGreaterThanOrEqual(4);
  });

  it('snaps wall points to the nearest wall face and builds a schedule, CSV and plan', () => {
    const p = sampleProject(); const s = p.scene;
    const w = s.walls[0];
    const mid = { x: (w.a.x + w.b.x) / 2 + 0.3, y: (w.a.y + w.b.y) / 2 + 0.3 };
    const sn = snapToWall(s, w.floorId, mid)!;
    expect(sn).toBeTruthy();
    s.electrical = s.rooms.flatMap((r) => suggestForRoom(s, r));
    const rows = schedule(s, 'm');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.room !== 'Unassigned')).toBe(true);
    expect(scheduleCsv(s, 'ft').split('\n')[0]).toBe('Room,Point,Qty,Mounting height,Notes');
    const { svg } = electricalPlanSvg(s, 'f0', 'Test & <plan>', 'm');
    expect(svg).toContain('Legend'); expect(svg).toContain('&amp; &lt;plan&gt;');
    // electrical lines reach the estimate, and the data survives validation
    expect(buildEstimate(p).some((l) => l.itemType === 'electrical')).toBe(true);
    expect(migrateScene(s).electrical?.length).toBe(s.electrical.length);
  });
});

describe('palettes & style presets', () => {
  it('converts colours and rates lightness', () => {
    const [h, sat, l] = hexToHsl('#c46a4a');
    expect(hslToHex(h, sat, l)).toBe('#c46a4a');
    expect(lrv('#ffffff')).toBe(100); expect(lrv('#000000')).toBe(0);
    const ps = palettesFrom('#a8b5a0');
    expect(ps).toHaveLength(4);
    for (const p of ps) for (const k of ['walls', 'feature', 'ceiling', 'upholstery', 'soft', 'wood'] as const) expect(p[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('applies a palette with one feature wall, and a style to walls, floor, ceiling and furniture', () => {
    const s = sampleProject().scene;
    const bed = s.rooms.find((r) => r.roomType === 'bedroom')!;
    const pal = palettesFrom('#3d4b63')[0];
    applyPalette(s, bed.id, pal);
    const faces = roomWallSides(s, bed);
    const mats = faces.map((f) => s.materials[wallMaterialAt(f.wall, f.side, (f.from + f.to) / 2)]?.colorHex);
    expect(mats.filter((c) => c === pal.feature).length).toBe(1);
    expect(mats.filter((c) => c === pal.walls).length).toBe(faces.length - 1);

    const lux = ROOM_STYLES.find((x) => x.id === 'luxury')!;
    applyRoomStyle(s, bed.id, lux);
    const r = s.rooms.find((x) => x.id === bed.id)!;
    expect(r.floorMaterialId).toBe('stone-marble');
    expect(r.ceiling?.type).toBe('layered');
    const bath = s.rooms.find((x) => x.roomType === 'bathroom')!;
    applyRoomStyle(s, bath.id, lux);
    expect(s.rooms.find((x) => x.id === bath.id)!.floorMaterialId).toBe('tile-vitrified');
  });
});

describe('modular planner', () => {
  it('builds default kitchen/wardrobe layouts that fill the run, costs them and makes a cut list', () => {
    const k = makeObject('kitchen-l', 'f0', 0, 0, 0, 'manual');
    const cfg = defaultConfig(k)!;
    expect(cfg.units2?.length).toBeGreaterThan(0);
    expect(Math.abs(unitsTotal(cfg.units) - k.dims.w)).toBeLessThan(0.02);
    expect(unitsTotal(fitUnits([{ id: 'a', type: 'shutter', width: 1 }, { id: 'b', type: 'drawers', width: 1 }], 3))).toBeCloseTo(3);
    const c1 = modularCost(k, cfg);
    expect(c1.total).toBeGreaterThan(0);
    expect(c1.lines.some((l) => l.label.startsWith('Countertop'))).toBe(true);
    const pu = modularCost(k, { ...cfg, shutter: 'pu' });
    expect(pu.total).toBeGreaterThan(c1.total);
    const cl = cutList(k, cfg);
    expect(cl.parts.length).toBeGreaterThan(20);
    expect(cl.sheets18).toBeGreaterThan(3);
    expect(cutListCsv(k, cfg)).toContain('Shutter');

    const wd = makeObject('wardrobe-sliding', 'f0', 0, 0, 0, 'manual');
    const wc = defaultConfig(wd)!;
    expect(wc.kind).toBe('wardrobe');
    expect(cutList(wd, wc).parts.some((p) => p.part === 'Sliding shutter')).toBe(true);
    expect(defaultConfig(makeObject('sofa-3', 'f0', 0, 0, 0, 'manual'))).toBeNull();
  });
});

describe('360 panorama tagging', () => {
  it('embeds a GPano XMP segment right after the JPEG start marker', () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9));
    const out = withGPano('data:image/jpeg;base64,' + jpeg, 4096, 2048);
    const bin = atob(out.split(',')[1]);
    expect(bin.charCodeAt(0)).toBe(0xff); expect(bin.charCodeAt(2)).toBe(0xff); expect(bin.charCodeAt(3)).toBe(0xe1);
    expect(bin).toContain('GPano:ProjectionType="equirectangular"');
    expect(bin).toContain('FullPanoWidthPixels="4096"');
    expect(bin.endsWith(String.fromCharCode(0xff, 0xd9))).toBe(true);
  });
});
