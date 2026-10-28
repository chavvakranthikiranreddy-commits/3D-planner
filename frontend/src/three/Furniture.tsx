import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject, Material } from '../lib/types';
import { getMaterialTexture } from './textures';

/**
 * Parametric furniture. Every model is built from primitives sized to the object's
 * real dimensions, origin at bottom-centre, front facing +Z.
 */
type P = { w: number; h: number; d: number; c: string; a: string; mat?: Material };

function Mat({ c, rough = 0.7, metal = 0, mat, opacity }: { c: string; rough?: number; metal?: number; mat?: Material; opacity?: number }) {
  const map = mat ? getMaterialTexture(mat) : null;
  return (
    <meshStandardMaterial
      color={mat ? mat.colorHex : c}
      roughness={mat ? mat.roughness : rough}
      metalness={mat ? mat.metalness : metal}
      map={map ?? undefined}
      transparent={opacity !== undefined}
      opacity={opacity ?? 1}
    />
  );
}

function B({ p, s, c, rough, metal, mat, opacity }: { p: [number, number, number]; s: [number, number, number]; c: string; rough?: number; metal?: number; mat?: Material; opacity?: number }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <Mat c={c} rough={rough} metal={metal} mat={mat} opacity={opacity} />
    </mesh>
  );
}
function Cy({ p, r, h, c, r2, rough, metal, seg = 24 }: { p: [number, number, number]; r: number; h: number; c: string; r2?: number; rough?: number; metal?: number; seg?: number }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
      <Mat c={c} rough={rough} metal={metal} />
    </mesh>
  );
}

const legs = (w: number, d: number, h: number, c: string, inset = 0.05, t = 0.04) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
    <B key={i} p={[sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)]} s={[t, h, t]} c={c} rough={0.5} metal={0.2} />
  ));

