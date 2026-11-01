import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObject, Material } from '../lib/types';
import { getMaterialTexture } from './textures';
import type { ModularConfig, ModUnit } from '../lib/types';
import { COUNTERS, MODULAR_ASSETS, SHUTTERS, fitUnits } from '../lib/modular';


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

const flutes = (w: number, h: number, z: number, c: string, y0 = 0, step = 0.05) =>
  Array.from({ length: Math.max(1, Math.floor(w / step)) }).map((_, i, arr) => (
    <mesh key={i} position={[-w / 2 + (w / arr.length) * (i + 0.5), y0 + h / 2, z]} rotation={[0, -Math.PI / 2, 0]} castShadow>
      <cylinderGeometry args={[step * 0.42, step * 0.42, h, 8, 1, false, 0, Math.PI]} />
      <meshStandardMaterial color={c} roughness={0.55} />
    </mesh>
  ));
const Glow = ({ p, s, c = '#ffd9a0', i = 2.2 }: { p: [number, number, number]; s: [number, number, number]; c?: string; i?: number }) => (
  <mesh position={p}><boxGeometry args={s} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={i} toneMapped={false} /></mesh>
);

Object.assign(builders, {
  tvWall: ({ w, h, d, c, a, mat }: P) => (
    <group>
      {/* fluted back panel */}
      <B p={[0, h / 2, -d / 2 + 0.02]} s={[w, h, 0.03]} c={c} mat={mat} />
      <group position={[0, 0, -d / 2 + 0.035]}>{flutes(w, h, 0, c)}</group>
      {/* marble inset behind TV */}
      <B p={[0, h * 0.55, -d / 2 + 0.045]} s={[w * 0.5, h * 0.55, 0.02]} c={a} rough={0.2} />
      {/* floating console */}
      <B p={[0, 0.45, 0]} s={[w * 0.9, 0.32, d - 0.05]} c="#2a2624" rough={0.5} />
      <Glow p={[0, 0.28, 0]} s={[w * 0.88, 0.01, d - 0.08]} />
      {/* TV + backlight */}
      <B p={[0, h * 0.55, -d / 2 + 0.09]} s={[Math.min(1.65, w * 0.45), 0.95, 0.04]} c="#0d0d0f" rough={0.2} metal={0.3} />
      <Glow p={[0, h - 0.05, -d / 2 + 0.06]} s={[w * 0.98, 0.02, 0.02]} i={3} />
    </group>
  ),
  wardrobeSliding: ({ w, h, d, c, a, mat }: P) => {
    const loft = Math.min(0.55, h * 0.2);
    return (
      <group>
        <B p={[0, (h - loft) / 2, 0]} s={[w, h - loft, d]} c={c} mat={mat} />
        <B p={[-w / 4, (h - loft) / 2, d / 2 + 0.01]} s={[w / 2 - 0.01, h - loft - 0.04, 0.02]} c={c} rough={0.35} mat={mat} />
        <B p={[w / 4, (h - loft) / 2, d / 2 + 0.035]} s={[w / 2 - 0.01, h - loft - 0.04, 0.02]} c={c} rough={0.35} mat={mat} />
        <B p={[w / 4, (h - loft) / 2, d / 2 + 0.047]} s={[0.25, h - loft - 0.3, 0.005]} c="#dfe9ee" metal={1} rough={0.05} />
        <B p={[-0.02, (h - loft) / 2, d / 2 + 0.05]} s={[0.02, 0.9, 0.02]} c={a} metal={0.85} rough={0.3} />
        <B p={[0, h - loft / 2, 0]} s={[w, loft - 0.02, d]} c={c} mat={mat} />
        {[0, 1, 2].map((i) => <B key={i} p={[-w / 2 + (w / 3) * (i + 0.5), h - loft / 2, d / 2 + 0.006]} s={[w / 3 - 0.012, loft - 0.04, 0.01]} c={c} rough={0.4} mat={mat} />)}
      </group>
    );
  },
  kitchenRun: ({ w, h, d, c, a, mat }: P) => (
    <group>
      <B p={[0, 0.45, 0]} s={[w, 0.86, d - 0.02]} c={c} mat={mat} />
      <B p={[0, 0.9, 0]} s={[w + 0.02, 0.04, d + 0.02]} c={a} rough={0.2} />
      <B p={[0, 1.27, -d / 2 + 0.01]} s={[w, 0.7, 0.02]} c={a} rough={0.2} />{/* full-height backsplash */}
      <B p={[0, h - 0.35, -d / 2 + 0.19]} s={[w, 0.7, 0.36]} c={c} mat={mat} />
      <Glow p={[0, h - 0.71, -d / 2 + 0.3]} s={[w * 0.95, 0.01, 0.02]} c="#fff3dc" i={2} />
      <B p={[-w * 0.2, 0.93, 0]} s={[0.6, 0.02, 0.5]} c="#111" rough={0.3} />{/* hob */}
      <B p={[-w * 0.2, h - 0.85, -d / 2 + 0.25]} s={[0.7, 0.35, 0.45]} c="#bfc3c7" metal={0.8} rough={0.3} />{/* chimney */}
      <B p={[w * 0.25, 0.9, 0.02]} s={[0.6, 0.03, 0.42]} c="#9aa1a6" metal={0.9} rough={0.2} />{/* sink */}
      {Array.from({ length: Math.max(1, Math.round(w / 0.6)) }).map((_, i, arr) => (
        <B key={i} p={[-w / 2 + (w / arr.length) * (i + 0.5), 0.45, d / 2 - 0.005]} s={[w / arr.length - 0.012, 0.8, 0.012]} c={c} rough={0.4} mat={mat} />
      ))}
    </group>
  ),
  kitchenL: (p: P) => {
    const run = builders.kitchenRun as (q: P) => React.ReactNode;
    const depth = 0.62;
    return (
      <group>
        <group position={[0, 0, -p.d / 2 + depth / 2]}>{run({ ...p, d: depth })}</group>
        <group position={[-p.w / 2 + depth / 2, 0, depth / 2]} rotation={[0, Math.PI / 2, 0]}>{run({ ...p, w: p.d - depth, d: depth })}</group>
      </group>
    );
  },
  floatingShelves: ({ w, h, d, c, mat }: P) => (
    <group>{[0, 1, 2].map((i) => <B key={i} p={[i === 1 ? w * 0.1 : 0, (h / 2.5) * i + 0.02, 0]} s={[i === 1 ? w * 0.8 : w, 0.04, d]} c={c} mat={mat} />)}
      <B p={[-w / 2 + 0.2, 0.12, 0]} s={[0.12, 0.18, 0.12]} c="#cfc6b8" /><B p={[w / 2 - 0.25, h / 2.5 + 0.13, 0]} s={[0.18, 0.2, 0.15]} c="#4f7a4a" />
    </group>
  ),
  bookWall: ({ w, h, d, c, a, mat }: P) => {
    const cols = Math.max(2, Math.round(w / 0.6)), rows = Math.max(3, Math.round(h / 0.45));
    return (
      <group>
        <B p={[0, h / 2, -d / 2 + 0.01]} s={[w, h, 0.02]} c={c} mat={mat} />
        {Array.from({ length: cols + 1 }).map((_, i) => <B key={'v' + i} p={[-w / 2 + (w / cols) * i, h / 2, 0]} s={[0.03, h, d]} c={c} mat={mat} />)}
        {Array.from({ length: rows + 1 }).map((_, i) => <B key={'h' + i} p={[0, (h / rows) * i + 0.015, 0]} s={[w, 0.03, d]} c={c} mat={mat} />)}
        {Array.from({ length: rows }).map((_, r) => <Glow key={'g' + r} p={[0, (h / rows) * (r + 1) - 0.01, d / 2 - 0.05]} s={[w - 0.04, 0.005, 0.01]} c={a} i={2.5} />)}
      </group>
    );
  },
  crockery: ({ w, h, d, c, a, mat }: P) => (
    <group>
      <B p={[0, 0.45, 0]} s={[w, 0.9, d]} c={c} mat={mat} />
      <B p={[0, 0.92, 0]} s={[w + 0.02, 0.03, d + 0.02]} c="#ecebe8" rough={0.2} />
      <B p={[0, 0.95 + (h - 0.95) / 2, -0.05]} s={[w, h - 0.95, d - 0.12]} c={c} mat={mat} />
      <B p={[0, 0.95 + (h - 0.95) / 2, d / 2 - 0.1]} s={[w - 0.06, h - 1.0, 0.01]} c={a} opacity={0.35} rough={0.05} />
      <Glow p={[0, h - 0.04, -0.05]} s={[w - 0.08, 0.01, 0.2]} />
    </group>
  ),
  studyUnit: ({ w, h, d, c, a, mat }: P) => (
    <group>
      <B p={[0, 0.74, 0]} s={[w, 0.04, d]} c={c} mat={mat} />
      <B p={[-w / 2 + 0.22, 0.36, 0]} s={[0.42, 0.72, d - 0.04]} c={a} />
      <B p={[w / 2 - 0.02, 0.36, 0]} s={[0.04, 0.72, d - 0.04]} c={c} mat={mat} />
      <B p={[0, h - 0.25, -d / 2 + 0.17]} s={[w, 0.5, 0.34]} c={a} />
      <B p={[0, 1.2, -d / 2 + 0.12]} s={[w * 0.8, 0.03, 0.24]} c={c} mat={mat} />
      <Glow p={[0, h - 0.51, -d / 2 + 0.25]} s={[w * 0.9, 0.01, 0.02]} c="#fff3dc" />
    </group>
  ),
  dressing: ({ w, h, d, c, a, mat }: P) => (
    <group>
      <B p={[0, 0.38, 0]} s={[w, 0.76, d]} c={c} mat={mat} />
      <B p={[0, 1.3, -d / 2 + 0.03]} s={[w * 0.7, h - 1.0, 0.03]} c="#dfe9ee" metal={1} rough={0.05} />
      <Glow p={[0, h - 0.05, -d / 2 + 0.05]} s={[w * 0.7, 0.02, 0.02]} />
      <B p={[0, 0.6, d / 2 + 0.01]} s={[w * 0.3, 0.015, 0.015]} c={a} metal={0.85} />
    </group>
  ),
  jaali: ({ w, h, d, c, mat }: P) => {
    const n = Math.max(4, Math.round(w / 0.15)), m = Math.max(8, Math.round(h / 0.15));
    return (
      <group>
        <B p={[0, h / 2, 0]} s={[w, 0.06, d]} c={c} mat={mat} /><B p={[0, h - 0.03, 0]} s={[w, 0.06, d]} c={c} mat={mat} /><B p={[0, 0.03, 0]} s={[w, 0.06, d]} c={c} mat={mat} />
        {Array.from({ length: n + 1 }).map((_, i) => <B key={'v' + i} p={[-w / 2 + (w / n) * i, h / 2, 0]} s={[0.025, h, d]} c={c} mat={mat} />)}
        {Array.from({ length: m + 1 }).map((_, i) => <B key={'h' + i} p={[0, (h / m) * i, 0]} s={[w, 0.025, d]} c={c} mat={mat} />)}
      </group>
    );
  },
  glassPartition: ({ w, h, d, c, a }: P) => (
    <group>
      <B p={[0, h / 2, 0]} s={[w, h, d * 0.3]} c={a} opacity={0.45} rough={0.3} />
      {[-w / 2, w / 2].map((x, i) => <B key={i} p={[x, h / 2, 0]} s={[0.03, h, d]} c={c} metal={0.7} rough={0.4} />)}
      {[0.015, h - 0.015, h * 0.45].map((y, i) => <B key={'r' + i} p={[0, y, 0]} s={[w, 0.03, d]} c={c} metal={0.7} rough={0.4} />)}
    </group>
  ),
  featurePanel: ({ w, h, d, c, mat }: P) => (
    <group><B p={[0, h / 2, 0]} s={[w, h, d * 0.5]} c={c} mat={mat} /><group position={[0, 0, d * 0.25]}>{flutes(w, h, 0, c)}</group></group>
  ),
  curtains: ({ w, h, d, c, a, mat }: P) => (
    <group>
      <Cy p={[0, h - 0.06, 0]} r={0.012} h={w + 0.2} c={a} metal={0.8} />
      {[-1, 1].map((sgn) => (
        <group key={sgn} position={[sgn * w * 0.3, 0, 0]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} position={[(-0.5 + i / 5) * w * 0.32, (h - 0.1) / 2, (i % 2) * 0.04 - 0.02]} castShadow>
              <cylinderGeometry args={[0.035, 0.045, h - 0.1, 10]} />
              <Mat c={c} rough={1} mat={mat} />
            </mesh>
          ))}
        </group>
      ))}
      <B p={[0, h - 0.06, 0]} s={[0.001, 0.001, d]} c={c} />
    </group>
  ),
  blind: ({ w, h, c }: P) => (
    <group>
      <Cy p={[0, h - 0.04, 0]} r={0.04} h={w} c={c} />
      <B p={[0, h * 0.62, 0.02]} s={[w - 0.04, h * 0.72, 0.006]} c={c} rough={1} />
    </group>
  ),
  chandelier: ({ w, h, c }: P) => (
    <group>
      <Cy p={[0, h * 0.8, 0]} r={0.005} h={h * 0.4} c="#111" />
      {[0, 1].map((tier) => Array.from({ length: 8 - tier * 3 }).map((_, i, arr) => {
        const ang = (i / arr.length) * Math.PI * 2, rad = (w / 2) * (1 - tier * 0.45);
        return (
          <group key={`${tier}-${i}`} position={[Math.cos(ang) * rad, h * (0.25 + tier * 0.2), Math.sin(ang) * rad]}>
            <mesh><sphereGeometry args={[0.035, 10, 8]} /><meshStandardMaterial color="#fff3dc" emissive="#ffd9a0" emissiveIntensity={2.5} toneMapped={false} /></mesh>
            <Cy p={[0, 0.06, 0]} r={0.008} h={0.1} c={c} metal={0.8} />
          </group>
        );
      }))}
      <mesh position={[0, h * 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[w / 2, 0.012, 8, 40]} /><meshStandardMaterial color={c} metalness={0.85} roughness={0.3} /></mesh>
      <pointLight position={[0, h * 0.3, 0]} intensity={1.2} distance={6} color="#ffd9a0" />
    </group>
  ),
});

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
      {/* amber outline marks the object as an estimate */}
      {o.estimated && <lineSegments position={[0, h / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w + 0.01, h + 0.01, d + 0.01)]} />
        <lineBasicMaterial color="#f59e0b" />
      </lineSegments>}
    </group>
  );
}

