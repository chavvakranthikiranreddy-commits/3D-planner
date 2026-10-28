import { rgbToHex } from './materials';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Validate by content (magic bytes), not just the file name. */
export async function sniffType(file: File): Promise<'png' | 'jpg' | 'pdf' | 'webp' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return null;
}

export const readAsDataUrl = (file: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('The image could not be decoded.'));
    i.src = src;
  });

/** Downscale so the longest side is ≤ max; returns canvas. */
export function toCanvas(img: CanvasImageSource & { width: number; height: number }, max = 2000, rotate = 0): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = document.createElement('canvas');
  const swap = rotate % 180 !== 0;
  c.width = swap ? h : w; c.height = swap ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/** Render a PDF page to a canvas with pdf.js (loaded lazily). */
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  return doc.numPages;
}
export async function renderPdfPage(data: ArrayBuffer, page: number, maxSide = 2400): Promise<HTMLCanvasElement> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const p = await doc.getPage(page);
  const vp0 = p.getViewport({ scale: 1 });
  const scale = Math.min(4, maxSide / Math.max(vp0.width, vp0.height));
  const vp = p.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return c;
}
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

/**
 * Simple background removal for product shots on plain backgrounds:
 * flood-fills from the borders, clearing pixels close to the sampled corner colour.
 */
export function removeBackground(src: HTMLCanvasElement, tolerance = 38): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data, W = c.width, H = c.height;
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; });
  const ref = corners.reduce((a, b) => [a[0] + b[0] / 4, a[1] + b[1] / 4, a[2] + b[2] / 4], [0, 0, 0]);
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  const tol2 = tolerance * tolerance * 3;
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const dr = d[i] - ref[0], dg = d[i + 1] - ref[1], db = d[i + 2] - ref[2];
    if (dr * dr + dg * dg + db * db > tol2) continue;
    d[i + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Crop canvas to its non-transparent bounding box. */
export function trimTransparent(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const { data, width: W, height: H } = ctx.getImageData(0, 0, src.width, src.height);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 <= x0 || y1 <= y0) return src;
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d')!.drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/** k-means palette extraction (ignores transparent pixels). */
export function extractPalette(src: HTMLCanvasElement, k = 6): string[] {
  const s = toCanvas(src, 120);
  const ctx = s.getContext('2d')!;
  // re-draw source with alpha preserved
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.drawImage(src, 0, 0, s.width, s.height);
  const d = ctx.getImageData(0, 0, s.width, s.height).data;
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
  if (px.length === 0) return [];
  let cents = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  for (let it = 0; it < 10; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, ci) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (dd < bd) { bd = dd; bi = ci; } });
      const s2 = sums[bi]; s2[0] += p[0]; s2[1] += p[1]; s2[2] += p[2]; s2[3]++;
    }
    cents = sums.map((s2, i) => (s2[3] ? [s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3], s2[3]] : [...cents[i], 0]));
  }
  return cents
    .sort((a, b) => (b[3] ?? 0) - (a[3] ?? 0))
    .map((c) => rgbToHex(c[0], c[1], c[2]))
    .filter((h, i, arr) => arr.indexOf(h) === i);
}

/** Average colour of the opaque pixels. */
export function dominantColor(src: HTMLCanvasElement): string {
  return extractPalette(src, 3)[0] ?? '#999999';
}
