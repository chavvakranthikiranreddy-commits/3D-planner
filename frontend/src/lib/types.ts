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
  pattern?: 'none' | 'wood' | 'marble' | 'tile' | 'concrete' | 'fabric' | 'herringbone' | 'terrazzo'
    | 'fluted' | 'wallpaper' | 'stone-cladding' | 'brick' | 'wood-panel' | 'texture-plaster';
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
  /** Per-room finish ranges along a face (metres from a). Overrides the face material inside [from, to]. */
  spans?: WallSpan[];
  source: Source;
  /** 0..1 detection confidence; undefined = user-confirmed. */
  confidence?: number;
}

export interface WallSpan { side: 'A' | 'B'; from: number; to: number; materialId: string }

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
  /** False ceiling design (gypsum/POP) — rendered in 3D and priced in the estimate. */
  ceiling?: CeilingDesign;
  source: Source;
}

export type CeilingType = 'none' | 'border' | 'cove-tray' | 'layered' | 'circular' | 'wooden-slats';
export interface CeilingDesign {
  type: CeilingType;
  /** How far the false ceiling hangs below the slab (m). */
  drop: number;
  /** Width of the dropped border band (m). */
  border: number;
  coveLight: boolean;
  /** 0 = cool white … 1 = warm white */
  lightWarmth: number;
  spotlights: boolean;
  materialId?: string;
  accentMaterialId?: string;
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
  /** Modular kitchen / wardrobe layout (units, finishes) — drives the 3D model, cost and cut list. */
  modular?: ModularConfig;
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
  /** Day = sun & sliders; evening = low warm sun + lights; night = artificial light only. */
  mode?: LightMode;
}
export type LightMode = 'day' | 'evening' | 'night';

/** Electrical & lighting point on the plan (symbol). Wall points face into the room. */
export type ElecKind =
  | 'switchboard' | 'socket' | 'power-socket' | 'tv-point' | 'data' | 'ac' | 'geyser' | 'exhaust'
  | 'fan' | 'light' | 'downlight' | 'pendant' | 'wall-light' | 'strip' | 'db' | 'bell' | 'cctv';
export interface ElecPoint {
  id: string;
  floorId: string;
  kind: ElecKind;
  x: number;
  y: number;
  /** Mounting height above floor (m); ceiling points use the ceiling height. */
  height: number;
  /** Plan direction the plate faces (radians); wall points only. */
  facing?: number;
  /** Number of modules / gang count for switchboards and sockets. */
  gang?: number;
  note?: string;
  source: Source;
}

export type ModUnitType = 'drawers' | 'shutter' | 'open' | 'tall' | 'sink' | 'hob' | 'corner' | 'appliance' | 'hanging' | 'shelves' | 'mirror';
export interface ModUnit { id: string; type: ModUnitType; width: number; drawers?: number }
export interface ModularConfig {
  kind: 'kitchen' | 'wardrobe';
  units: ModUnit[];
  /** Second leg of an L-shaped kitchen. */
  units2?: ModUnit[];
  shutter: 'laminate' | 'acrylic' | 'pu' | 'veneer' | 'glass';
  carcass: 'bwp-ply' | 'mr-ply' | 'hdhmr' | 'particle';
  handle: 'profile' | 'gola' | 'knob' | 'bar' | 'push';
  shutterHex: string;
  /** Second shutter colour (wall units / alternate) — two-tone look. */
  upperHex?: string;
  counter?: 'granite' | 'quartz' | 'marble' | 'solid-surface';
  counterHex?: string;
  loft: boolean;
  wallUnits: boolean;
  /** Show the interior (doors removed) in 3D. */
  open?: boolean;
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
  /** Electrical & lighting layout (switchboards, sockets, light points…). */
  electrical?: ElecPoint[];
  /** Blueprint underlay per floor. The image itself lives in Project.assets so undo/versions stay cheap. */
  blueprints?: Record<string, BlueprintRef>;
}

/** Reference to a blueprint underlay stored in Project.assets[assetId]. */
export interface BlueprintRef {
  assetId: string;
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
}
/** @deprecated v0.1 single-underlay shape, migrated to Scene.blueprints + Project.assets. */
export interface LegacyBlueprint extends Omit<BlueprintRef, 'assetId'> { dataUrl: string; floorId: string }

/** Site photo with visualiser edits. Image bytes live in Project.assets. Coordinates are in photo pixels. */
export interface SitePhoto {
  id: string;
  name: string;
  assetId: string;
  w: number;
  h: number;
  roomId?: string;
  createdAt: number;
  regions: PhotoRegion[];
  stickers: PhotoSticker[];
  /** Floor corners + tape measurements used to build a 3D room from this photo. */
  measure?: { floor: Pt[]; sideA: number; sideB: number; height: number };
}
export interface PhotoRegion {
  id: string;
  name: string;
  surface: 'wall' | 'ceiling' | 'floor' | 'other';
  /** Outline drawn by the user (photo px). Magic-select regions are limited to this outline. */
  polygon: Pt[];
  /** Magic select: grow from this seed over similar colours. */
  wand?: { seed: Pt; tolerance: number };
  /** Perspective quad for textures (4 corners, clockwise from top-left of the surface). */
  quad?: Pt[];
  finish: { kind: 'paint'; hex: string } | { kind: 'material'; materialId: string; tiles: number };
  /** 0 = keep raw plaster texture/blotches, 1 = smooth like finished paint. */
  smooth: number;
  visible: boolean;
}
export interface PhotoSticker { id: string; name: string; assetId: string; x: number; y: number; w: number; rotation: number }

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
  /** Large binary assets (blueprint images, site photos, cut-outs) by id — not part of undo history. */
  assets: Record<string, string>;
  /** Site photos for the photo visualiser. */
  photos?: SitePhoto[];
  /** @deprecated migrated on load */
  blueprint?: LegacyBlueprint;
  versions: DesignVersion[];
}

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'elec'; id: string }
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