export function FurnitureModel({ o, builder, material }: { o: SceneObject; builder: string; material?: Material }) {
  if (o.imageDataUrl || builder === 'image') return <ImageProxy o={o} />;
  if (o.modular && MODULAR_ASSETS[o.assetId]) return <ModularModel o={o} />;
  const fn = builders[builder] ?? builders.box;
  return <>{fn({ w: o.dims.w, h: o.dims.h, d: o.dims.d, c: o.colorHex, a: o.accentHex ?? '#2a2a2a', mat: material })}</>;
}

// ───────────────────────── modular kitchens & wardrobes ─────────────────────────

function Front({ x, y, z, w, h, c, cfg, glass, mirror }: { x: number; y: number; z: number; w: number; h: number; c: string; cfg: ModularConfig; glass?: boolean; mirror?: boolean }) {
  const rough = SHUTTERS[cfg.shutter].rough;
  const isGlass = glass || cfg.shutter === 'glass';
  return (
    <group>
      {isGlass ? (
        <>
          <B p={[x, y, z]} s={[w, h, 0.004]} c="#9fb4b8" rough={0.05} metal={0.2} opacity={0.55} />
          <B p={[x, y + h / 2 - 0.01, z + 0.006]} s={[w, 0.02, 0.012]} c="#2b2b2b" metal={0.7} rough={0.35} />
          <B p={[x, y - h / 2 + 0.01, z + 0.006]} s={[w, 0.02, 0.012]} c="#2b2b2b" metal={0.7} rough={0.35} />
          <B p={[x - w / 2 + 0.01, y, z + 0.006]} s={[0.02, h, 0.012]} c="#2b2b2b" metal={0.7} rough={0.35} />
          <B p={[x + w / 2 - 0.01, y, z + 0.006]} s={[0.02, h, 0.012]} c="#2b2b2b" metal={0.7} rough={0.35} />
        </>
      ) : <B p={[x, y, z]} s={[w, h, 0.018]} c={c} rough={rough} metal={cfg.shutter === 'acrylic' ? 0.05 : 0} />}
      {mirror && <B p={[x, y, z + 0.011]} s={[w * 0.82, h * 0.86, 0.004]} c="#dfe9ee" metal={1} rough={0.04} />}
    </group>
  );
}
/** Handle for a front of size w×h centred at (x, y); `top` puts it on the top edge (base units). */
function Handle({ x, y, z, w, h, cfg, top, side = 1 }: { x: number; y: number; z: number; w: number; h: number; cfg: ModularConfig; top?: boolean; side?: number }) {
  const metal = '#b9b6b0';
  switch (cfg.handle) {
    case 'profile': return <B p={[x, top ? y + h / 2 - 0.012 : y, z + 0.012]} s={top ? [w * 0.98, 0.022, 0.014] : [0.022, h * 0.9, 0.014]} c={metal} metal={0.9} rough={0.3} />;
    case 'gola': return <B p={[x, y + h / 2 + 0.012, z - 0.012]} s={[w, 0.03, 0.03]} c="#1d1d1f" rough={0.6} />;
    case 'knob': return <Cy p={[x + (top ? 0 : side * (w / 2 - 0.05)), top ? y + h / 2 - 0.05 : y, z + 0.02]} r={0.014} h={0.025} c={metal} metal={0.9} rough={0.3} />;
    case 'bar': return <B p={[x + (top ? 0 : side * (w / 2 - 0.04)), top ? y + h / 2 - 0.05 : y, z + 0.022]} s={top ? [Math.min(0.32, w * 0.6), 0.014, 0.014] : [0.014, Math.min(0.5, h * 0.4), 0.014]} c="#2a2a2a" metal={0.8} rough={0.35} />;
    default: return null;
  }
}

