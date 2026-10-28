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
}

export const toMeta = (p: Project): ProjectMeta => ({
  id: p.id, name: p.name, projectType: p.projectType, status: p.status, updatedAt: p.updatedAt, createdAt: p.createdAt,
  thumbnail: p.thumbnail, rooms: p.scene.rooms.length, walls: p.scene.walls.length, versions: p.versions.length,
});

export async function saveProject(p: Project) {
  await set(P + p.id, p);
}
export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(P + id);
  return p ? migrateProject(p) : undefined;
}
export async function deleteProject(id: string) {
  await del(P + id);
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const ks = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(P)) as string[];
  const out: ProjectMeta[] = [];
  for (const k of ks) {
    const p = await get<Project>(k);
    if (p) out.push(toMeta(p));
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
