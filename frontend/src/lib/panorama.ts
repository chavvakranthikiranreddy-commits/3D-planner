/**
 * 360° panorama export: renders a cube map from an eye position inside the 3D scene and
 * unwraps it to a 2:1 equirectangular JPEG. Google Photos / Facebook / most 360 viewers
 * recognise it as a panorama through the embedded GPano XMP block.
 */
import * as THREE from 'three';
import { getViewport, maxExportSide } from './capture';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
varying vec2 vUv;
uniform samplerCube cube;
uniform float yaw;
void main(){
  float lon = (vUv.x - 0.5) * 6.28318530718 + yaw;
  float lat = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
  gl_FragColor = textureCube(cube, dir);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface PanoOptions { position: THREE.Vector3; /** direction the centre of the image looks at (plan yaw from forward vector) */ forward?: THREE.Vector3; width?: number; hide?: THREE.Object3D[] }

export function capturePanorama(opts: PanoOptions): string {
  const vp = getViewport();
  if (!vp) throw new Error('Open the 3D view first.');
  const { gl, scene, camera } = vp;
  if (gl.getContext().isContextLost()) throw new Error('The 3D view lost its graphics context. Reload the page and try again.');
  const W = Math.min(opts.width ?? 4096, maxExportSide(), 8192), H = W / 2;
  const face = Math.min(2048, Math.max(256, Math.round(W / 4)));
  const rt = new THREE.WebGLCubeRenderTarget(face, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.05, 500, rt);
  cubeCam.position.copy(opts.position);
  const hidden = (opts.hide ?? []).filter((o) => o.visible);
  hidden.forEach((o) => { o.visible = false; });
  const quadScene = new THREE.Scene();
  const f = opts.forward ?? new THREE.Vector3(0, 0, -1);
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { cube: { value: rt.texture }, yaw: { value: Math.atan2(f.x, -f.z) } }, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quadScene.add(quad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const canvas = gl.domElement;
  const prevPR = gl.getPixelRatio(), prevW = canvas.clientWidth, prevH = canvas.clientHeight;
  try {
    scene.add(cubeCam);
    cubeCam.update(gl, scene);
    scene.remove(cubeCam);
    gl.setPixelRatio(1);
    gl.setSize(W, H, false);
    gl.setRenderTarget(null);
    gl.render(quadScene, ortho);
    return withGPano(canvas.toDataURL('image/jpeg', 0.92), W, H);
  } finally {
    hidden.forEach((o) => { o.visible = true; });
    gl.setPixelRatio(prevPR);
    gl.setSize(prevW, prevH, false);
    rt.dispose(); mat.dispose(); quad.geometry.dispose();
    try { gl.render(scene, camera); } catch { /* ignore */ }
  }
}

/** Insert an XMP (GPano) APP1 segment right after the JPEG SOI marker. */
export function withGPano(dataUrl: string, w: number, h: number): string {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const src = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i);
  if (src[0] !== 0xff || src[1] !== 0xd8) return dataUrl;
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:CroppedAreaImageWidthPixels="${w}" GPano:CroppedAreaImageHeightPixels="${h}" GPano:FullPanoWidthPixels="${w}" GPano:FullPanoHeightPixels="${h}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0" GPano:PoseHeadingDegrees="0"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const header = 'http://ns.adobe.com/xap/1.0/\0';
  const payload = new TextEncoder().encode(header + xmp);
  const len = payload.length + 2;
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff; seg[1] = 0xe1; seg[2] = (len >> 8) & 0xff; seg[3] = len & 0xff; seg.set(payload, 4);
  const out = new Uint8Array(src.length + seg.length);
  out.set(src.subarray(0, 2), 0); out.set(seg, 2); out.set(src.subarray(2), 2 + seg.length);
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(s);
}

/** Wait for the 3D view to draw a few frames (after changing lighting mode etc.). */
export const nextFrames = (n = 3) => new Promise<void>((res) => { const step = (k: number) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1))); step(n); });