/** Cabinet body: solid when closed (cheap), hollow shell when the interior is shown. */
function Carcass({ p, s, c, open }: { p: [number, number, number]; s: [number, number, number]; c: string; open?: boolean }) {
  if (!open) return <B p={p} s={s} c={c} />;
  const [x, y, z] = p, [w, h, d] = s, t = 0.018;
  return (
    <group>
      <B p={[x, y, z - d / 2 + 0.004]} s={[w, h, 0.008]} c="#cfc7b9" />
      <B p={[x - w / 2 + t / 2, y, z]} s={[t, h, d]} c={c} />
      <B p={[x + w / 2 - t / 2, y, z]} s={[t, h, d]} c={c} />
      <B p={[x, y + h / 2 - t / 2, z]} s={[w, t, d]} c={c} />
      <B p={[x, y - h / 2 + t / 2, z]} s={[w, t, d]} c={c} />
    </group>
  );
}

function KitchenRunModular({ w, d, h, cfg, units, c, upper }: { w: number; d: number; h: number; cfg: ModularConfig; units: ModUnit[]; c: string; upper: string }) {
  const zF = d / 2 - 0.01;
  const counterHex = cfg.counterHex ?? (cfg.counter ? COUNTERS[cfg.counter].hex : '#ecebe8');
  const items: React.ReactNode[] = [];
  const inner = '#d8d2c6';
  let x0 = -w / 2;
  for (const u of fitUnits(units, w)) {
    const cx = x0 + u.width / 2, uw = u.width - 0.004;
    const key = u.id;
    const doors = uw > 0.5 ? 2 : 1;
    if (u.type === 'tall') {
      items.push(<group key={key}>
        <B p={[cx, 0.05, 0]} s={[uw, 0.1, d - 0.08]} c="#2a2826" />
        <Carcass p={[cx, 1.15, -0.02]} s={[uw, 2.1, d - 0.04]} c={inner} open={cfg.open} />
        {!cfg.open && <>{[0.65, 1.67].map((yy, i) => <group key={i}><Front x={cx} y={yy} z={zF} w={uw - 0.006} h={i ? 0.96 : 1.08} c={c} cfg={cfg} /><Handle x={cx} y={yy} z={zF} w={uw} h={i ? 0.96 : 1.08} cfg={cfg} side={-1} /></group>)}</>}
        {cfg.open && [0.5, 0.95, 1.4, 1.85].map((yy) => <B key={yy} p={[cx, yy, 0]} s={[uw - 0.04, 0.018, d - 0.1]} c={inner} />)}
      </group>);
      x0 += u.width; continue;
    }
    // base cabinet
    items.push(<B key={key + 'p'} p={[cx, 0.05, -0.03]} s={[uw, 0.1, d - 0.1]} c="#2a2826" />);
    items.push(<Carcass key={key + 'c'} p={[cx, 0.46, -0.02]} s={[uw, 0.72, d - 0.06]} c={inner} open={cfg.open || u.type === 'open'} />);
    const fy = 0.46, fh = 0.72;
    if (!cfg.open && u.type !== 'open') {
      if (u.type === 'drawers' || u.type === 'hob') {
        const n = u.drawers ?? (u.type === 'hob' ? 2 : 3);
        for (let i = 0; i < n; i++) {
          const dh = fh / n, yy = 0.1 + dh * (i + 0.5);
          items.push(<group key={key + 'd' + i}><Front x={cx} y={yy} z={zF} w={uw - 0.006} h={dh - 0.006} c={c} cfg={cfg} /><Handle x={cx} y={yy} z={zF} w={uw} h={dh} cfg={cfg} top /></group>);
        }
      } else if (u.type === 'appliance') {
        items.push(<group key={key + 'ap'}><B p={[cx, fy + 0.05, zF]} s={[uw - 0.02, fh - 0.16, 0.02]} c="#1b1c1e" rough={0.15} metal={0.4} /><B p={[cx, fy + 0.25, zF + 0.025]} s={[uw * 0.7, 0.02, 0.02]} c="#b9b6b0" metal={0.9} rough={0.3} /><B p={[cx, 0.15, zF]} s={[uw - 0.006, 0.09, 0.018]} c={c} rough={SHUTTERS[cfg.shutter].rough} /></group>);
      } else {
        for (let i = 0; i < doors; i++) {
          const dw = uw / doors, xx = cx - uw / 2 + dw * (i + 0.5);
          items.push(<group key={key + 's' + i}><Front x={xx} y={fy} z={zF} w={dw - 0.006} h={fh - 0.006} c={c} cfg={cfg} /><Handle x={xx} y={fy} z={zF} w={dw} h={fh} cfg={cfg} top side={i ? -1 : 1} /></group>);
        }
      }
    } else items.push(<B key={key + 'sh'} p={[cx, 0.46, 0]} s={[uw - 0.04, 0.018, d - 0.12]} c={inner} />);
    // counter-top accessories
    if (u.type === 'sink') items.push(<group key={key + 'sk'}><B p={[cx, 0.905, 0.02]} s={[Math.min(0.75, uw * 0.85), 0.012, 0.42]} c="#9aa1a6" metal={0.9} rough={0.2} /><Cy p={[cx, 1.05, -d / 2 + 0.12]} r={0.012} h={0.28} c="#c7c9cc" metal={0.95} rough={0.2} /></group>);
    if (u.type === 'hob') items.push(<group key={key + 'hb'}><B p={[cx, 0.91, 0.02]} s={[Math.min(0.78, uw * 0.9), 0.01, 0.5]} c="#0f0f10" rough={0.15} />{[-1, 1].map((sx) => <Cy key={sx} p={[cx + sx * 0.16, 0.92, 0.02]} r={0.08} h={0.01} c="#333" />)}
      <B p={[cx, h - 0.5, -d / 2 + 0.25]} s={[Math.min(0.9, uw), 0.12, 0.48]} c="#bfc3c7" metal={0.8} rough={0.3} /><B p={[cx, h - 0.2, -d / 2 + 0.14]} s={[0.28, 0.48, 0.24]} c="#bfc3c7" metal={0.8} rough={0.3} /></group>);
    // wall units
    if (cfg.wallUnits && u.type !== 'hob') {
      const wy = 1.8, wh = 0.7, wz = -d / 2 + 0.175;
      items.push(<Carcass key={key + 'w'} p={[cx, wy, wz - 0.01]} s={[uw, wh, 0.33]} c={inner} open={cfg.open} />);
      if (cfg.open) items.push(<B key={key + 'ws'} p={[cx, wy, wz]} s={[uw - 0.04, 0.018, 0.29]} c={inner} />);
      if (!cfg.open) for (let i = 0; i < doors; i++) {
        const dw = uw / doors, xx = cx - uw / 2 + dw * (i + 0.5);
        items.push(<group key={key + 'wd' + i}><Front x={xx} y={wy} z={wz + 0.165} w={dw - 0.006} h={wh - 0.006} c={upper} cfg={cfg} glass={u.type === 'open'} /><Handle x={xx} y={wy - wh / 2 + 0.06} z={wz + 0.165} w={dw} h={0.1} cfg={cfg} side={i ? -1 : 1} /></group>);
      }
    }
    x0 += u.width;
  }
  // counter over base units (one slab per continuous stretch), backsplash, under-cabinet light, loft
  const fitted = fitUnits(units, w);
  let sx = -w / 2, start: number | null = null;
  const slabs: [number, number][] = [];
  fitted.forEach((u, i) => { const e = sx + u.width; if (u.type !== 'tall') { if (start === null) start = sx; } else if (start !== null) { slabs.push([start, sx]); start = null; } if (i === fitted.length - 1 && start !== null) slabs.push([start, e]); sx = e; });
  slabs.forEach(([a, b], i) => items.push(<group key={'slab' + i}>
    <B p={[(a + b) / 2, 0.84, 0.005]} s={[b - a + 0.01, 0.04, d + 0.01]} c={counterHex} rough={cfg.counter === 'granite' ? 0.2 : 0.3} />
    <B p={[(a + b) / 2, 1.15, -d / 2 + 0.008]} s={[b - a, 0.58, 0.015]} c={counterHex} rough={0.25} />
    {cfg.wallUnits && <Glow p={[(a + b) / 2, 1.44, -d / 2 + 0.3]} s={[(b - a) * 0.95, 0.008, 0.02]} c="#fff3dc" i={2} />}
  </group>));
  if (cfg.loft && h > 2.4) {
    const lh = h - 2.2, ly = 2.2 + lh / 2;
    items.push(<B key="loft" p={[0, ly, -d / 2 + 0.175]} s={[w, lh - 0.01, 0.33]} c={inner} />);
    if (!cfg.open) fitted.forEach((u, i) => { const cx = -w / 2 + fitted.slice(0, i).reduce((a, q) => a + q.width, 0) + u.width / 2; items.push(<Front key={'lf' + u.id} x={cx} y={ly} z={-d / 2 + 0.34} w={u.width - 0.008} h={lh - 0.016} c={upper} cfg={cfg} />); });
  }
  return <group>{items}</group>;
}

