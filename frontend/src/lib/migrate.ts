import type { BlueprintRef, Project, Scene } from './types';
import { SCENE_SCHEMA_VERSION } from './types';
import { defaultMaterials } from './materials';
import { emptyScene, uid } from './templates';
import { normalizeSceneOpenings } from './geometry';

/**
 * Schema validation + migration. Everything that enters storage — imported files,
 * stored records, backend payloads — goes through validateScene first, so one bad
 * record can never break the dashboard or the editor.
 */
export class ProjectValidationError extends Error {}

const MAX_ITEMS = 20000;
const MAX_COORD = 10000; // metres
const isNum = (v: unknown, min = -MAX_COORD, max = MAX_COORD): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isPt = (p: unknown) => !!p && typeof p === 'object' && isNum((p as { x: unknown }).x) && isNum((p as { y: unknown }).y);

/** Validate a scene; returns a normalised copy (missing optional arrays/maps filled) or throws with a readable reason. */
export function validateScene(input: unknown): Scene {
  const fail = (msg: string): never => { throw new ProjectValidationError(msg); };
  if (!input || typeof input !== 'object') fail('Scene data is missing.');
  const s = input as Record<string, unknown>;
  const version = s.schemaVersion ?? 1;
  if (!isNum(version, 1, 1000) || !Number.isInteger(version)) fail('The scene schema version is not a whole number.');
  if ((version as number) > SCENE_SCHEMA_VERSION) fail(`This file was made by a newer version of Archiform (schema ${version}). Please update the app.`);

  if (!Array.isArray(s.floors) || s.floors.length === 0) fail('A project needs at least one floor.');
  for (const k of ['walls', 'openings', 'rooms', 'objects'] as const) {
    if (s[k] === undefined) s[k] = [];
    if (!Array.isArray(s[k])) fail(`"${k}" must be a list.`);
    if ((s[k] as unknown[]).length > MAX_ITEMS) fail(`Too many ${k} (limit ${MAX_ITEMS}).`);
  }
  const floors = s.floors as Record<string, unknown>[];
  const floorIds = new Set<string>();
  floors.forEach((f, i) => {
    if (!f || !isStr(f.id, 64)) fail(`Floor ${i + 1} has no id.`);
    if (!isNum(f.elevation, -50, 500) || !isNum(f.ceilingHeight, 1.8, 30) || !isNum(f.level, -10, 200)) fail(`Floor ${i + 1} has invalid heights.`);
    if (typeof f.name !== 'string') f.name = `Floor ${i}`;
    floorIds.add(f.id as string);
  });
  const wallIds = new Set<string>();
  (s.walls as Record<string, unknown>[]).forEach((w, i) => {
    if (!w || !isStr(w.id, 64) || !floorIds.has(w.floorId as string)) fail(`Wall ${i + 1} refers to a floor that does not exist.`);
    if (!isPt(w.a) || !isPt(w.b)) fail(`Wall ${i + 1} has invalid coordinates.`);
    if (!isNum(w.height, 0.5, 30) || !isNum(w.thickness, 0.01, 2)) fail(`Wall ${i + 1} has an invalid height or thickness.`);
    if (typeof w.materialId !== 'string') w.materialId = 'paint-white';
    if (w.spans !== undefined && !Array.isArray(w.spans)) w.spans = [];
    wallIds.add(w.id as string);
  });
  (s.openings as Record<string, unknown>[]).forEach((o, i) => {
    if (!o || !wallIds.has(o.wallId as string)) fail(`Opening ${i + 1} refers to a wall that does not exist.`);
    if (o.type !== 'door' && o.type !== 'window') fail(`Opening ${i + 1} must be a door or window.`);
    if (!isNum(o.offset, -100, MAX_COORD) || !isNum(o.width, 0.05, 50) || !isNum(o.height, 0.05, 30) || !isNum(o.sill ?? 0, 0, 30)) fail(`Opening ${i + 1} has invalid dimensions.`);
  });
  (s.rooms as Record<string, unknown>[]).forEach((r, i) => {
    if (!r || !isStr(r.id, 64) || !floorIds.has(r.floorId as string)) fail(`Room ${i + 1} refers to a floor that does not exist.`);
    if (!Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 500 || !r.polygon.every(isPt)) fail(`Room ${i + 1} has an invalid outline.`);
    if (typeof r.name !== 'string') r.name = `Room ${i + 1}`;
    if (typeof r.floorMaterialId !== 'string') r.floorMaterialId = 'tile-vitrified';
    if (typeof r.ceilingMaterialId !== 'string') r.ceilingMaterialId = 'ceiling-white';
  });
  (s.objects as Record<string, unknown>[]).forEach((o, i) => {
    if (!o || !isStr(o.id, 64) || !floorIds.has(o.floorId as string)) fail(`Item ${i + 1} refers to a floor that does not exist.`);
    const d = o.dims as Record<string, unknown> | undefined;
    if (!isNum(o.x) || !isNum(o.y) || !isNum(o.rotation ?? 0, -1000, 1000) || !d || !isNum(d.w, 0.001, 100) || !isNum(d.h, 0.001, 100) || !isNum(d.d, 0.001, 100)) fail(`Item ${i + 1} has invalid size or position.`);
    if (typeof o.imageDataUrl === 'string' && o.imageDataUrl.length > 6_000_000) fail(`Item ${i + 1} carries an image that is too large.`);
  });
  if (s.electrical !== undefined) {
    if (!Array.isArray(s.electrical)) s.electrical = [];
    if ((s.electrical as unknown[]).length > MAX_ITEMS) fail('Too many electrical points.');
    s.electrical = (s.electrical as Record<string, unknown>[]).filter((e) => e && isStr(e.id, 64) && floorIds.has(e.floorId as string) && isNum(e.x) && isNum(e.y) && typeof e.kind === 'string')
      .map((e) => ({ ...e, height: isNum(e.height, 0, 30) ? e.height : 1.2 }));
  }
  if (!s.materials || typeof s.materials !== 'object') s.materials = {};
  const base = emptyScene();
  if (!s.lighting || typeof s.lighting !== 'object') s.lighting = base.lighting;
  return s as unknown as Scene;
}

