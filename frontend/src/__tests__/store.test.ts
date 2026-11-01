/** A01 / A12: autosave revisions and reopening after dashboard changes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../lib/types';

const disk = new Map<string, Project>();
const gate: { hold: boolean; release: (() => void)[] } = { hold: false, release: [] };
vi.mock('../lib/db', async () => {
  const actual = await vi.importActual<typeof import('../lib/db')>('../lib/db');
  return {
    ...actual,
    saveProject: vi.fn(async (p: Project) => {
      if (gate.hold) await new Promise<void>((r) => gate.release.push(r));
      disk.set(p.id, structuredClone(p));
    }),
    loadProject: vi.fn(async (id: string) => { const p = disk.get(id); return p ? structuredClone(p) : undefined; }),
    saveSettings: vi.fn(async () => {}),
  };
});

const { useEditor } = await import('../store/editor');
const { newProject } = await import('../lib/templates');

describe('autosave', () => {
  beforeEach(() => { disk.clear(); gate.hold = false; gate.release = []; });

  it('A01: an edit made while a save is in flight is still written and status is not falsely "saved"', async () => {
    const p = newProject('race');
    disk.set(p.id, structuredClone(p));
    useEditor.getState().setProject(p);
    const st = useEditor.getState;
    st().mutate((s) => { s.floors[0].name = 'First'; });
    gate.hold = true;
    const first = st().flushSave();               // write of "First" starts and is held
    await Promise.resolve();
    st().mutate((s) => { s.floors[0].name = 'Second'; }); // edit during the write
    expect(st().saveState).not.toBe('saved');
    gate.hold = false;
    gate.release.splice(0).forEach((r) => r());   // let "First" complete
    await first;
    await st().flushSave();
    gate.release.splice(0).forEach((r) => r());
    await st().flushSave();
    expect(disk.get(p.id)!.scene.floors[0].name).toBe('Second');
    expect(st().saveState).toBe('saved');
    expect(st().rev).toBe(st().savedRev);
  });

  it('A12: reopening reads changes made to the stored copy (e.g. a dashboard rename)', async () => {
    const p = newProject('Old name');
    disk.set(p.id, structuredClone(p));
    useEditor.getState().setProject(structuredClone(p));
    disk.set(p.id, { ...structuredClone(p), name: 'New name', updatedAt: p.updatedAt + 1000 });
    await useEditor.getState().openProject(p.id);
    expect(useEditor.getState().project!.name).toBe('New name');
  });
});
