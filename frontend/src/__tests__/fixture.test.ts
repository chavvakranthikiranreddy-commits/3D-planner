import { describe, expect, it } from 'vitest';
import { sampleProject } from '../lib/templates';
import { parseProjectFile } from '../lib/migrate';
import { buildEstimate } from '../lib/estimate';
import { applyChanges, localProvider } from '../lib/ai';
import { validateGeometry } from '../lib/geometry';

describe('sample project', () => {
  const p = sampleProject();
  it('survives a save/reload (JSON) round-trip without losing scene data', () => {
    const back = parseProjectFile(JSON.stringify({ project: p }));
    expect(back.scene.walls).toEqual(p.scene.walls);
    expect(back.scene.objects).toEqual(p.scene.objects);
    expect(back.scene.openings).toEqual(p.scene.openings);
  });
  it('has valid geometry', () => {
    expect(validateGeometry(p.scene.walls, p.scene.openings).filter((i) => i.includes('overlap'))).toEqual([]);
  });
  it('produces estimate lines for every room and product group', () => {
    const lines = buildEstimate(p);
    expect(lines.filter((l) => l.itemType === 'flooring').length).toBe(p.scene.rooms.length);
    expect(lines.every((l) => Number.isFinite(l.total))).toBe(true);
  });
  it('AI proposals never touch walls, openings or room outlines', async () => {
    const before = structuredClone(p.scene);
    const prop = await localProvider.propose(p.scene, { roomId: p.scene.rooms[0].id, style: 'luxury', prompt: 'navy and brass', replaceFurniture: true });
    applyChanges(p.scene, prop.changes);
    expect(p.scene.walls.map((w) => [w.a, w.b, w.thickness, w.height])).toEqual(before.walls.map((w) => [w.a, w.b, w.thickness, w.height]));
    expect(p.scene.openings).toEqual(before.openings);
    expect(p.scene.rooms.map((r) => r.polygon)).toEqual(before.rooms.map((r) => r.polygon));
    expect(prop.changes.some((c) => c.kind === 'add')).toBe(true);
  });
  it('rejects files that are not projects', () => {
    expect(() => parseProjectFile('{"hello":1}')).toThrow();
  });
});
