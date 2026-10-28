import { nanoid } from 'nanoid';
import type { Opening, Project, Pt, Room, RoomType, Scene, SceneObject, Units, Wall } from './types';
import { SCENE_SCHEMA_VERSION } from './types';
import { defaultMaterials } from './materials';
import { getAsset } from './catalog';

export const uid = () => nanoid(10);

export function emptyScene(ceilingHeight = 3): Scene {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    floors: [{ id: 'f0', name: 'Ground Floor', level: 0, elevation: 0, ceilingHeight }],
    walls: [],
    openings: [],
    rooms: [],
    objects: [],
    materials: defaultMaterials(),
    lighting: { sunIntensity: 2.2, sunAzimuth: 135, sunElevation: 50, ambient: 0.55, warmth: 0.45, roomLights: true },
  };
}

export function newProject(name: string, opts: Partial<Pick<Project, 'units' | 'projectType' | 'currency'>> & { floors?: number; ceilingHeight?: number } = {}): Project {
  const scene = emptyScene(opts.ceilingHeight ?? 3);
  const floors = Math.max(1, Math.min(5, opts.floors ?? 1));
  for (let i = 1; i < floors; i++) {
    scene.floors.push({ id: uid(), name: `Floor ${i}`, level: i, elevation: i * (scene.floors[0].ceilingHeight + 0.2), ceilingHeight: scene.floors[0].ceilingHeight });
  }
  const now = Date.now();
  return {
    id: uid(), name, projectType: opts.projectType ?? 'apartment', units: (opts.units ?? 'm') as Units,
    currency: opts.currency ?? '₹', status: 'active', createdAt: now, updatedAt: now, scene, versions: [],
  };
}

export function makeWall(floorId: string, a: Pt, b: Pt, thickness = 0.15, height = 3, source: Wall['source'] = 'manual'): Wall {
  return { id: uid(), floorId, a, b, thickness, height, materialId: 'paint-white', source };
}
export function makeRoom(floorId: string, name: string, roomType: RoomType, polygon: Pt[], floorMaterialId = 'tile-vitrified', source: Room['source'] = 'manual'): Room {
  return { id: uid(), floorId, name, roomType, polygon, floorMaterialId, ceilingMaterialId: 'ceiling-white', source };
}
export function makeObject(assetId: string, floorId: string, x: number, y: number, rotation = 0, source: SceneObject['source'] = 'manual'): SceneObject {
  const a = getAsset(assetId)!;
  return {
    id: uid(), floorId, assetId, name: a.name, x, y, elevation: a.elevation ?? 0, rotation,
    dims: { ...a.dims }, colorHex: a.colorHex, accentHex: a.accentHex, price: a.price, source,
  };
}

const R = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

/** A furnished 2BHK sample so first-time users can explore the editor immediately. */
export function sampleProject(): Project {
  const p = newProject('Sample 2BHK Apartment', { projectType: 'apartment' });
  p.id = uid();
  const s = p.scene;
  const f = 'f0';
  const T = 0.23, t = 0.12, H = 3;
  const W = (ax: number, ay: number, bx: number, by: number, th = t) => makeWall(f, { x: ax, y: ay }, { x: bx, y: by }, th, H, 'template');
  const top = W(0, 0, 11, 0, T), right = W(11, 0, 11, 8, T), bottom = W(11, 8, 0, 8, T), left = W(0, 8, 0, 0, T);
  const mid = W(6.5, 0, 6.5, 8), hl = W(0, 5.4, 6.5, 5.4), kb = W(3.5, 5.4, 3.5, 8), hr = W(6.5, 4, 11, 4);
  s.walls = [top, right, bottom, left, mid, hl, kb, hr];
  const O = (wall: Wall, type: Opening['type'], offset: number, width: number, height: number, sill = 0): Opening =>
    ({ id: uid(), wallId: wall.id, type, offset, width, height, sill, source: 'template' });
  s.openings = [
    O(left, 'door', 5, 1.05, 2.15),
    O(top, 'window', 3, 2.2, 1.5, 0.75), O(top, 'window', 8.75, 1.6, 1.4, 0.8),
    O(right, 'window', 6.1, 1.4, 1.4, 0.8),
    O(bottom, 'window', 9.25, 1.2, 1.1, 1.05), O(bottom, 'window', 6, 0.6, 0.5, 1.7),
    O(mid, 'door', 3.1, 0.9, 2.1), O(mid, 'door', 4.85, 0.9, 2.1),
    O(hl, 'door', 1.75, 1.2, 2.1), O(hl, 'door', 5.0, 0.8, 2.1),
  ];
  s.rooms = [
    makeRoom(f, 'Living & Dining', 'living', R(0, 0, 6.5, 5.4), 'wood-oak', 'template'),
    makeRoom(f, 'Kitchen', 'kitchen', R(0, 5.4, 3.5, 8), 'tile-slate', 'template'),
    makeRoom(f, 'Bathroom', 'bathroom', R(3.5, 5.4, 6.5, 8), 'tile-vitrified', 'template'),
    makeRoom(f, 'Master Bedroom', 'bedroom', R(6.5, 0, 11, 4), 'wood-herringbone', 'template'),
    makeRoom(f, 'Bedroom 2', 'bedroom', R(6.5, 4, 11, 8), 'wood-oak', 'template'),
  ];
  const ob = (id: string, x: number, y: number, r = 0) => makeObject(id, f, x, y, r, 'template');
  s.objects = [
    ob('sofa-3', 2.2, 3.9, Math.PI), ob('coffee-table', 2.2, 2.85), ob('rug', 2.2, 2.9), ob('tv-unit', 2.2, 0.35),
    ob('armchair', 0.75, 2.5, Math.PI / 2), ob('plant', 0.5, 0.5), ob('floor-lamp', 3.7, 4.6),
    ob('dining-4', 5.1, 2.6, Math.PI / 2), ob('dining-chair', 4.55, 2.25, Math.PI / 2), ob('dining-chair', 4.55, 2.95, Math.PI / 2),
    ob('dining-chair', 5.65, 2.25, -Math.PI / 2), ob('dining-chair', 5.65, 2.95, -Math.PI / 2), ob('pendant', 5.1, 2.6),
    ob('kitchen-base', 1.75, 7.6, Math.PI), ob('kitchen-wall', 1.75, 7.72, Math.PI), ob('fridge', 3.0, 6.0, -Math.PI / 2),
    ob('vanity', 5.6, 7.62, Math.PI), ob('wc', 4.1, 7.6, Math.PI), ob('shower', 4.1, 6.0),
    ob('bed-king', 8.9, 1.25), ob('nightstand', 7.6, 0.4), ob('nightstand', 10.2, 0.4), ob('wardrobe', 8.9, 3.6, Math.PI), ob('art', 8.9, 0.13),
    ob('bed-queen', 9.6, 6.2, -Math.PI / 2), ob('desk', 7.3, 7.5, Math.PI), ob('office-chair', 7.3, 6.95), ob('bookshelf', 10.68, 4.75, -Math.PI / 2),
  ];
  s.walls.forEach((w) => (w.materialId = 'paint-white'));
  s.walls[4].materialId = 'paint-greige';
  return p;
}
