import type * as THREE from 'three';

/** The 3D viewport registers itself here so render/export jobs can capture frames. */
type Ctx = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };
let ctx: Ctx | null = null;
export const registerViewport = (c: Ctx | null) => { ctx = c; };
export const hasViewport = () => !!ctx;

/** Render the current camera at an arbitrary resolution and return a PNG data URL. */
export function captureFrame(width?: number, height?: number, type: 'image/png' | 'image/jpeg' = 'image/png'): string | null {
  if (!ctx) return null;
  const { gl, scene, camera } = ctx;
  const canvas = gl.domElement;
  if (!width || !height) {
    gl.render(scene, camera);
    return canvas.toDataURL(type, 0.92);
  }
  const prevPR = gl.getPixelRatio();
  const prevW = canvas.clientWidth, prevH = canvas.clientHeight;
  const cam = camera as THREE.PerspectiveCamera;
  const prevAspect = cam.aspect;
  gl.setPixelRatio(1);
  gl.setSize(width, height, false);
  if (cam.isPerspectiveCamera) { cam.aspect = width / height; cam.updateProjectionMatrix(); }
  gl.render(scene, camera);
  const url = canvas.toDataURL(type, 0.92);
  gl.setPixelRatio(prevPR);
  gl.setSize(prevW, prevH, false);
  if (cam.isPerspectiveCamera) { cam.aspect = prevAspect; cam.updateProjectionMatrix(); }
  gl.render(scene, camera);
  return url;
}

export function thumbnail(): string | null {
  return captureFrame(480, 300, 'image/jpeg');
}

export function downloadDataUrl(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export function downloadText(text: string, name: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  downloadDataUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
