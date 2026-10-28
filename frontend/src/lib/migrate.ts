import type { Project, Scene } from './types';
import { SCENE_SCHEMA_VERSION } from './types';
import { defaultMaterials } from './materials';

/** Upgrade older scene documents. Add a step for every schema bump. */
export function migrateScene(s: Scene): Scene {
  const out: Scene = { ...s };
  if (!out.materials) out.materials = defaultMaterials();
  // ensure built-in presets exist even if a project was created with an older catalog
  for (const [k, v] of Object.entries(defaultMaterials())) if (!out.materials[k]) out.materials[k] = v;
  out.schemaVersion = SCENE_SCHEMA_VERSION;
  return out;
}

export function migrateProject(p: Project): Project {
  return { ...p, scene: migrateScene(p.scene), versions: (p.versions ?? []).map((v) => ({ ...v, scene: migrateScene(v.scene) })) };
}

/** Validate an imported project file — never trust imported JSON blindly. */
export function parseProjectFile(text: string): Project {
  const data = JSON.parse(text);
  const p = data?.project ?? data;
  if (!p || typeof p !== 'object' || !p.scene || !Array.isArray(p.scene.walls) || !Array.isArray(p.scene.floors)) {
    throw new Error('This file is not an Archiform project (missing scene data).');
  }
  if (typeof p.name !== 'string') p.name = 'Imported project';
  return migrateProject(p as Project);
}
