import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Download } from 'lucide-react';
import { Btn, Modal } from './ui';
import { downloadDataUrl } from '../lib/capture';

function Sphere({ url }: { url: string }) {
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [url]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[50, 64, 40]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
}
function Fov() {
  const { camera } = useThree();
  useEffect(() => { (camera as THREE.PerspectiveCamera).fov = 75; camera.updateProjectionMatrix(); }, [camera]);
  return null;
}

export default function PanoramaViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <Modal title={`360° view · ${name}`} onClose={onClose} wide>
      <div className="h-[60vh] w-full overflow-hidden rounded-lg bg-black">
        <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }} gl={{ antialias: true }}>
          <Fov />
          <Suspense fallback={null}><Sphere url={url} /></Suspense>
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.35} target={[0, 0, 0]} />
        </Canvas>
      </div>
      <p className="mt-2 text-xs text-stone-400">Drag to look around. The downloaded JPG carries 360° (GPano) tags, so Google Photos, Facebook and VR viewers open it as a panorama.</p>
      <div className="mt-3 flex justify-end gap-2">
        <Btn variant="outline" onClick={onClose}>Close</Btn>
        <Btn variant="primary" onClick={() => downloadDataUrl(url, `${name}-360.jpg`.replace(/[^\w.-]+/g, '_'))}><Download size={14} /> Download 360° JPG</Btn>
      </div>
    </Modal>
  );
}