function WardrobeModular({ w, d, h, cfg, c, sliding }: { w: number; d: number; h: number; cfg: ModularConfig; c: string; sliding: boolean }) {
  const loftH = cfg.loft ? Math.min(0.6, h * 0.2) : 0;
  const bodyH = h - 0.075 - loftH, by = 0.075 + bodyH / 2;
  const zF = d / 2 - 0.01;
  const inner = '#e4ded3';
  const units = fitUnits(cfg.units, w);
  const items: React.ReactNode[] = [<B key="pl" p={[0, 0.0375, -0.02]} s={[w, 0.075, d - 0.05]} c="#2a2826" />, <Carcass key="body" p={[0, by, -0.02]} s={[w, bodyH, d - 0.04]} c={inner} open={cfg.open || cfg.units.some((u) => u.type === 'open')} />];
  let x0 = -w / 2;
  const showInside = cfg.open;
  for (const u of units) {
    const cx = x0 + u.width / 2, uw = u.width - 0.004;
    if (showInside || u.type === 'open') {
      items.push(<B key={u.id + 'bk'} p={[cx, by, -d / 2 + 0.03]} s={[uw - 0.03, bodyH - 0.04, 0.01]} c="#cfc7b9" />);
      items.push(<B key={u.id + 'pt'} p={[x0 + u.width - 0.009, by, 0]} s={[0.018, bodyH, d - 0.06]} c={inner} />);
      if (u.type === 'hanging') {
        items.push(<B key={u.id + 'sh'} p={[cx, 0.075 + bodyH - 0.3, 0]} s={[uw - 0.04, 0.018, d - 0.1]} c={inner} />);
        items.push(<Cy key={u.id + 'rod'} p={[cx, 0.075 + bodyH - 0.38, 0]} r={0.012} h={uw - 0.06} c="#c7c9cc" metal={0.9} rough={0.3} />);
        // clothes silhouette
        for (let i = 0; i < Math.max(2, Math.round(uw / 0.09)); i++) items.push(<B key={u.id + 'cl' + i} p={[cx - uw / 2 + 0.06 + i * 0.09, 0.075 + bodyH - 0.38 - 0.45, 0]} s={[0.02, 0.85, 0.42]} c={['#7d8597', '#b38b4d', '#5f6b5a', '#c46a4a'][i % 4]} rough={0.9} />);
      } else if (u.type === 'drawers') {
        const n = u.drawers ?? 3;
        for (let i = 0; i < n; i++) items.push(<B key={u.id + 'dr' + i} p={[cx, 0.2 + i * 0.2, d / 2 - 0.08]} s={[uw - 0.05, 0.17, 0.018]} c={c} rough={0.5} />);
        for (let i = 0; i < 3; i++) items.push(<B key={u.id + 'sf' + i} p={[cx, 0.85 + i * ((bodyH - 0.9) / 3), 0]} s={[uw - 0.04, 0.018, d - 0.1]} c={inner} />);
      } else {
        const n = u.type === 'open' ? 4 : 5;
        for (let i = 1; i <= n; i++) items.push(<B key={u.id + 'sf' + i} p={[cx, 0.075 + (bodyH / (n + 1)) * i, 0]} s={[uw - 0.04, 0.018, d - 0.1]} c={inner} />);
      }
      if (u.type === 'open') items.push(<Glow key={u.id + 'gl'} p={[cx, 0.075 + bodyH - 0.03, d / 2 - 0.06]} s={[uw - 0.06, 0.008, 0.015]} c="#fff1d6" i={1.5} />);
    }
    if (!showInside && !sliding && u.type !== 'open') {
      const doors = uw > 0.55 ? 2 : 1;
      for (let i = 0; i < doors; i++) {
        const dw = uw / doors, xx = cx - uw / 2 + dw * (i + 0.5);
        items.push(<group key={u.id + 'd' + i}><Front x={xx} y={by} z={zF} w={dw - 0.006} h={bodyH - 0.006} c={c} cfg={cfg} mirror={u.type === 'mirror'} /><Handle x={xx} y={by} z={zF} w={dw} h={bodyH} cfg={cfg} side={doors === 2 ? (i ? -1 : 1) : 1} /></group>);
      }
    }
    x0 += u.width;
  }
  if (sliding && !showInside) {
    const n = w > 2.2 ? 3 : 2, pw = w / n + 0.03;
    for (let i = 0; i < n; i++) {
      const xx = -w / 2 + (w / n) * (i + 0.5), z = zF + (i % 2 ? 0.03 : 0.005);
      items.push(<group key={'sl' + i}><Front x={xx} y={by} z={z} w={pw - 0.01} h={bodyH - 0.02} c={c} cfg={cfg} mirror={units.some((u) => u.type === 'mirror') && i === Math.floor(n / 2)} /><B p={[xx + (i === 0 ? pw / 2 - 0.03 : -pw / 2 + 0.03), by, z + 0.014]} s={[0.025, bodyH - 0.04, 0.012]} c="#b9b6b0" metal={0.85} rough={0.3} /></group>);
    }
    items.push(<B key="trk" p={[0, 0.075 + bodyH + 0.01, zF + 0.02]} s={[w, 0.02, 0.06]} c="#9a9a9a" metal={0.8} rough={0.3} />);
  }
  if (cfg.loft) {
    const ly = h - loftH / 2;
    items.push(<B key="loft" p={[0, ly, -0.02]} s={[w, loftH - 0.01, d - 0.04]} c={inner} />);
    if (!showInside) units.forEach((u, i) => { const cx = -w / 2 + units.slice(0, i).reduce((a, q) => a + q.width, 0) + u.width / 2; items.push(<Front key={'lf' + u.id} x={cx} y={ly} z={zF} w={u.width - 0.008} h={loftH - 0.02} c={c} cfg={cfg} />); });
  }
  return <group>{items}</group>;
}

