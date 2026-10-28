import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, PointerLockControls, Sky, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useEditor } from '../store/editor';
import type { Material, Opening, Room, Scene, SceneObject, Wall } from '../lib/types';
import { bbox, projectOnSegment, segmentWall, wallAngle, wallLength } from '../lib/geometry';
import { getMaterialTexture } from './textures';
import { FurnitureModel } from './Furniture';
import { getAsset } from '../lib/catalog';
import { registerViewport } from '../lib/capture';

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
  const { pieces, holes } = useMemo(() => segmentWall(wall, openings), [wall, openings]);
  const m = materials[wall.materialId];
  const mB = materials[wall.materialIdB ?? wall.materialId] ?? m;
  const lowConf = wall.confidence !== undefined && wall.confidence < 0.6;
  if (L < 0.01) return null;
  return (
    <group position={[wall.a.x, elevation, wall.a.y]} rotation={[0, -ang, 0]} onClick={onSelect}>
      {pieces.map((p, i) => (
        <mesh key={i} position={[(p.s0 + p.s1) / 2, (p.z0 + p.z1) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[p.s1 - p.s0, p.z1 - p.z0, wall.thickness]} />
          {[0, 1, 2, 3, 4, 5].map((fi) => {
            const mm = fi === 5 ? mB : m;
            return <SurfaceMat key={fi} attach={`material-${fi}`} m={lowConf ? { ...mm, colorHex: '#f3c9a0' } : mm} u={p.s1 - p.s0} v={p.z1 - p.z0} selected={selected} />;
          })}
        </mesh>
      ))}
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

function RoomMesh({ room, materials, elevation, ceilingHeight, showCeiling, selected, onSelect, lights }: {
  room: Room; materials: Scene['materials']; elevation: number; ceilingHeight: number; showCeiling: boolean; selected: boolean; onSelect: (e: ThreeEvent<MouseEvent>) => void; lights: boolean;
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
      {showCeiling && (
        <mesh geometry={ceilGeom} rotation={[Math.PI / 2, 0, 0]} position={[0, elevation + ceilingHeight, 0]}>
          <SurfaceMat m={cm} u={1} v={1} side={THREE.DoubleSide} />
        </mesh>
      )}
      {lights && (
        <pointLight position={[(b.minX + b.maxX) / 2, elevation + ceilingHeight - 0.3, (b.minY + b.maxY) / 2]} intensity={1.2} distance={Math.max(6, (b.maxX - b.minX) * 1.6)} decay={1.6} color="#ffe2bd" />
      )}
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
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 4);
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

/** First-person walkthrough with simple wall collision (doors are passable). */
function Walker({ scene, floorElev }: { scene: Scene; floorElev: number }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const activeFloor = useEditor((s) => s.activeFloorId);
  useEffect(() => {
    const rooms = scene.rooms.filter((r) => r.floorId === activeFloor);
    const start = rooms[0] ? bbox(rooms[0].polygon) : { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    camera.position.set((start.minX + start.maxX) / 2, floorElev + 1.6, (start.minY + start.maxY) / 2);
    camera.lookAt((start.minX + start.maxX) / 2, floorElev + 1.6, (start.minY + start.maxY) / 2 + 1);
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const walls = useMemo(() => scene.walls.filter((w) => w.floorId === activeFloor), [scene.walls, activeFloor]);
  useFrame((_, dt) => {
    const k = keys.current;
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
      for (const w of walls) {
        const pr = projectOnSegment(p, w.a, w.b);
        if (pr.distance < w.thickness / 2 + 0.25) {
          // passable if inside a door opening on this wall
          const along = pr.t * wallLength(w);
          const door = scene.openings.find((o) => o.wallId === w.id && o.type === 'door' && Math.abs(o.offset - along) < o.width / 2 - 0.2);
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

function SceneContent({ walk, gizmoMode }: { walk: boolean; gizmoMode: 'translate' | 'rotate' }) {
  const scene = useEditor((s) => s.project?.scene)!;
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const activeFloorId = useEditor((s) => s.activeFloorId);
  const activeLevel = scene.floors.find((f) => f.id === activeFloorId)?.level ?? 0;
  const floors = scene.floors.filter((f) => f.level <= activeLevel);
  const L = scene.lighting;
  const az = (L.sunAzimuth * Math.PI) / 180, el = (L.sunElevation * Math.PI) / 180;
  const pts = scene.walls.flatMap((w) => [w.a, w.b]);
  const b = bbox(pts);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 8);
  const sunPos: [number, number, number] = [cx + Math.cos(az) * Math.cos(el) * span * 1.5, Math.sin(el) * span * 1.5, cz + Math.sin(az) * Math.cos(el) * span * 1.5];
  const warm = new THREE.Color('#bcd4ff').lerp(new THREE.Color('#ffd7a3'), L.warmth);
  const activeElev = scene.floors.find((f) => f.id === activeFloorId)?.elevation ?? 0;
  const stop = (fn: () => void) => (e: ThreeEvent<MouseEvent>) => { if (walk) return; e.stopPropagation(); fn(); };

  return (
    <>
      <Registrar />
      <Sky sunPosition={sunPos} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} />
      <hemisphereLight args={[warm, '#8a8172', L.ambient]} />
      <ambientLight intensity={L.ambient * 0.35} color={warm} />
      <directionalLight
        position={sunPos}
        intensity={L.sunIntensity}
        color={warm}
        castShadow
        shadow-mapSize={[2048, 2048]}
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
              showCeiling={walk || f.level < activeLevel} lights={L.roomLights && (walk || L.sunElevation < 12)}
              selected={selection?.kind === 'room' && selection.id === r.id} onSelect={stop(() => select({ kind: 'room', id: r.id }))} />
          ))}
          {scene.walls.filter((w) => w.floorId === f.id).map((w) => (
            <WallMesh key={w.id} wall={w} openings={scene.openings} materials={scene.materials} elevation={f.elevation}
              selected={selection?.kind === 'wall' && selection.id === w.id} onSelect={stop(() => select({ kind: 'wall', id: w.id }))} />
          ))}
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
  const selection = useEditor((s) => s.selection);
  const setCamPreset = useEditor((s) => s.setCamPreset);
  const ok = useMemo(webglAvailable, []);
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
          <SceneContent walk={walk} gizmoMode={gizmoMode} />
        </Suspense>
      </Canvas>
      {walk ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/60 px-4 py-2 text-xs text-white">
          Click the view to look around · W A S D to walk · Shift to run · Esc to release the mouse
        </div>
      ) : (
        <div className="absolute left-3 top-3 flex gap-1">
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
    </div>
  );
}
