/**
 * Photo visualiser engine (runs in the browser, no AI service):
 *  - homographies for perspective-correct textures and for measuring a floor from a photo
 *  - region masks from drawn outlines and/or "magic select" colour flood-fill
 *  - repaint that keeps the photo's light and shadow, optionally smoothing raw plaster blotches
 */
import type { Material, PhotoRegion, Pt, SitePhoto } from './types';

// ───────────────────────── homography ─────────────────────────
export type H3 = number[]; // 3x3 row-major

/** Solve the 3x3 homography mapping src[i] → dst[i] (4 point pairs). */
export function computeHomography(src: Pt[], dst: Pt[]): H3 {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('Degenerate points — the four corners must not be in a straight line.');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}
export function applyH(H: H3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}
export function invertH(H: H3): H3 {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Perspective cannot be inverted.');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const UNIT: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/** Order four points as top-left, top-right, bottom-right, bottom-left (image coordinates). */
export function orderQuad(pts: Pt[]): Pt[] {
  const c = { x: pts.reduce((a, p) => a + p.x, 0) / 4, y: pts.reduce((a, p) => a + p.y, 0) / 4 };
  const s = [...pts].sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x));
  let start = 0, best = Infinity;
  s.forEach((p, i) => { if (p.x + p.y < best) { best = p.x + p.y; start = i; } });
  return [0, 1, 2, 3].map((k) => s[(start + k) % 4]);
}

// ───────────────────────── measuring a room from a photo ─────────────────────────
/**
 * Floor corners clicked in the photo (in order around the floor) + tape measurements → plan coordinates.
 * Corner 1→2 is side A (metres), corner 2→3 is side B. Returns a mapper from photo px to plan metres.
 */
export function floorMapper(corners: Pt[], sideA: number, sideB: number) {
  const Hinv = invertH(computeHomography(UNIT, corners));
  return (p: Pt): Pt => { const uv = applyH(Hinv, p); return { x: uv.x * sideA, y: uv.y * sideB }; };
}

/** Which side of the measured rectangle a floor-level segment lies on, and where along it. */
export function openingOnSide(p1: Pt, p2: Pt, sideA: number, sideB: number) {
  const sides = [
    { side: 0, d: (q: Pt) => Math.abs(q.y), along: (q: Pt) => q.x, len: sideA },
    { side: 1, d: (q: Pt) => Math.abs(q.x - sideA), along: (q: Pt) => q.y, len: sideB },
    { side: 2, d: (q: Pt) => Math.abs(q.y - sideB), along: (q: Pt) => sideA - q.x, len: sideA },
    { side: 3, d: (q: Pt) => Math.abs(q.x), along: (q: Pt) => sideB - q.y, len: sideB },
  ];
  const best = sides.map((s) => ({ s, score: s.d(p1) + s.d(p2) })).sort((a, b) => a.score - b.score)[0].s;
  const a1 = Math.max(0, Math.min(best.len, best.along(p1))), a2 = Math.max(0, Math.min(best.len, best.along(p2)));
  const width = Math.abs(a2 - a1);
  return { side: best.side, center: (a1 + a2) / 2, width, distanceFromWall: (best.d(p1) + best.d(p2)) / 2 };
}

// ───────────────────────── masks ─────────────────────────
export interface Base { w: number; h: number; rgb: Uint8ClampedArray; lum: Float32Array; lumBlur: Float32Array; lumSoft: Float32Array }

export function analyse(img: ImageData): Base {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return { w, h, rgb: data, lum, lumBlur: boxBlur(lum, w, h, Math.max(4, Math.round(Math.max(w, h) / 60))), lumSoft: boxBlur(lum, w, h, 4) };
}

