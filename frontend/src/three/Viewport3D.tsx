import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, PointerLockControls, Sky, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useEditor } from '../store/editor';
import type { CeilingDesign, ElecPoint, LightMode, Material, Opening, Pt, Room, Scene, SceneObject, Wall } from '../lib/types';
import { ELEC } from '../lib/electrical';
import { capturePanorama, nextFrames } from '../lib/panorama';
import { centroid, polygonArea as polyArea } from '../lib/geometry';
import { bbox, insetPolygon, normalizeOpening, projectOnSegment, segmentWall, spanBreaks, wallAngle, wallLength, wallMaterialAt } from '../lib/geometry';
import { getMaterialTexture } from './textures';
import { FurnitureModel } from './Furniture';
import { getAsset } from '../lib/catalog';
import { registerViewport, getViewport } from '../lib/capture';
const PanoramaViewer = lazy(() => import('../components/PanoramaViewer'));

const SEL = '#f59e0b';

function useRepeatedTexture(m: Material | undefined, u: number, v: number) {
  return useMemo(() => {
    if (!m) return null;
    const base = getMaterialTexture(m);
    if (!base) return null;
    const t = base.clone();
    t.needsUpdate = true;
    const sc = m.textureScale ?? 1;
    t.repeat.set(u / sc, v / sc);
    return t;
  }, [m, u, v]);
}

function SurfaceMat({ m, u, v, selected, side, attach }: { m?: Material; u: number; v: number; selected?: boolean; side?: THREE.Side; attach?: string }) {
  const map = useRepeatedTexture(m, u, v);
  return (
    <meshStandardMaterial
      attach={attach}
      color={m?.colorHex ?? '#eeeeee'}
      roughness={m?.roughness ?? 0.9}
      metalness={m?.metalness ?? 0}
      map={map ?? undefined}
      emissive={selected ? SEL : '#000000'}
      emissiveIntensity={selected ? 0.25 : 0}
      side={side}
    />
  );
}