export function ModularModel({ o }: { o: SceneObject }) {
  const cfg = o.modular!;
  const layout = MODULAR_ASSETS[o.assetId]?.layout ?? 'run';
  const c = cfg.shutterHex, upper = cfg.upperHex ?? cfg.shutterHex;
  const { w, h, d } = o.dims;
  if (cfg.kind === 'wardrobe') return <WardrobeModular w={w} d={d} h={h} cfg={cfg} c={c} sliding={layout === 'sliding'} />;
  if (layout === 'l') {
    const depth = 0.62;
    return (
      <group>
        <group position={[0, 0, -d / 2 + depth / 2]}><KitchenRunModular w={w} d={depth} h={h} cfg={cfg} units={cfg.units} c={c} upper={upper} /></group>
        <group position={[-w / 2 + depth / 2, 0, depth / 2]} rotation={[0, Math.PI / 2, 0]}><KitchenRunModular w={Math.max(0.3, d - depth)} d={depth} h={h} cfg={cfg} units={cfg.units2 ?? []} c={c} upper={upper} /></group>
      </group>
    );
  }
  return <KitchenRunModular w={w} d={d} h={h} cfg={{ ...cfg, wallUnits: layout === 'base' ? false : cfg.wallUnits, loft: layout === 'base' ? false : cfg.loft }} units={cfg.units} c={c} upper={upper} />;
}