const builders: Record<string, (p: P) => React.ReactNode> = {
  box: ({ w, h, d, c, mat }) => <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} mat={mat} />,
  sofa: ({ w, h, d, c, mat }) => {
    const seatH = h * 0.5, arm = Math.min(0.18, w * 0.1);
    return (
      <group>
        <B p={[0, 0.06, 0]} s={[w, 0.12, d]} c="#3a3a3a" />
        <B p={[0, seatH * 0.6, 0.05]} s={[w - arm * 2, seatH * 0.55, d - 0.2]} c={c} rough={1} mat={mat} />
        <B p={[0, h * 0.62, -d / 2 + 0.11]} s={[w - arm * 2, h * 0.75, 0.22]} c={c} rough={1} mat={mat} />
        <B p={[-w / 2 + arm / 2, h * 0.36, 0]} s={[arm, h * 0.6, d]} c={c} rough={1} mat={mat} />
        <B p={[w / 2 - arm / 2, h * 0.36, 0]} s={[arm, h * 0.6, d]} c={c} rough={1} mat={mat} />
        {Array.from({ length: Math.max(1, Math.round((w - arm * 2) / 0.65)) }).map((_, i, arr) => {
          const cw = (w - arm * 2) / arr.length;
          return <B key={i} p={[-w / 2 + arm + cw * (i + 0.5), seatH * 0.95, 0.07]} s={[cw - 0.02, 0.12, d - 0.28]} c={c} rough={1} mat={mat} />;
        })}
      </group>
    );
  },
  sectional: ({ w, h, d, c, mat }) => {
    const depth = Math.min(0.95, d * 0.5);
    return (
      <group>
        <B p={[0, h * 0.25, -d / 2 + depth / 2]} s={[w, h * 0.5, depth]} c={c} rough={1} mat={mat} />
        <B p={[0, h * 0.62, -d / 2 + 0.1]} s={[w, h * 0.75, 0.2]} c={c} rough={1} mat={mat} />
        <B p={[w / 2 - depth / 2, h * 0.25, depth / 2]} s={[depth, h * 0.5, d - depth]} c={c} rough={1} mat={mat} />
        <B p={[-w / 2 + 0.09, h * 0.4, -d / 2 + depth / 2]} s={[0.18, h * 0.55, depth]} c={c} rough={1} mat={mat} />
      </group>
    );
  },
  armchair: ({ w, h, d, c, mat }) => (
    <group>
      {legs(w, d, 0.15, '#3b2c20', 0.08)}
      <B p={[0, 0.27, 0.04]} s={[w - 0.2, 0.22, d - 0.15]} c={c} rough={1} mat={mat} />
      <B p={[0, h * 0.6, -d / 2 + 0.09]} s={[w - 0.04, h * 0.65, 0.16]} c={c} rough={1} mat={mat} />
      <B p={[-w / 2 + 0.08, 0.38, 0]} s={[0.14, 0.38, d]} c={c} rough={1} mat={mat} />
      <B p={[w / 2 - 0.08, 0.38, 0]} s={[0.14, 0.38, d]} c={c} rough={1} mat={mat} />
    </group>
  ),
  chair: ({ w, h, d, c, mat }) => (
    <group>
      {legs(w, d, 0.45, c, 0.03, 0.035)}
      <B p={[0, 0.47, 0]} s={[w, 0.05, d]} c={c} mat={mat} />
      <B p={[0, 0.47 + (h - 0.47) / 2, -d / 2 + 0.02]} s={[w, h - 0.47, 0.04]} c={c} mat={mat} />
    </group>
  ),
  stool: ({ w, h, c }) => (
    <group>
      <Cy p={[0, h - 0.03, 0]} r={w / 2} h={0.05} c={c} />
      <Cy p={[0, h / 2, 0]} r={0.025} h={h} c="#777" metal={0.8} rough={0.3} />
      <Cy p={[0, 0.01, 0]} r={w / 2.3} h={0.02} c="#777" metal={0.8} rough={0.3} />
    </group>
  ),
  table: ({ w, h, d, c, mat }) => (
    <group>
      <B p={[0, h - 0.025, 0]} s={[w, 0.05, d]} c={c} rough={0.5} mat={mat} />
      {legs(w, d, h - 0.05, c, 0.06, 0.05)}
    </group>
  ),
  roundTable: ({ w, h, c, a, mat }) => (
    <group>
      <Cy p={[0, h - 0.02, 0]} r={w / 2} h={0.04} c={mat ? mat.colorHex : c} rough={0.4} seg={40} />
      <Cy p={[0, (h - 0.04) / 2, 0]} r={0.04} h={h - 0.04} c={a} metal={0.6} rough={0.35} />
      <Cy p={[0, 0.01, 0]} r={w / 3.2} h={0.02} c={a} metal={0.6} rough={0.35} />
    </group>
  ),
  bed: ({ w, h, d, c, a, mat }) => (
    <group>
      <B p={[0, 0.17, 0.02]} s={[w, 0.3, d - 0.05]} c={c} mat={mat} />
      <B p={[0, 0.4, 0.05]} s={[w - 0.08, 0.2, d - 0.15]} c={a} rough={1} />
      <B p={[0, h / 2, -d / 2 + 0.04]} s={[w + 0.04, h, 0.08]} c={c} mat={mat} />
      <B p={[0, 0.52, 0.35]} s={[w - 0.06, 0.05, d * 0.55]} c={'#9aa8b4'} rough={1} />
      {[-1, 1].map((s) => (w > 1.2 ? <B key={s} p={[s * w / 4, 0.57, -d / 2 + 0.3]} s={[w / 2 - 0.15, 0.12, 0.35]} c="#ffffff" rough={1} /> : null))}
      {w <= 1.2 && <B p={[0, 0.57, -d / 2 + 0.3]} s={[w - 0.2, 0.12, 0.35]} c="#ffffff" rough={1} />}
    </group>
  ),
  cabinet: ({ w, h, d, c, mat }) => {
    const n = Math.max(1, Math.round(w / 0.6));
    return (
      <group>
        <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} mat={mat} />
        {Array.from({ length: n }).map((_, i) => (
          <B key={i} p={[-w / 2 + (w / n) * (i + 0.5), h / 2, d / 2 + 0.006]} s={[w / n - 0.012, h - 0.02, 0.01]} c={c} rough={0.5} mat={mat} />
        ))}
        {Array.from({ length: n }).map((_, i) => (
          <B key={'h' + i} p={[-w / 2 + (w / n) * (i + 0.5), h * 0.85, d / 2 + 0.02]} s={[Math.min(0.12, w / n / 2), 0.015, 0.015]} c="#8a8a8a" metal={0.8} rough={0.3} />
        ))}
      </group>
    );
  },
  wardrobe: ({ w, h, d, c, a, mat }) => {
    const n = Math.max(2, Math.round(w / 0.6));
    return (
      <group>
        <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} mat={mat} />
        {Array.from({ length: n }).map((_, i) => (
          <group key={i}>
            <B p={[-w / 2 + (w / n) * (i + 0.5), h / 2, d / 2 + 0.006]} s={[w / n - 0.01, h - 0.02, 0.012]} c={c} rough={0.45} mat={mat} />
            <B p={[-w / 2 + (w / n) * (i + (i % 2 ? 0.12 : 0.88)), h / 2, d / 2 + 0.025]} s={[0.015, 0.4, 0.015]} c={a} metal={0.85} rough={0.3} />
          </group>
        ))}
      </group>
    );
  },
  shelf: ({ w, h, d, c, mat }) => {
    const n = Math.max(3, Math.round(h / 0.38));
    const books = ['#7b2d26', '#2e4a62', '#d4a94e', '#3c5b3a', '#e7e1d6', '#4a3b5c'];
    return (
      <group>
        <B p={[-w / 2 + 0.015, h / 2, 0]} s={[0.03, h, d]} c={c} mat={mat} />
        <B p={[w / 2 - 0.015, h / 2, 0]} s={[0.03, h, d]} c={c} mat={mat} />
        {Array.from({ length: n + 1 }).map((_, i) => (
          <B key={i} p={[0, (h - 0.03) * (i / n) + 0.015, 0]} s={[w, 0.03, d]} c={c} mat={mat} />
        ))}
        {Array.from({ length: n }).map((_, i) =>
          Array.from({ length: 6 }).map((__, j) => {
            const bh = 0.2 + ((i * 7 + j * 3) % 5) * 0.025;
            return <B key={`${i}-${j}`} p={[-w / 2 + 0.1 + j * 0.07, (h - 0.03) * (i / n) + 0.03 + bh / 2, 0]} s={[0.05, bh, d * 0.75]} c={books[(i + j) % books.length]} />;
          }),
        )}
      </group>
    );
  },
  tvUnit: ({ w, h, d, c, mat }) => (
    <group>
      <B p={[0, h / 2 + 0.08, 0]} s={[w, h - 0.08, d]} c={c} mat={mat} />
      {legs(w, d, 0.08, '#222', 0.08, 0.03)}
      <B p={[0, h + 0.4, -d / 2 + 0.1]} s={[Math.min(1.45, w * 0.8), 0.82, 0.04]} c="#0d0d0f" rough={0.2} metal={0.3} />
    </group>
  ),
  counter: ({ w, h, d, c, a, mat }) => {
    const n = Math.max(1, Math.round(w / 0.6));
    return (
      <group>
        <B p={[0, (h - 0.04) / 2 + 0.05, 0]} s={[w, h - 0.09, d - 0.03]} c={c} mat={mat} />
        <B p={[0, 0.025, 0.02]} s={[w, 0.05, d - 0.1]} c="#2a2a2a" />
        <B p={[0, h - 0.02, 0]} s={[w + 0.02, 0.04, d + 0.02]} c={a} rough={0.25} />
        {Array.from({ length: n }).map((_, i) => (
          <B key={i} p={[-w / 2 + (w / n) * (i + 0.5), h * 0.82, d / 2 - 0.005]} s={[0.14, 0.015, 0.02]} c="#8a8a8a" metal={0.8} rough={0.3} />
        ))}
      </group>
    );
  },
  fridge: ({ w, h, d, c }) => (
    <group>
      <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} metal={0.6} rough={0.35} />
      <B p={[0, h * 0.68, d / 2 + 0.003]} s={[w - 0.01, 0.006, 0.004]} c="#666" />
      <B p={[-w / 2 + 0.06, h * 0.55, d / 2 + 0.03]} s={[0.02, 0.45, 0.03]} c="#999" metal={0.9} rough={0.2} />
    </group>
  ),
  vanity: ({ w, h, d, c, a, mat }) => (
    <group>
      <B p={[0, (h - 0.15) / 2 + 0.15, 0]} s={[w, h - 0.15, d]} c={c} mat={mat} />
      <B p={[0, h + 0.06, 0.02]} s={[w * 0.55, 0.12, d * 0.7]} c={a} rough={0.15} />
      <Cy p={[0, h + 0.2, -d / 2 + 0.08]} r={0.015} h={0.22} c="#c0c0c0" metal={0.9} rough={0.2} />
      <B p={[0, h + 0.75, -d / 2 + 0.01]} s={[w * 0.8, 0.8, 0.02]} c="#cfe0e6" metal={0.9} rough={0.05} />
    </group>
  ),
  toilet: ({ w, h, d, c }) => (
    <group>
      <B p={[0, h - 0.18, -d / 2 + 0.06]} s={[w, 0.36, 0.12]} c={c} rough={0.2} />
      <mesh position={[0, 0.38, 0.03]} scale={[1, 0.5, 1.35]} castShadow>
        <sphereGeometry args={[w / 2, 24, 16]} />
        <Mat c={c} rough={0.15} />
      </mesh>
    </group>
  ),
  shower: ({ w, h, d, c }) => (
    <group>
      <B p={[0, 0.03, 0]} s={[w, 0.06, d]} c="#f5f5f5" rough={0.3} />
      <B p={[0, h / 2, d / 2]} s={[w, h, 0.01]} c={c} rough={0.05} opacity={0.3} />
      <B p={[w / 2, h / 2, 0]} s={[0.01, h, d]} c={c} rough={0.05} opacity={0.3} />
      <Cy p={[0, h - 0.05, -d / 2 + 0.2]} r={0.1} h={0.02} c="#c0c0c0" metal={0.9} rough={0.2} />
    </group>
  ),
  bathtub: ({ w, h, d, c }) => (
    <group>
      <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} rough={0.15} />
      <B p={[0, h - 0.04, 0]} s={[w - 0.12, 0.1, d - 0.12]} c="#d7e6ec" rough={0.05} />
    </group>
  ),
  desk: ({ w, h, d, c, a, mat }) => (
    <group>
      <B p={[0, h - 0.02, 0]} s={[w, 0.04, d]} c={c} mat={mat} />
      <B p={[-w / 2 + 0.03, (h - 0.04) / 2, 0]} s={[0.04, h - 0.04, d - 0.05]} c={a} metal={0.5} />
      <B p={[w / 2 - 0.03, (h - 0.04) / 2, 0]} s={[0.04, h - 0.04, d - 0.05]} c={a} metal={0.5} />
      <B p={[0, h + 0.2, -d / 2 + 0.12]} s={[0.6, 0.36, 0.03]} c="#111" rough={0.2} />
    </group>
  ),
  floorLamp: ({ w, h, c, a }) => (
    <group>
      <Cy p={[0, 0.015, 0]} r={w / 2.4} h={0.03} c={a} metal={0.6} />
      <Cy p={[0, h / 2, 0]} r={0.012} h={h} c={a} metal={0.6} />
      <Cy p={[0, h - 0.15, 0]} r={w / 2} r2={w / 3} h={0.3} c={c} rough={1} />
      <pointLight position={[0, h - 0.2, 0]} intensity={0.6} distance={4} color="#ffd9a8" />
    </group>
  ),
  pendant: ({ w, h, c }) => (
    <group>
      <Cy p={[0, h * 0.75, 0]} r={0.006} h={h * 0.5} c="#111" />
      <mesh position={[0, h * 0.3, 0]} castShadow>
        <sphereGeometry args={[w / 2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={c} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, h * 0.15, 0]} intensity={0.8} distance={5} color="#ffdcaa" />
    </group>
  ),
  rug: ({ w, h, d, c, a, mat }) => (
    <group>
      <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} rough={1} mat={mat} />
      <B p={[0, h + 0.001, 0]} s={[w * 0.8, 0.002, d * 0.75]} c={a} rough={1} />
      <B p={[0, h + 0.002, 0]} s={[w * 0.7, 0.002, d * 0.62]} c={c} rough={1} />
    </group>
  ),
  plant: ({ w, h, c, a }) => (
    <group>
      <Cy p={[0, 0.17, 0]} r={w * 0.3} r2={w * 0.38} h={0.34} c={a} rough={0.9} />
      {Array.from({ length: 7 }).map((_, i) => {
        const ang = (i / 7) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(ang) * w * 0.18, 0.34 + (h - 0.34) * (0.45 + (i % 3) * 0.15), Math.sin(ang) * w * 0.18]} castShadow>
            <icosahedronGeometry args={[w * (0.22 + (i % 2) * 0.06), 0]} />
            <meshStandardMaterial color={i % 2 ? c : '#3f6a3b'} roughness={0.9} flatShading />
          </mesh>
        );
      })}
    </group>
  ),
  frame: ({ w, h, d, c, a }) => (
    <group>
      <B p={[0, h / 2, 0]} s={[w, h, d]} c={a} />
      <B p={[0, h / 2, d / 2 + 0.001]} s={[w - 0.08, h - 0.08, 0.002]} c={c} rough={1} />
      <mesh position={[w * 0.1, h * 0.55, d / 2 + 0.003]}>
        <circleGeometry args={[h * 0.22, 32]} />
        <meshStandardMaterial color="#f0d9a8" roughness={1} />
      </mesh>
    </group>
  ),
  mirror: ({ w, h, c }) => (
    <group position={[0, h / 2, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[w / 2, w / 2, 0.03, 48]} />
        <meshStandardMaterial color={c} metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.017]}>
        <circleGeometry args={[w / 2 - 0.03, 48]} />
        <meshStandardMaterial color="#dfe9ee" metalness={1} roughness={0.04} />
      </mesh>
    </group>
  ),
  pooja: ({ w, h, d, c, a, mat }) => (
    <group>
      <B p={[0, 0.4, 0]} s={[w, 0.8, d]} c={c} mat={mat} />
      <B p={[-w / 2 + 0.03, h * 0.7, 0]} s={[0.06, h * 0.6, d]} c={c} mat={mat} />
      <B p={[w / 2 - 0.03, h * 0.7, 0]} s={[0.06, h * 0.6, d]} c={c} mat={mat} />
      <B p={[0, h - 0.06, 0]} s={[w + 0.06, 0.12, d + 0.04]} c={a} metal={0.6} rough={0.35} />
      <B p={[0, 1.1, 0]} s={[w - 0.06, 0.03, d - 0.02]} c={c} mat={mat} />
      <B p={[0, 1.2, -d / 2 + 0.02]} s={[w - 0.12, 0.5, 0.02]} c={a} metal={0.6} rough={0.35} />
      <pointLight position={[0, 1.4, 0.1]} intensity={0.35} distance={2} color="#ffc070" />
    </group>
  ),
};