function WallMesh({ wall, openings, materials, elevation, selected, onSelect }: {
  wall: Wall; openings: Opening[]; materials: Scene['materials']; elevation: number; selected: boolean; onSelect: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const L = wallLength(wall);
  const ang = wallAngle(wall);
  const { pieces, holes } = useMemo(() => {
    const seg = segmentWall(wall, openings);
    // split solid pieces wherever a per-room finish span starts or ends
    const breaks = spanBreaks(wall);
    const out: typeof seg.pieces = [];
    for (const p of seg.pieces) {
      let s0 = p.s0;
      for (const b of breaks) if (b > s0 + 1e-4 && b < p.s1 - 1e-4) { out.push({ ...p, s0, s1: b }); s0 = b; }
      out.push({ ...p, s0 });
    }
    return { pieces: out, holes: seg.holes };
  }, [wall, openings]);
  const lowConf = wall.confidence !== undefined && wall.confidence < 0.6;
  if (L < 0.01) return null;
  return (
    <group position={[wall.a.x, elevation, wall.a.y]} rotation={[0, -ang, 0]} onClick={onSelect}>
      {pieces.map((p, i) => {
        const mid = (p.s0 + p.s1) / 2;
        const mA = materials[wallMaterialAt(wall, 'A', mid)];
        const mB = materials[wallMaterialAt(wall, 'B', mid)] ?? mA;
        return (
          <mesh key={i} position={[mid, (p.z0 + p.z1) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[p.s1 - p.s0, p.z1 - p.z0, wall.thickness]} />
            {[0, 1, 2, 3, 4, 5].map((fi) => {
              const mm = fi === 5 ? mB : mA;
              return <SurfaceMat key={fi} attach={`material-${fi}`} m={lowConf ? { ...mm, colorHex: '#f3c9a0' } : mm} u={p.s1 - p.s0} v={p.z1 - p.z0} selected={selected} />;
            })}
          </mesh>
        );
      })}
      {holes.map((o) => (
        <group key={o.id} position={[o.offset, o.sill, 0]}>
          {o.type === 'window' ? (
            <>
              <mesh position={[0, o.height / 2, 0]}>
                <boxGeometry args={[o.width, o.height, 0.02]} />
                <meshPhysicalMaterial color="#cfe6f2" transmission={0.6} transparent opacity={0.35} roughness={0.05} metalness={0.1} />
              </mesh>
              {[[0, 0.02, o.width, 0.04], [0, o.height - 0.02, o.width, 0.04], [-o.width / 2 + 0.02, o.height / 2, 0.04, o.height], [o.width / 2 - 0.02, o.height / 2, 0.04, o.height], [0, o.height / 2, 0.035, o.height]].map(([x, y, w, h], i) => (
                <mesh key={i} position={[x, y, 0]} castShadow>
                  <boxGeometry args={[w, h, wall.thickness * 0.5]} />
                  <meshStandardMaterial color="#3b3b3d" roughness={0.5} metalness={0.4} />
                </mesh>
              ))}
            </>
          ) : (
            <group position={[-o.width / 2, 0, wall.thickness / 2]} rotation={[0, -1.1, 0]}>
              <mesh position={[o.width / 2 - 0.01, o.height / 2, 0]} castShadow>
                <boxGeometry args={[o.width - 0.02, o.height - 0.01, 0.04]} />
                <meshStandardMaterial color="#8a6a4a" roughness={0.6} />
              </mesh>
              <mesh position={[o.width - 0.1, o.height * 0.47, 0.04]}>
                <boxGeometry args={[0.12, 0.02, 0.02]} />
                <meshStandardMaterial color="#c9c9c9" metalness={0.9} roughness={0.25} />
              </mesh>
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

function RoomMesh({ room, materials, elevation, ceilingHeight, showCeiling, selected, onSelect, lights, lumens = 0, warmth = 0.7 }: {
  room: Room; materials: Scene['materials']; elevation: number; ceilingHeight: number; showCeiling: boolean; selected: boolean; onSelect: (e: ThreeEvent<MouseEvent>) => void; lights: boolean;
  /** Total lumens of planned light fixtures in the room (0 = use a default ceiling light). */
  lumens?: number; warmth?: number;
}) {
  const geom = useMemo(() => {
    if (room.polygon.length < 3) return null;
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ShapeGeometry(shape);
    return g;
  }, [room.polygon]);
  const ceilGeom = useMemo(() => {
    if (room.polygon.length < 3) return null;
    return new THREE.ShapeGeometry(new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, p.y))));
  }, [room.polygon]);
  const b = bbox(room.polygon);
  if (!geom || !ceilGeom) return null;
  const fm = materials[room.floorMaterialId];
  const cm = materials[room.ceilingMaterialId];
  return (
    <group>
      <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, elevation + 0.005, 0]} receiveShadow onClick={onSelect}>
        <SurfaceMat m={fm} u={1} v={1} selected={selected} />
      </mesh>
      {/* ceilings face down (single-sided), so the dollhouse view from above still sees into the room */}
      {showCeiling && (
        <mesh geometry={ceilGeom} rotation={[Math.PI / 2, 0, 0]} position={[0, elevation + ceilingHeight, 0]}>
          <SurfaceMat m={cm} u={1} v={1} side={THREE.FrontSide} />
        </mesh>
      )}
      {showCeiling && room.ceiling && room.ceiling.type !== 'none' && (
        <FalseCeiling room={room} design={room.ceiling} top={elevation + ceilingHeight} materials={materials} lightsOn={lights} />
      )}
      {lights && (
        <pointLight position={[(b.minX + b.maxX) / 2, elevation + ceilingHeight - 0.3, (b.minY + b.maxY) / 2]} intensity={lumens ? Math.max(0.5, Math.min(4.5, lumens / 1600)) : 1.2} distance={Math.max(6, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.8)} decay={1.6} color={warmColor(0.25 + warmth * 0.75)} />
      )}
    </group>
  );
}

const warmColor = (k: number) => new THREE.Color('#e8f0ff').lerp(new THREE.Color('#ffc978'), k);

/** Vertical band along each edge of a closed outline (false-ceiling fascia). */
function EdgeBands({ pts, y, h, t, color, emissive }: { pts: Pt[]; y: number; h: number; t: number; color: string; emissive?: THREE.Color }) {
  return (
    <>
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        const L = Math.hypot(q.x - p.x, q.y - p.y);
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        return (
          <mesh key={i} position={[(p.x + q.x) / 2, y + h / 2, (p.y + q.y) / 2]} rotation={[0, -ang, 0]}>
            <boxGeometry args={[L, h, t]} />
            {emissive ? <meshStandardMaterial color={emissive} emissive={emissive} emissiveIntensity={2.4} toneMapped={false} /> : <meshStandardMaterial color={color} roughness={0.9} />}
          </mesh>
        );
      })}
    </>
  );
}

/** Gypsum/POP false ceiling: dropped border ring, fascia, optional cove LED, spotlights, layered tier, circle or wooden slats. */
function FalseCeiling({ room, design, top, materials, lightsOn }: { room: Room; design: CeilingDesign; top: number; materials: Scene['materials']; lightsOn: boolean }) {
  const poly = room.polygon;
  const m = materials[design.materialId ?? room.ceilingMaterialId] ?? materials['ceiling-white'];
  const accent = materials[design.accentMaterialId ?? 'wood-oak'];
  const glow = useMemo(() => warmColor(design.lightWarmth), [design.lightWarmth]);
  const b = bbox(poly);
  const geo = useMemo(() => {
    const y0 = top - design.drop;
    const inner = design.type === 'circular' ? null : insetPolygon(poly, design.border);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const radius = Math.max(0.4, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2 - design.border);
    const outer = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    if (design.type === 'circular') {
      const hole = new THREE.Path(); hole.absarc(cx, cy, radius, 0, Math.PI * 2, true); outer.holes.push(hole);
    } else if (inner) {
      outer.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y))));
    }
    const ring = new THREE.ShapeGeometry(outer, 48);
    let tier: { geo: THREE.ShapeGeometry; inner2: Pt[] } | null = null;
    if (design.type === 'layered' && inner) {
      const inner2 = insetPolygon(poly, design.border + 0.35);
      if (inner2) {
        const s2 = new THREE.Shape(inner.map((p) => new THREE.Vector2(p.x, p.y)));
        s2.holes.push(new THREE.Path(inner2.map((p) => new THREE.Vector2(p.x, p.y))));
        tier = { geo: new THREE.ShapeGeometry(s2), inner2 };
      }
    }
    // spotlight positions along the middle of the border band
    const mid = design.type === 'circular' ? null : insetPolygon(poly, design.border / 2);
    const spots: Pt[] = [];
    if (design.spotlights && mid) {
      mid.forEach((p, i) => {
        const q = mid[(i + 1) % mid.length]; const L = Math.hypot(q.x - p.x, q.y - p.y); const n = Math.max(1, Math.floor(L / 1.2));
        for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; spots.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
      });
    }
    return { y0, inner, ring, tier, cx, cy, radius, spots };
  }, [poly, design.type, design.border, design.drop, design.spotlights, top, b.minX, b.maxX, b.minY, b.maxY]);
  if (design.type === 'none') return null;
  const { y0, inner, ring, tier, cx, cy, radius, spots } = geo;
  const fasciaTop = design.coveLight ? top - 0.1 : top;
  const lastInner = tier?.inner2 ?? inner;
  const lastY = tier ? y0 + 0.12 : y0;
  return (
    <group>
      <mesh geometry={ring} rotation={[Math.PI / 2, 0, 0]} position={[0, y0, 0]}>
        <SurfaceMat m={m} u={1} v={1} side={THREE.FrontSide} />
      </mesh>
      {inner && <EdgeBands pts={inner} y={y0} h={(tier ? y0 + 0.12 : fasciaTop) - y0} t={0.03} color={m?.colorHex ?? '#ffffff'} />}
      {tier && (
        <>
          <mesh geometry={tier.geo} rotation={[Math.PI / 2, 0, 0]} position={[0, y0 + 0.12, 0]}><SurfaceMat m={m} u={1} v={1} side={THREE.FrontSide} /></mesh>
          <EdgeBands pts={tier.inner2} y={y0 + 0.12} h={fasciaTop - y0 - 0.12} t={0.03} color={m?.colorHex ?? '#ffffff'} />
        </>
      )}
      {design.type === 'circular' && (
        <mesh position={[cx, (y0 + fasciaTop) / 2, cy]}>
          <cylinderGeometry args={[radius, radius, fasciaTop - y0, 64, 1, true]} />
          <meshStandardMaterial color={m?.colorHex ?? '#ffffff'} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* cove LED strip on the upper edge of the drop, glowing onto the slab */}
      {design.coveLight && lastInner && <EdgeBands pts={insetPolygon(lastInner, -0.06) ?? lastInner} y={lastY + 0.015} h={0.012} t={0.03} color="#fff" emissive={glow} />}
      {design.coveLight && design.type === 'circular' && (
        <mesh position={[cx, y0 + 0.02, cy]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[radius + 0.06, 0.012, 8, 64]} /><meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2.4} toneMapped={false} /></mesh>
      )}
      {spots.map((p, i) => (
        <mesh key={i} position={[p.x, y0 - 0.004, p.y]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.045, 16]} />
          <meshStandardMaterial color="#fffaf0" emissive={glow} emissiveIntensity={lightsOn ? 2 : 0.4} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {design.type === 'wooden-slats' && inner && (() => {
        const ib = bbox(inner);
        const alongX = ib.maxX - ib.minX >= ib.maxY - ib.minY;
        const span = alongX ? ib.maxY - ib.minY : ib.maxX - ib.minX;
        const n = Math.floor(span / 0.14);
        return Array.from({ length: n }).map((_, i) => {
          const off = (alongX ? ib.minY : ib.minX) + 0.07 + i * 0.14;
          const len = alongX ? ib.maxX - ib.minX : ib.maxY - ib.minY;
          const ccx = alongX ? (ib.minX + ib.maxX) / 2 : off, ccy = alongX ? off : (ib.minY + ib.maxY) / 2;
          return (
            <mesh key={i} position={[ccx, top - 0.05, ccy]} castShadow>
              <boxGeometry args={alongX ? [len, 0.06, 0.045] : [0.045, 0.06, len]} />
              <SurfaceMat m={accent} u={len} v={0.2} />
            </mesh>
          );
        });
      })()}
      {lightsOn && design.coveLight && <pointLight position={[cx, y0 + 0.05, cy]} intensity={0.9} distance={Math.max(5, b.maxX - b.minX + b.maxY - b.minY)} decay={1.5} color={glow} />}
    </group>
  );
}

function ObjectMesh({ o, elevation, selected, materials, onSelect }: { o: SceneObject; elevation: number; selected: boolean; materials: Scene['materials']; onSelect: (e: ThreeEvent<MouseEvent>) => void }) {
  const builder = o.imageDataUrl ? 'image' : getAsset(o.assetId)?.builder ?? 'box';
  return (
    <group name={'obj:' + o.id} position={[o.x, elevation + o.elevation, o.y]} rotation={[0, o.rotation, 0]} onClick={onSelect}>
      <FurnitureModel o={o} builder={builder} material={o.materialId ? materials[o.materialId] : undefined} />
      {selected && (
        <lineSegments position={[0, o.dims.h / 2, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(o.dims.w + 0.04, o.dims.h + 0.04, o.dims.d + 0.04)]} />
          <lineBasicMaterial color={SEL} />
        </lineSegments>
      )}
    </group>
  );
}

function Gizmo({ mode }: { mode: 'translate' | 'rotate' }) {
  const sel = useEditor((s) => s.selection);
  const mutate = useEditor((s) => s.mutate);
  const { scene } = useThree();
  const [target, setTarget] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (sel?.kind !== 'object') { setTarget(null); return; }
    // wait one frame so the object is mounted
    const t = requestAnimationFrame(() => setTarget(scene.getObjectByName('obj:' + sel.id) ?? null));
    return () => cancelAnimationFrame(t);
  }, [sel, scene]);
  if (!target || sel?.kind !== 'object') return null;
  const commit = () => {
    const id = sel.id;
    const p = target.position, r = target.rotation.y;
    mutate((s) => {
      const o = s.objects.find((x) => x.id === id);
      if (!o) return;
      const floor = s.floors.find((f) => f.id === o.floorId);
      o.x = +p.x.toFixed(3); o.y = +p.z.toFixed(3);
      o.elevation = Math.max(0, +(p.y - (floor?.elevation ?? 0)).toFixed(3));
      o.rotation = r;
    }, 'gizmo:' + id);
  };
  return (
    <TransformControls
      object={target}
      mode={mode}
      showX={mode === 'translate'}
      showZ={mode === 'translate'}
      showY={mode === 'rotate'}
      translationSnap={useEditor.getState().gridSnap ? 0.05 : null}
      rotationSnap={useEditor.getState().gridSnap ? Math.PI / 12 : null}
      size={0.8}
      onMouseUp={commit}
    />
  );
}

