import type * as THREE from 'three';

/** The 3D viewport registers itself here so render/export jobs can capture frames. */
type Ctx = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera };
let ctx: Ctx | null = null;
export const registerViewport = (c: Ctx | null) => { ctx = c; };
export const hasViewport = () => !!ctx;

/** Largest square the GPU can render off-screen; exports are clamped to it. */
export function maxExportSide(): number {
  if (!ctx) return 4096;
  const g = ctx.gl.getContext();
  return Math.min(g.getParameter(g.MAX_RENDERBUFFER_SIZE) as number, g.getParameter(g.MAX_TEXTURE_SIZE) as number, 8192);
}

/**
 * Render the current camera at an arbitrary resolution and return an image data URL.
 * Renderer size, pixel ratio and camera aspect are always restored, even if rendering or encoding fails.
 */
export function captureFrame(width?: number, height?: number, type: 'image/png' | 'image/jpeg' = 'image/png'): string | null {
  if (!ctx) return null;
  const { gl, scene, camera } = ctx;
  const canvas = gl.domElement;
  if (gl.getContext().isContextLost()) throw new Error('The 3D view lost its graphics context. Reload the page and try again.');
  if (!width || !height) {
    gl.render(scene, camera);
    return canvas.toDataURL(type, 0.92);
  }
  const max = maxExportSide();
  const k = Math.min(1, max / Math.max(width, height));
  width = Math.floor(width * k); height = Math.floor(height * k);
  const prevPR = gl.getPixelRatio();
  const prevW = canvas.clientWidth, prevH = canvas.clientHeight;
  const cam = camera as THREE.PerspectiveCamera;
  const prevAspect = cam.aspect;
  try {
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    if (cam.isPerspectiveCamera) { cam.aspect = width / height; cam.updateProjectionMatrix(); }
    gl.render(scene, camera);
    return canvas.toDataURL(type, 0.92);
  } finally {
    gl.setPixelRatio(prevPR);
    gl.setSize(prevW, prevH, false);
    if (cam.isPerspectiveCamera) { cam.aspect = prevAspect; cam.updateProjectionMatrix(); }
    try { gl.render(scene, camera); } catch { /* ignore */ }
  }
}

export function thumbnail(): string | null {
  try { return captureFrame(480, 300, 'image/jpeg'); } catch { return null; }
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
