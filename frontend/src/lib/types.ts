/**
 * Scene schema — the single source of truth for a project.
 * All lengths are stored in METRES; plan coordinates use x (east) and y (south),
 * which map to world x and world z in 3D. Bump SCENE_SCHEMA_VERSION on breaking changes
 * and add a migration in lib/migrate.ts.
 */
export const SCENE_SCHEMA_VERSION = 1;

export type Units = 'm' | 'ft';
export type Pt = { x: number; y: number };
export type Source = 'manual' | 'detected' | 'ai' | 'template';

export interface Material {
  id: string;
  name: string;
  kind: 'paint' | 'wood' | 'stone' | 'tile' | 'concrete' | 'fabric' | 'metal' | 'glass' | 'custom';
  colorHex: string;
  roughness: number;
  metalness: number;
  /** Built-in procedural pattern or uploaded texture (data URL). */
  pattern?: 'none' | 'wood' | 'marble' | 'tile' | 'concrete' | 'fabric' | 'herringbone' | 'terrazzo';
  textureDataUrl?: string;
  textureScale?: number; // metres per texture repeat
  /** Indicative unit price per m² in project currency (for reports). */
  pricePerM2?: number;
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  elevation: number; // m
  ceilingHeight: number; // m
}

export interface Wall {
  id: string;
  floorId: string;
  a: Pt;
  b: Pt;
  height: number;
  thickness: number;
  /** Finish on side A (the left-hand side walking from a to b, plan normal (-sinθ, cosθ)) and wall ends. */
  materialId: string;
  /** Finish on side B; falls back to materialId. Lets shared walls carry a different paint in each room. */
  materialIdB?: string;
  source: Source;
  /** 0..1 detection confidence; undefined = user-confirmed. */
  confidence?: number;
}

export interface Opening {
  id: string;
  wallId: string;
  type: 'door' | 'window';
  /** Distance from wall start (a) to opening centre, m. */
  offset: number;
  width: number;
  height: number;
  sill: number;
  source: Source;
  confidence?: number;
}

export interface Room {
  id: string;
  floorId: string;
  name: string;
  roomType: RoomType;
  polygon: Pt[];
  floorMaterialId: string;
  ceilingMaterialId: string;
  source: Source;
}

export type RoomType =
  | 'living' | 'bedroom' | 'kitchen' | 'dining' | 'bathroom'
  | 'office' | 'hallway' | 'balcony' | 'utility' | 'pooja' | 'other';

export interface SceneObject {
  id: string;
  floorId: string;
  assetId: string;
  name: string;
  /** Plan position (centre) in metres + elevation above floor. */
  x: number;
  y: number;
  elevation: number;
  rotation: number; // radians about vertical axis
  dims: { w: number; h: number; d: number };
  colorHex: string;
  accentHex?: string;
  materialId?: string;
  /** Product approximations from a reference image are always flagged. */
  estimated?: boolean;
  imageDataUrl?: string;
  price?: number;
  brand?: string;
  source: Source;
}

export interface Lighting {
  sunIntensity: number;
  sunAzimuth: number; // degrees
  sunElevation: number; // degrees
  ambient: number;
  warmth: number; // 0 cool .. 1 warm
  roomLights: boolean;
}

export interface Scene {
  schemaVersion: number;
  floors: Floor[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  objects: SceneObject[];
  materials: Record<string, Material>;
  lighting: Lighting;
}

export interface Blueprint {
  dataUrl: string;
  fileName: string;
  widthPx: number;
  heightPx: number;
  /** Pixels per metre, set by the user during calibration. Null = not calibrated. */
  pxPerMeter: number | null;
  /** Plan-space offset of the image's top-left corner, m. */
  originX: number;
  originY: number;
  opacity: number;
  visible: boolean;
  floorId: string;
}

export interface DesignVersion {
  id: string;
  number: number;
  label: string;
  createdAt: number;
  thumbnail?: string;
  scene: Scene;
}

export interface Project {
  id: string;
  name: string;
  projectType: 'apartment' | 'villa' | 'independent-house' | 'office' | 'retail' | 'other';
  units: Units;
  currency: string;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  scene: Scene;
  blueprint?: Blueprint;
  versions: DesignVersion[];
}

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'opening'; id: string }
  | null;

export type Surface = 'wall' | 'floor' | 'ceiling' | 'object';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface Job {
  id: string;
  type: 'render' | 'detect' | 'report' | 'ai' | 'product';
  label: string;
  status: JobStatus;
  progress: number;
  error?: string;
  result?: string;
  createdAt: number;
}