function CameraRig({ scene }: { scene: Scene }) {
  const preset = useEditor((s) => s.camPreset);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const first = useRef(true);
  useEffect(() => {
    const pts = scene.walls.flatMap((w) => [w.a, w.b]);
    const b = bbox(pts.length ? pts : [{ x: -5, y: -4 }, { x: 5, y: 4 }]);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 6.5);
    const pos: Record<string, [number, number, number]> = {
      perspective: [cx + size * 0.95, size * 0.8, cz + size * 1.25],
      dollhouse: [cx + size * 0.55, size * 1.55, cz + size * 0.95],
      top: [cx, size * 1.6, cz + 0.001],
      front: [cx, 1.6, cz + size * 1.3],
    };
    const p = pos[preset.name];
    camera.position.set(...p);
    if (controls) { controls.target.set(cx, preset.name === 'front' ? 1.2 : 0, cz); controls.update(); }
    else camera.lookAt(cx, 0, cz);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.n, controls]);
  return null;
}

function Registrar() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    registerViewport({ gl, scene, camera });
    return () => registerViewport(null);
  }, [gl, scene, camera]);
  return null;
}

/** Shared input state so on-screen touch controls can drive the walker. */
export const walkInput = { keys: {} as Record<string, boolean>, look: { dx: 0, dy: 0 } };