/** Upgrade older scene documents. Add a step for every schema bump. */
export function migrateScene(input: Scene): Scene {
  const out: Scene = { ...validateScene(structuredClone(input)) };
  for (const [k, v] of Object.entries(defaultMaterials())) if (!out.materials[k]) out.materials[k] = v;
  out.schemaVersion = SCENE_SCHEMA_VERSION;
  normalizeSceneOpenings(out); // older data could hold openings that overhang their wall
  return out;
}

export function migrateProject(p: Project): Project {
  const scene = migrateScene(p.scene);
  const assets = { ...(p.assets ?? {}) };
  // v0.1 → per-floor blueprint references
  if (p.blueprint && !scene.blueprints?.[p.blueprint.floorId]) {
    const { dataUrl, floorId, ...rest } = p.blueprint;
    const assetId = 'bp-' + uid();
    assets[assetId] = dataUrl;
    const ref: BlueprintRef = { ...rest, assetId };
    scene.blueprints = { ...(scene.blueprints ?? {}), [floorId]: ref };
  }
  const versions = (p.versions ?? []).flatMap((v) => {
    try { return [{ ...v, scene: migrateScene(v.scene) }]; } catch { return []; } // drop unreadable snapshots, keep the project
  });
  return {
    ...p,
    name: typeof p.name === 'string' && p.name ? p.name.slice(0, 200) : 'Untitled',
    units: p.units === 'ft' ? 'ft' : 'm',
    currency: typeof p.currency === 'string' ? p.currency.slice(0, 4) : '₹',
    status: p.status === 'archived' ? 'archived' : 'active',
    createdAt: isNum(p.createdAt, 0, 1e15) ? p.createdAt : Date.now(),
    updatedAt: isNum(p.updatedAt, 0, 1e15) ? p.updatedAt : Date.now(),
    scene, assets, versions, blueprint: undefined,
  };
}

/** Validate an imported project file completely before anything is written. */
export function parseProjectFile(text: string): Project {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ProjectValidationError('This file is not valid JSON.'); }
  const d = data as { project?: unknown };
  const p = (d && typeof d === 'object' && 'project' in d ? d.project : data) as Project;
  if (!p || typeof p !== 'object' || !p.scene) throw new ProjectValidationError('This file is not an Archiform project (missing scene data).');
  return migrateProject(p);
}
