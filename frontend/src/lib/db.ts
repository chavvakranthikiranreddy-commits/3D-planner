import { get, set, del, keys } from 'idb-keyval';
import type { Project } from './types';
import { migrateProject } from './migrate';

/**
 * Local-first persistence (IndexedDB). Projects never leave the browser unless the user
 * exports them or explicitly configures the optional backend — private by default.
 */
const P = 'archiform:project:';

export interface ProjectMeta {
  id: string; name: string; projectType: Project['projectType']; status: Project['status'];
  updatedAt: number; createdAt: number; thumbnail?: string; rooms: number; walls: number; versions: number;
  /** Set when the stored record could not be read; the dashboard offers export/delete instead of crashing. */
  damaged?: string;
}

export const toMeta = (p: Project): ProjectMeta => ({
  id: p.id, name: p.name, projectType: p.projectType, status: p.status, updatedAt: p.updatedAt, createdAt: p.createdAt,
  thumbnail: p.thumbnail, rooms: p.scene.rooms?.length ?? 0, walls: p.scene.walls?.length ?? 0, versions: p.versions?.length ?? 0,
});

export async function saveProject(p: Project) {
  await set(P + p.id, p);
}
export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(P + id);
  return p ? migrateProject(p) : undefined; // throws ProjectValidationError for damaged records
}
export async function loadRaw(id: string): Promise<unknown> {
  return get(P + id);
}
export async function deleteProject(id: string) {
  await del(P + id);
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const ks = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(P)) as string[];
  const out: ProjectMeta[] = [];
  for (const k of ks) {
    const raw = await get<Project>(k).catch(() => undefined);
    const id = k.slice(P.length);
    try {
      if (!raw) throw new Error('empty record');
      out.push(toMeta(migrateProject(raw)));
    } catch (e) {
      // isolate the bad record so every other project still lists
      out.push({ id, name: (raw as { name?: string } | undefined)?.name ?? 'Unreadable project', projectType: 'other', status: 'active', updatedAt: 0, createdAt: 0, rooms: 0, walls: 0, versions: 0, damaged: (e as Error).message });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface Settings {
  units: 'm' | 'ft';
  currency: string;
  wallHeight: number;
  wallThickness: number;
  gridStep: number;
  backendUrl: string;
  apiToken: string;
}
export const DEFAULT_SETTINGS: Settings = {
  units: 'm', currency: '₹', wallHeight: 3, wallThickness: 0.15, gridStep: 0.05, backendUrl: '', apiToken: '',
};
export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Settings>('archiform:settings')) ?? {}) };
}
export async function saveSettings(s: Settings) {
  await set('archiform:settings', s);
}
export async function wipeAll() {
  const ks = (await keys()).filter((k) => typeof k === 'string' && k.startsWith('archiform:')) as string[];
  for (const k of ks) await del(k);
}