/** First-person walkthrough with wall collision (doors are passable). */
function Walker({ scene, floorElev }: { scene: Scene; floorElev: number }) {
  const { camera, gl } = useThree();
  const activeFloor = useEditor((s) => s.activeFloorId);
  const locked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  // (re)spawn in the middle of the largest room whenever the floor changes
  useEffect(() => {
    const rooms = scene.rooms.filter((r) => r.floorId === activeFloor).sort((a, b) => {
      const ba = bbox(a.polygon), bb = bbox(b.polygon);
      return (bb.maxX - bb.minX) * (bb.maxY - bb.minY) - (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
    });
    const start = rooms[0] ? bbox(rooms[0].polygon) : { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    camera.position.set((start.minX + start.maxX) / 2, floorElev + 1.6, (start.minY + start.maxY) / 2);
    camera.lookAt((start.minX + start.maxX) / 2, floorElev + 1.6, (start.minY + start.maxY) / 2 + 1);
    euler.current.setFromQuaternion(camera.quaternion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloor, floorElev]);
  useEffect(() => {
    const editable = (e: Event) => !!(e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]');
    const down = (e: KeyboardEvent) => { if (!editable(e) && (locked.current || walkInput.keys.__touch)) walkInput.keys[e.code] = true; };
    const up = (e: KeyboardEvent) => { walkInput.keys[e.code] = false; };
    const clear = () => { for (const k of Object.keys(walkInput.keys)) if (k !== '__touch') walkInput.keys[k] = false; };
    const onLock = () => { locked.current = document.pointerLockElement === gl.domElement; if (!locked.current) clear(); };
    const vis = () => { if (document.hidden) clear(); };
    // touch / mouse-drag look when pointer lock is unavailable
    let last: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { if (e.pointerType === 'touch') { walkInput.keys.__touch = true; last = { x: e.clientX, y: e.clientY }; } };
    const pm = (e: PointerEvent) => { if (last && e.pointerType === 'touch') { walkInput.look.dx += e.clientX - last.x; walkInput.look.dy += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; } };
    const pu = () => { last = null; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', vis);
    document.addEventListener('pointerlockchange', onLock);
    gl.domElement.addEventListener('pointerdown', pd);
    gl.domElement.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      clear();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', vis); document.removeEventListener('pointerlockchange', onLock);
      gl.domElement.removeEventListener('pointerdown', pd); gl.domElement.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu);
    };
  }, [gl]);
  const walls = useMemo(() => scene.walls.filter((w) => w.floorId === activeFloor), [scene.walls, activeFloor]);
  const rooms = useMemo(() => scene.rooms.filter((r) => r.floorId === activeFloor), [scene.rooms, activeFloor]);
  const doorCentres = useMemo(() => scene.openings.flatMap((o) => {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w || o.type !== 'door') return [];
    const n = normalizeOpening(o, w), ang = wallAngle(w);
    return [{ x: w.a.x + Math.cos(ang) * n.offset, y: w.a.y + Math.sin(ang) * n.offset, r: Math.max(0.6, n.width / 2 + 0.35) }];
  }), [scene.openings, walls]);
  useFrame((_, dt) => {
    const look = walkInput.look;
    if (look.dx || look.dy) {
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= look.dx * 0.005;
      euler.current.x = Math.max(-1.3, Math.min(1.3, euler.current.x - look.dy * 0.005));
      camera.quaternion.setFromEuler(euler.current);
      look.dx = 0; look.dy = 0;
    }
    const k = walkInput.keys;
    if (!locked.current && !k.__touch) return;
    const speed = (k.ShiftLeft ? 3.2 : 1.6) * Math.min(dt, 0.05);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) mv.add(fwd);
    if (k.KeyS || k.ArrowDown) mv.sub(fwd);
    if (k.KeyD || k.ArrowRight) mv.add(right);
    if (k.KeyA || k.ArrowLeft) mv.sub(right);
    if (mv.lengthSq() === 0) return;
    mv.normalize().multiplyScalar(speed);
    const tryMove = (dx: number, dz: number) => {
      const nx = camera.position.x + dx, nz = camera.position.z + dz;
      const p = { x: nx, y: nz };
      // stay on a floor: inside some room of this floor (when rooms exist)
      // (door openings bridge the wall-thickness gap between rooms traced from a plan)
      if (rooms.length && !rooms.some((r) => pointInRoomPoly(p, r.polygon)) && !doorCentres.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < d.r)) return false;
      for (const w of walls) {
        const pr = projectOnSegment(p, w.a, w.b);
        if (pr.distance < w.thickness / 2 + 0.25) {
          const along = pr.t * wallLength(w);
          const door = scene.openings.find((o) => {
            if (o.wallId !== w.id || o.type !== 'door') return false;
            const n = normalizeOpening(o, w);
            return Math.abs(n.offset - along) < n.width / 2 - 0.2;
          });
          if (!door) return false;
        }
      }
      camera.position.x = nx; camera.position.z = nz;
      return true;
    };
    if (!tryMove(mv.x, mv.z)) { tryMove(mv.x, 0) || tryMove(0, mv.z); }
  });
  return <PointerLockControls />;
}