/** Separable box blur via running sums. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Rasterise a polygon to an alpha mask (0–255, anti-aliased). Empty polygon = whole photo. */
export function polygonMask(poly: Pt[], w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  if (poly.length < 3) { out.fill(255); return out; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath(); ctx.fill();
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** Colour flood-fill from a seed, limited to `limit` (alpha mask). Speckles are closed so plaster blotches don't leave holes. */
export function wandMask(base: Base, seed: Pt, tolerance: number, limit: Uint8ClampedArray): Uint8ClampedArray {
  const { w, h, rgb } = base;
  const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x))), sy = Math.max(0, Math.min(h - 1, Math.round(seed.y)));
  // reference colour = average of a small patch around the seed
  let r0 = 0, g0 = 0, b0 = 0, n = 0;
  for (let y = sy - 6; y <= sy + 6; y++) for (let x = sx - 6; x <= sx + 6; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4; r0 += rgb[i]; g0 += rgb[i + 1]; b0 += rgb[i + 2]; n++;
  }
  r0 /= n; g0 /= n; b0 /= n;
  const tol2 = (tolerance * 1.6) ** 2;
  // Edge stop: corners between wall, ceiling and floor are sharp brightness steps, while shadows across one
  // wall change slowly. A step in the blurred brightness across 8 px stops the fill (blur hides plaster speckle).
  const ls = base.lumSoft;
  const edgeT = Math.max(4, tolerance * 0.22);
  const S = 4;
  const m = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  const ok = (p: number) => {
    const i = p * 4;
    const dr = rgb[i] - r0, dg = rgb[i + 1] - g0, db = rgb[i + 2] - b0;
    // weight chroma more than brightness so shadows on the same wall are still included
    const l = (dr + dg + db) / 3;
    return (dr - l) ** 2 * 2 + (dg - l) ** 2 * 2 + (db - l) ** 2 * 2 + l * l * 0.6 <= tol2;
  };
  const step = (p: number, d: number, inRange: boolean, room: boolean) => {
    if (!inRange) return;
    // near the click, ignore edges so a plaster blotch under the cursor can't trap the fill
    if (room && Math.abs((p % w) - sx) + Math.abs(((p / w) | 0) - sy) > 14 && Math.abs(ls[p + S * d] - ls[p - (S - 1) * d]) > edgeT) return;
    stack.push(p + d);
  };
  while (stack.length) {
    const p = stack.pop()!;
    if (m[p] || limit[p] < 128 || !ok(p)) continue;
    m[p] = 1;
    const x = p % w;
    const y = (p / w) | 0;
    step(p, -1, x > 0, x >= S && x < w - S); step(p, 1, x < w - 1, x >= S && x < w - S);
    step(p, -w, y > 0, y >= S && y < h - S); step(p, w, y < h - 1, y >= S && y < h - S);
  }
  fillSmallHoles(m, w, h, Math.round(w * h * 0.004));
  const closed = erode(erode(dilate(dilate(m, w, h), w, h), w, h), w, h);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = closed[i] ? Math.min(255, limit[i]) : 0;
  return out;
}
/** Fill enclosed gaps (plaster blotches, switch boxes) smaller than `maxArea` px; larger ones (windows) stay out. */
function fillSmallHoles(m: Uint8Array, w: number, h: number, maxArea: number) {
  const seen = new Uint8Array(m.length);
  const comp: number[] = [];
  for (let s0 = 0; s0 < m.length; s0++) {
    if (m[s0] || seen[s0]) continue;
    comp.length = 0; let border = false;
    const st = [s0]; seen[s0] = 1;
    while (st.length) {
      const p = st.pop()!; comp.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && !m[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    if (!border && comp.length <= maxArea) for (const p of comp) m[p] = 1;
  }
}
function dilate(m: Uint8Array, w: number, h: number) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] | (x > 0 ? m[i - 1] : 0) | (x < w - 1 ? m[i + 1] : 0) | (y > 0 ? m[i - w] : 0) | (y < h - 1 ? m[i + w] : 0);
  }
  return o;
}
function erode(m: Uint8Array, w: number, h: number) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    o[i] = m[i] & (x > 0 ? m[i - 1] : 1) & (x < w - 1 ? m[i + 1] : 1) & (y > 0 ? m[i - w] : 1) & (y < h - 1 ? m[i + w] : 1);
  }
  return o;
}

export function regionMask(base: Base, r: PhotoRegion): Uint8ClampedArray {
  const limit = polygonMask(r.polygon, base.w, base.h);
  return r.wand ? wandMask(base, r.wand.seed, r.wand.tolerance, limit) : limit;
}