/** Product approximation from a reference photo: a dimensioned block with the photo on its front face. */
function ImageProxy({ o }: { o: SceneObject }) {
  const tex = useMemo(() => {
    if (!o.imageDataUrl) return null;
    const t = new THREE.TextureLoader().load(o.imageDataUrl);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [o.imageDataUrl]);
  const { w, h, d } = o.dims;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, Math.max(0.01, d * 0.96)]} />
        <meshStandardMaterial color={o.colorHex} roughness={0.8} />
      </mesh>
      {tex && (
        <mesh position={[0, h / 2, d / 2 + 0.002]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.05} roughness={0.8} />
        </mesh>
      )}
      {/* dashed outline marks the object as an estimate */}
      <lineSegments position={[0, h / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w + 0.01, h + 0.01, d + 0.01)]} />
        <lineBasicMaterial color="#f59e0b" />
      </lineSegments>
    </group>
  );
}

export function FurnitureModel({ o, builder, material }: { o: SceneObject; builder: string; material?: Material }) {
  if (o.imageDataUrl || builder === 'image') return <ImageProxy o={o} />;
  const fn = builders[builder] ?? builders.box;
  return <>{fn({ w: o.dims.w, h: o.dims.h, d: o.dims.d, c: o.colorHex, a: o.accentHex ?? '#2a2a2a', mat: material })}</>;
}