function pointInRoomPoly(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Visible fittings for planned electrical points (plates, lights, fans, AC units). Lit ones glow when lights are on. */
function ElecFixture({ e, elevation, top, lightsOn, warm }: { e: ElecPoint; elevation: number; top: number; lightsOn: boolean; warm: THREE.Color }) {
  const m = ELEC[e.kind];
  const glow = lightsOn ? warm : new THREE.Color('#000');
  if (m.mount === 'ceiling') {
    const y = top;
    if (e.kind === 'fan') return (
      <group position={[e.x, y, e.y]}>
        <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[0.012, 0.012, 0.3, 8]} /><meshStandardMaterial color="#cfcac2" /></mesh>
        <mesh position={[0, -0.33, 0]}><cylinderGeometry args={[0.09, 0.11, 0.08, 20]} /><meshStandardMaterial color="#e9e5df" roughness={0.4} /></mesh>
        {[0, 1, 2].map((i) => <mesh key={i} position={[Math.cos((i * 2 * Math.PI) / 3) * 0.42, -0.34, Math.sin((i * 2 * Math.PI) / 3) * 0.42]} rotation={[0, -(i * 2 * Math.PI) / 3, 0]}><boxGeometry args={[0.62, 0.008, 0.11]} /><meshStandardMaterial color="#d9d3ca" roughness={0.5} /></mesh>)}
      </group>
    );
    if (e.kind === 'pendant') return (
      <group position={[e.x, y, e.y]}>
        <mesh position={[0, -0.35, 0]}><cylinderGeometry args={[0.004, 0.004, 0.7, 6]} /><meshStandardMaterial color="#222" /></mesh>
        <mesh position={[0, -0.78, 0]}><coneGeometry args={[0.2, 0.2, 24, 1, true]} /><meshStandardMaterial color="#2a2a2a" side={THREE.DoubleSide} metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, -0.84, 0]}><sphereGeometry args={[0.05, 12, 12]} /><meshStandardMaterial color="#fff" emissive={glow} emissiveIntensity={lightsOn ? 4 : 0} /></mesh>
      </group>
    );
    const r = e.kind === 'downlight' ? 0.06 : 0.22;
    return (
      <mesh position={[e.x, y - 0.006, e.y]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r, 24]} />
        <meshStandardMaterial color="#f4f2ee" emissive={glow} emissiveIntensity={lightsOn ? (e.kind === 'downlight' ? 5 : 2.5) : 0} side={THREE.DoubleSide} />
      </mesh>
    );
  }
  // wall-mounted: plate facing into the room
  const rotY = -(e.facing ?? 0) + Math.PI / 2;
  const y = elevation + e.height;
  let body: React.ReactNode;
  switch (e.kind) {
    case 'ac': body = <><mesh position={[0, 0, 0.11]}><boxGeometry args={[0.9, 0.3, 0.22]} /><meshStandardMaterial color="#f5f5f3" roughness={0.35} /></mesh><mesh position={[0, -0.1, 0.222]}><boxGeometry args={[0.8, 0.03, 0.005]} /><meshStandardMaterial color="#bbb" /></mesh></>; break;
    case 'geyser': body = <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.4, 24]} /><meshStandardMaterial color="#f2f2f0" roughness={0.3} /></mesh>; break;
    case 'exhaust': body = <mesh position={[0, 0, 0.02]}><boxGeometry args={[0.25, 0.25, 0.04]} /><meshStandardMaterial color="#e6e6e6" /></mesh>; break;
    case 'wall-light': body = <mesh position={[0, 0, 0.05]}><boxGeometry args={[0.3, 0.06, 0.08]} /><meshStandardMaterial color="#c9a25b" emissive={glow} emissiveIntensity={lightsOn ? 3 : 0} metalness={0.6} roughness={0.35} /></mesh>; break;
    case 'strip': body = <mesh position={[0, 0, 0.01]}><boxGeometry args={[1.2, 0.012, 0.012]} /><meshStandardMaterial color="#fff" emissive={glow} emissiveIntensity={lightsOn ? 4 : 0} /></mesh>; break;
    case 'cctv': body = <mesh position={[0, 0, 0.06]}><sphereGeometry args={[0.06, 12, 12]} /><meshStandardMaterial color="#e8e8e8" /></mesh>; break;
    default: {
      const g = e.gang ?? (e.kind === 'switchboard' ? 8 : 2);
      const w = e.kind === 'switchboard' || e.kind === 'db' ? Math.max(0.12, g * 0.03) : 0.08 + Math.max(0, g - 2) * 0.03;
      body = <mesh position={[0, 0, 0.006]}><boxGeometry args={[e.kind === 'db' ? 0.35 : w, e.kind === 'db' ? 0.45 : 0.1, 0.012]} /><meshStandardMaterial color={e.kind === 'db' ? '#d6d3cd' : '#fafaf8'} roughness={0.3} /></mesh>;
    }
  }
  return <group position={[e.x, y, e.y]} rotation={[0, rotY, 0]}>{body}</group>;
}