export function maskBBox(mask: Uint8ClampedArray, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ───────────────────────── rendering ─────────────────────────
const hexRgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export interface RenderOpts { materials: Record<string, Material>; pattern: (m: Material) => HTMLCanvasElement; highlight?: string | null }

/**
 * Repaint regions over the photo. Colour = finish colour × (pixel brightness ÷ region's average brightness),
 * so the real light, shadows and corners stay. `smooth` blends towards a blurred brightness to hide raw
 * plaster patches and cement marks.
 */
export function renderRegions(base: Base, regions: PhotoRegion[], opts: RenderOpts, masks = new Map<string, Uint8ClampedArray>()): ImageData {
  const { w, h } = base;
  const out = new ImageData(new Uint8ClampedArray(base.rgb), w, h);
  const o = out.data;
  for (const r of regions) {
    if (!r.visible) continue;
    let mask = masks.get(r.id);
    if (!mask) { mask = regionMask(base, r); masks.set(r.id, mask); }
    // reference brightness = mean of the smoothed/raw mix inside the region
    let sum = 0, cnt = 0;
    for (let i = 0; i < mask.length; i += 3) if (mask[i] > 127) { sum += base.lum[i] * (1 - r.smooth) + base.lumBlur[i] * r.smooth; cnt++; }
    if (!cnt) continue;
    const ref = Math.max(20, sum / cnt * 0.92);
    let tex: { data: Uint8ClampedArray; size: number } | null = null, Hinv: H3 | null = null, tilesU = 1, tilesV = 1;
    let col = [200, 200, 200];
    if (r.finish.kind === 'paint') col = hexRgb(r.finish.hex);
    else {
      const m = opts.materials[r.finish.materialId];
      if (m) {
        const pc = opts.pattern(m);
        tex = { data: pc.getContext('2d')!.getImageData(0, 0, pc.width, pc.height).data, size: pc.width };
        let quad = r.quad && r.quad.length === 4 ? r.quad : null;
        if (!quad) {
          const bb = maskBBox(mask, w, h)!;
          quad = [{ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 }, { x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }];
        }
        Hinv = invertH(computeHomography(UNIT, quad));
        const top = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y), left = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
        tilesU = Math.max(0.2, r.finish.tiles);
        tilesV = tilesU * (left / Math.max(1, top));
      }
    }
    const hl = opts.highlight === r.id;
    for (let p = 0; p < mask.length; p++) {
      const a = mask[p];
      if (!a) continue;
      const shade = Math.max(0.22, Math.min(1.55, (base.lum[p] * (1 - r.smooth) + base.lumBlur[p] * r.smooth) / ref));
      let cr = col[0], cg = col[1], cb = col[2];
      if (tex && Hinv) {
        const x = p % w, y = (p / w) | 0;
        const uv = applyH(Hinv, { x: x + 0.5, y: y + 0.5 });
        let u = (uv.x * tilesU) % 1, v = (uv.y * tilesV) % 1;
        if (u < 0) u += 1; if (v < 0) v += 1;
        const ti = ((Math.floor(v * tex.size) * tex.size) + Math.floor(u * tex.size)) * 4;
        cr = tex.data[ti]; cg = tex.data[ti + 1]; cb = tex.data[ti + 2];
      }
      const i = p * 4, k = a / 255;
      let nr = cr * shade, ng = cg * shade, nb = cb * shade;
      if (hl && a > 127) {
        // selection = thin amber edge, so the chosen colour itself is shown unaltered
        const x = p % w, e = Math.max(2, Math.round(w / 500));
        if (x < e || x >= w - e || p < e * w || p >= (h - e) * w || mask[p - e] < 128 || mask[p + e] < 128 || mask[p - e * w] < 128 || mask[p + e * w] < 128) { nr = 245; ng = 158; nb = 11; }
      }
      o[i] = o[i] * (1 - k) + nr * k;
      o[i + 1] = o[i + 1] * (1 - k) + ng * k;
      o[i + 2] = o[i + 2] * (1 - k) + nb * k;
    }
  }
  return out;
}

/** Guess what a region is from where it sits in the photo. */
export function guessSurface(p: Pt, h: number): PhotoRegion['surface'] {
  return p.y < h * 0.2 ? 'ceiling' : p.y > h * 0.78 ? 'floor' : 'wall';
}

export const defaultFinish = (surface: PhotoRegion['surface']): PhotoRegion['finish'] =>
  surface === 'floor' ? { kind: 'material', materialId: 'tile-vitrified', tiles: 4 } : { kind: 'paint', hex: surface === 'ceiling' ? '#fbfaf7' : '#f2ece1' };

export const photoTitle = (p: SitePhoto) => p.name || 'Photo';