/** Effective lighting for the chosen mode. */
function modeLighting(L: Scene['lighting']) {
  const mode: LightMode = L.mode ?? 'day';
  if (mode === 'evening') return { mode, sun: L.sunIntensity * 0.22, sunEl: Math.min(L.sunElevation, 5), sunAz: L.sunAzimuth, ambient: L.ambient * 0.35, warmth: Math.max(0.85, L.warmth), lights: true };
  if (mode === 'night') return { mode, sun: 0, sunEl: -10, sunAz: L.sunAzimuth, ambient: 0.05, warmth: 0.3, lights: true };
  return { mode, sun: L.sunIntensity, sunEl: L.sunElevation, sunAz: L.sunAzimuth, ambient: L.ambient, warmth: L.warmth, lights: false };
}

function SceneContent({ walk, gizmoMode, showCeilings }: { walk: boolean; gizmoMode: 'translate' | 'rotate'; showCeilings: boolean }) {
  const scene = useEditor((s) => s.project?.scene)!;
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const activeFloorId = useEditor((s) => s.activeFloorId);
  const activeLevel = scene.floors.find((f) => f.id === activeFloorId)?.level ?? 0;
  const floors = scene.floors.filter((f) => f.level <= activeLevel);
  const L = scene.lighting;
  const ML = modeLighting(L);
  const showElectrical = useEditor((s) => s.showElectrical);
  const az = (ML.sunAz * Math.PI) / 180, el = (Math.max(ML.sunEl, 1) * Math.PI) / 180;
  const pts = scene.walls.flatMap((w) => [w.a, w.b]);
  const b = bbox(pts);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 8);
  const sunPos: [number, number, number] = [cx + Math.cos(az) * Math.cos(el) * span * 1.5, Math.sin(el) * span * 1.5, cz + Math.sin(az) * Math.cos(el) * span * 1.5];
  const warm = new THREE.Color('#bcd4ff').lerp(new THREE.Color('#ffd7a3'), ML.warmth);
  const lightsOn = ML.lights || (L.roomLights && (walk || L.sunElevation < 12));
  const fixtureWarm = warmColor(0.75);
  const activeElev = scene.floors.find((f) => f.id === activeFloorId)?.elevation ?? 0;
  const stop = (fn: () => void) => (e: ThreeEvent<MouseEvent>) => { if (walk) return; e.stopPropagation(); fn(); };

  return (
    <>
      <Registrar />
      {ML.mode === 'night' ? <color attach="background" args={['#0b1020']} /> : <Sky sunPosition={sunPos} turbidity={ML.mode === 'evening' ? 10 : 6} rayleigh={ML.mode === 'evening' ? 3 : 1.2} mieCoefficient={0.004} />}
      <hemisphereLight args={[ML.mode === 'night' ? '#3a4a7a' : warm, '#8a8172', ML.ambient]} />
      <ambientLight intensity={ML.ambient * 0.35} color={warm} />
      <directionalLight
        position={sunPos}
        intensity={ML.sun}
        color={warm}
        castShadow
        shadow-mapSize={typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4 ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 5}
        target-position={[cx, 0, cz]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.01, cz]} receiveShadow onClick={() => !walk && select(null)}>
        <planeGeometry args={[span * 6, span * 6]} />
        <meshStandardMaterial color="#cfc8bb" roughness={1} />
      </mesh>
      {!walk && <ContactShadows position={[cx, 0.001, cz]} scale={span * 2} opacity={0.25} blur={2.5} far={3} />}
      {floors.map((f) => (
        <group key={f.id}>
          {f.level > 0 && scene.rooms.filter((r) => r.floorId === f.id).length === 0 && null}
          {scene.rooms.filter((r) => r.floorId === f.id).map((r) => (
            <RoomMesh key={r.id} room={r} materials={scene.materials} elevation={f.elevation} ceilingHeight={f.ceilingHeight}
              showCeiling={walk || showCeilings || f.level < activeLevel} lights={lightsOn}
              lumens={(scene.electrical ?? []).filter((e) => e.floorId === f.id && ELEC[e.kind].light && pointInRoomPoly(e, r.polygon)).reduce((a, e) => a + ELEC[e.kind].light!.lumens, 0)}
              warmth={r.ceiling?.lightWarmth ?? 0.7}
              selected={selection?.kind === 'room' && selection.id === r.id} onSelect={stop(() => select({ kind: 'room', id: r.id }))} />
          ))}
          {scene.walls.filter((w) => w.floorId === f.id).map((w) => (
            <WallMesh key={w.id} wall={w} openings={scene.openings} materials={scene.materials} elevation={f.elevation}
              selected={selection?.kind === 'wall' && selection.id === w.id} onSelect={stop(() => select({ kind: 'wall', id: w.id }))} />
          ))}
          {showElectrical && (scene.electrical ?? []).filter((e) => e.floorId === f.id).map((e) => {
            const room = scene.rooms.find((r) => r.floorId === f.id && pointInRoomPoly(e, r.polygon));
            const drop = room?.ceiling && room.ceiling.type !== 'none' ? room.ceiling.drop : 0;
            return <ElecFixture key={e.id} e={e} elevation={f.elevation} top={f.elevation + f.ceilingHeight - (ELEC[e.kind].kind === 'downlight' ? drop : 0)} lightsOn={lightsOn} warm={fixtureWarm} />;
          })}
          {scene.objects.filter((o) => o.floorId === f.id).map((o) => (
            <ObjectMesh key={o.id} o={o} elevation={f.elevation} materials={scene.materials}
              selected={selection?.kind === 'object' && selection.id === o.id} onSelect={stop(() => select({ kind: 'object', id: o.id }))} />
          ))}
        </group>
      ))}
      {walk ? <Walker scene={scene} floorElev={activeElev} /> : (
        <>
          <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} />
          <CameraRig scene={scene} />
          <Gizmo mode={gizmoMode} />
        </>
      )}
    </>
  );
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
  } catch { return false; }
}

export default function Viewport3D({ walk = false }: { walk?: boolean }) {
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
  const [showCeilings, setShowCeilings] = useState(true);
  const selection = useEditor((s) => s.selection);
  const setCamPreset = useEditor((s) => s.setCamPreset);
  const mode = useEditor((s) => s.project?.scene.lighting.mode ?? 'day');
  const [pano, setPano] = useState<{ url: string; name: string } | null>(null);
  const [panoBusy, setPanoBusy] = useState(false);
  const ok = useMemo(webglAvailable, []);
  const setMode = (m: LightMode) => useEditor.getState().mutate((s) => { s.lighting = { ...s.lighting, mode: m }; }, 'light:mode');

  const takePanorama = async (roomId?: string) => {
    const st = useEditor.getState();
    const sc = st.project!.scene;
    const vp = getViewport();
    if (!vp) return;
    setPanoBusy(true);
    try {
      let pos: THREE.Vector3, fwd: THREE.Vector3, name: string;
      if (walk && !roomId) {
        pos = vp.camera.position.clone();
        fwd = vp.camera.getWorldDirection(new THREE.Vector3());
        const here = sc.rooms.find((r) => r.floorId === st.activeFloorId && pointInRoomPoly({ x: pos.x, y: pos.z }, r.polygon));
        name = here?.name ?? 'walkthrough';
      } else {
        const floorRooms = sc.rooms.filter((r) => r.floorId === st.activeFloorId);
        const room = sc.rooms.find((r) => r.id === roomId) ?? (st.selection?.kind === 'room' ? sc.rooms.find((r) => r.id === st.selection!.id) : undefined)
          ?? [...floorRooms].sort((a, b) => Math.abs(polyArea(b.polygon)) - Math.abs(polyArea(a.polygon)))[0];
        if (!room) { st.toast('Add a room first.', 'info'); return; }
        const f = sc.floors.find((x) => x.id === room.floorId)!;
        const c = centroid(room.polygon), b = bbox(room.polygon);
        pos = new THREE.Vector3(c.x, f.elevation + 1.5, c.y);
        fwd = b.maxX - b.minX > b.maxY - b.minY ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
        name = room.name;
        if (!showCeilings) setShowCeilings(true);
      }
      st.select(null);
      await nextFrames(3);
      setPano({ url: capturePanorama({ position: pos, forward: fwd, width: 4096 }), name });
    } catch (e) { st.toast((e as Error).message, 'error'); } finally { setPanoBusy(false); }
  };
  useEffect(() => {
    const on = (ev: Event) => void takePanorama((ev as CustomEvent<string | undefined>).detail);
    window.addEventListener('archiform:pano', on);
    return () => window.removeEventListener('archiform:pano', on);
  });
  const modeBar = (
    <div className="flex overflow-hidden rounded-md bg-stone-900/80 text-xs backdrop-blur" role="group" aria-label="Lighting mode">
      {(['day', 'evening', 'night'] as const).map((m) => <button key={m} onClick={() => setMode(m)} title={`${m[0].toUpperCase() + m.slice(1)} lighting`} className={`px-2.5 py-1 capitalize ${mode === m ? 'bg-amber-500 text-stone-950' : 'text-stone-200 hover:bg-stone-800'}`}>{m}</button>)}
    </div>
  );
  const panoBtn = <button onClick={() => void takePanorama()} disabled={panoBusy} className="rounded-md bg-stone-900/80 px-2.5 py-1 text-xs text-stone-200 backdrop-blur hover:bg-stone-800 disabled:opacity-50" title={walk ? 'Capture a 360° panorama from where you stand' : 'Capture a 360° panorama from the middle of the selected (or largest) room'}>{panoBusy ? 'Capturing…' : '360°'}</button>;
  if (!ok) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-stone-300">
        <div>
          <p className="font-semibold">3D view needs WebGL.</p>
          <p className="mt-2 text-sm text-stone-400">Enable hardware acceleration in your browser settings or try a current Chrome, Edge, Firefox or Safari. The 2D plan editor still works.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ fov: walk ? 70 : 45, near: 0.05, far: 500, position: [12, 10, 14] }}>
        <Suspense fallback={null}>
          <SceneContent walk={walk} gizmoMode={gizmoMode} showCeilings={showCeilings} />
        </Suspense>
      </Canvas>
      {walk ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/60 px-4 py-2 text-xs text-white">
            <span className="hidden sm:inline">Click the view to look around · W A S D to walk · Shift to run · Esc to release the mouse</span>
            <span className="sm:hidden">Drag to look around · use the arrows to walk</span>
          </div>
          <div className="absolute right-3 top-14 flex gap-1 sm:top-3">{modeBar}{panoBtn}</div>
          <div className="absolute bottom-4 left-4 grid grid-cols-3 gap-1" aria-label="Walk controls">
            {([['', ''], ['ArrowUp', '▲'], ['', ''], ['ArrowLeft', '◀'], ['ArrowDown', '▼'], ['ArrowRight', '▶']] as const).map(([code, label], i) => code ? (
              <button key={i} aria-label={`Walk ${code.replace('Arrow', '').toLowerCase()}`} className="h-12 w-12 touch-none rounded-lg bg-black/60 text-lg text-white active:bg-amber-500"
                onPointerDown={(e) => { e.preventDefault(); walkInput.keys.__touch = true; walkInput.keys[code] = true; }}
                onPointerUp={() => { walkInput.keys[code] = false; }} onPointerLeave={() => { walkInput.keys[code] = false; }} onPointerCancel={() => { walkInput.keys[code] = false; }}>{label}</button>
            ) : <span key={i} />)}
          </div>
        </>
      ) : (
        <div className="absolute left-3 top-3 flex gap-1">
          <button onClick={() => setShowCeilings(!showCeilings)} className={`rounded-md px-2.5 py-1 text-xs backdrop-blur ${showCeilings ? 'bg-amber-500 text-stone-950' : 'bg-stone-900/80 text-stone-200 hover:bg-stone-800'}`} title="Show ceilings & false ceilings (visible from inside rooms)">Ceilings</button>
          {modeBar}
          {panoBtn}
          {(['perspective', 'dollhouse', 'top', 'front'] as const).map((p) => (
            <button key={p} onClick={() => setCamPreset(p)} className="rounded-md bg-stone-900/80 px-2.5 py-1 text-xs capitalize text-stone-200 backdrop-blur hover:bg-stone-800" title={`Camera: ${p}`}>{p}</button>
          ))}
          {selection?.kind === 'object' && (
            <div className="ml-2 flex overflow-hidden rounded-md bg-stone-900/80 text-xs backdrop-blur">
              {(['translate', 'rotate'] as const).map((m) => (
                <button key={m} onClick={() => setGizmoMode(m)} className={`px-2.5 py-1 capitalize ${gizmoMode === m ? 'bg-amber-500 text-stone-950' : 'text-stone-200 hover:bg-stone-800'}`}>{m === 'translate' ? 'Move' : 'Rotate'}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {pano && <Suspense fallback={null}><PanoramaViewer url={pano.url} name={pano.name} onClose={() => setPano(null)} /></Suspense>}
    </div>
  );
}
