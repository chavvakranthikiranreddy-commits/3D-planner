/**
 * In-browser blueprint interpretation (MVP): finds thick horizontal/vertical wall strokes,
 * joins corners, turns short collinear gaps into door/window candidates and finds enclosed
 * rooms. Designed for clean, orthogonal residential plans — every result carries a
 * confidence score and must be reviewed by the user. Works in pixel space; the caller
 * converts to metres using the user-confirmed scale (never assumed).
 */
export interface Gray { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface DetWall { id: number; x0: number; y0: number; x1: number; y1: number; thickness: number; confidence: number; orient: 'h' | 'v' }
export interface DetOpening { wallId: number; type: 'door' | 'window'; center: number; width: number; confidence: number }
export interface DetRoom { x0: number; y0: number; x1: number; y1: number; areaPx: number; confidence: number }
export interface DetectOptions {
  darkThreshold?: number; // 0..255, pixels darker than this are ink
  minWallPx?: number; // minimum wall run length
  minThickPx?: number;
  maxThickPx?: number;
  pxPerMeter?: number | null;
}
export interface DetectResult { walls: DetWall[]; openings: DetOpening[]; rooms: DetRoom[]; stats: { inkRatio: number; threshold: number } }

export function toGray(img: ImageData): Gray {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const a = img.data[i + 3] / 255;
    // transparent pixels count as white paper
    out[j] = Math.round((0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a));
  }
  return { data: out, width: img.width, height: img.height };
}

/** Otsu threshold, biased towards dark ink. */
export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return Math.min(thr, 170);
}

interface Band { start: number; end: number; x0s: number[]; x1s: number[]; lastSpan: [number, number] }

function bandsFromRuns(mask: Uint8Array, W: number, H: number, horizontal: boolean, minLen: number) {
  const outer = horizontal ? H : W, inner = horizontal ? W : H;
  let open: Band[] = [];
  const done: Band[] = [];
  for (let r = 0; r < outer; r++) {
    const runs: [number, number][] = [];
    let s = -1;
    for (let c = 0; c <= inner; c++) {
      const v = c < inner ? mask[horizontal ? r * W + c : c * W + r] : 0;
      if (v && s < 0) s = c;
      if (!v && s >= 0) { if (c - s >= minLen) runs.push([s, c - 1]); s = -1; }
    }
    const used = new Set<number>();
    const still: Band[] = [];
    for (const b of open) {
      let matched = -1;
      for (let i = 0; i < runs.length; i++) {
        if (used.has(i)) continue;
        const [a0, a1] = runs[i];
        const ov = Math.min(a1, b.lastSpan[1]) - Math.max(a0, b.lastSpan[0]);
        if (ov > 0.6 * Math.min(a1 - a0, b.lastSpan[1] - b.lastSpan[0])) { matched = i; break; }
      }
      if (matched >= 0) {
        used.add(matched);
        b.end = r; b.x0s.push(runs[matched][0]); b.x1s.push(runs[matched][1]); b.lastSpan = runs[matched];
        still.push(b);
      } else done.push(b);
    }
    runs.forEach((run, i) => { if (!used.has(i)) still.push({ start: r, end: r, x0s: [run[0]], x1s: [run[1]], lastSpan: run }); });
    open = still;
  }
  done.push(...open);
  return done;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const std = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

export function detectPlan(g: Gray, opts: DetectOptions = {}): DetectResult {
  const W = g.width, H = g.height;
  const thr = opts.darkThreshold ?? otsu(g);
  const maxDim = Math.max(W, H);
  const minLen = opts.minWallPx ?? Math.max(12, Math.round(maxDim * 0.025));
  const minT = opts.minThickPx ?? Math.max(3, Math.round(maxDim * 0.003));
  const maxT = opts.maxThickPx ?? Math.max(minT + 4, Math.round(maxDim * 0.04));
  const mask = new Uint8Array(W * H);
  let ink = 0;
  for (let i = 0; i < mask.length; i++) if (g.data[i] < thr) { mask[i] = 1; ink++; }

  // Thin-line suppression: a pixel can belong to a horizontal wall only if its vertical
  // ink run is at least minT (and vice-versa). This removes window glazing lines, hatching,
  // dimension lines and most text before wall tracing.
  const thick = (alongRows: boolean) => {
    const out = new Uint8Array(W * H);
    const outer = alongRows ? H : W, inner = alongRows ? W : H;
    for (let r = 0; r < outer; r++) {
      let s = -1;
      for (let c = 0; c <= inner; c++) {
        const idx = alongRows ? r * W + c : c * W + r;
        const v = c < inner ? mask[idx] : 0;
        if (v && s < 0) s = c;
        if (!v && s >= 0) {
          if (c - s >= minT) for (let q = s; q < c; q++) out[alongRows ? r * W + q : q * W + r] = 1;
          s = -1;
        }
      }
    }
    return out;
  };
  const maskForH = thick(false); // vertical runs ≥ minT
  const maskForV = thick(true); // horizontal runs ≥ minT

  let id = 0;
  const walls: DetWall[] = [];
  for (const horizontal of [true, false]) {
    const bands = bandsFromRuns(horizontal ? maskForH : maskForV, W, H, horizontal, minLen);
    for (const b of bands) {
      const t = b.end - b.start + 1;
      if (t < minT || t > maxT) continue;
      const lo = median(b.x0s), hi = median(b.x1s);
      if (hi - lo < minLen) continue;
      const c = (b.start + b.end) / 2;
      const consistency = Math.max(0, 1 - (std(b.x0s) + std(b.x1s)) / Math.max(4, t * 2));
      const lengthScore = Math.min(1, (hi - lo) / (t * 8));
      const confidence = +(0.35 + 0.35 * consistency + 0.3 * lengthScore).toFixed(2);
      walls.push(horizontal
        ? { id: id++, x0: lo, y0: c, x1: hi, y1: c, thickness: t, confidence, orient: 'h' }
        : { id: id++, x0: c, y0: lo, x1: c, y1: hi, thickness: t, confidence, orient: 'v' });
    }
  }

  // merge collinear walls & create openings from gaps
  const openings: DetOpening[] = [];
  const ppm = opts.pxPerMeter ?? null;
  const gapMax = ppm ? 2.6 * ppm : maxDim * 0.12;
  const gapMinMerge = Math.max(3, minT);
  for (const orient of ['h', 'v'] as const) {
    const list = walls.filter((w) => w.orient === orient)
      .sort((a, b) => (orient === 'h' ? a.y0 - b.y0 || a.x0 - b.x0 : a.x0 - b.x0 || a.y0 - b.y0));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (A.id < 0 || B.id < 0) continue;
        const offA = orient === 'h' ? A.y0 : A.x0, offB = orient === 'h' ? B.y0 : B.x0;
        if (Math.abs(offA - offB) > Math.max(A.thickness, B.thickness) / 2 + 1) continue;
        const [a0, a1] = orient === 'h' ? [A.x0, A.x1] : [A.y0, A.y1];
        const [b0, b1] = orient === 'h' ? [B.x0, B.x1] : [B.y0, B.y1];
        const [f0, f1, s0, s1] = a0 <= b0 ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
        const gap = s0 - f1;
        if (gap > gapMax) continue;
        // merge B into A
        const lo = Math.min(f0, s0), hi = Math.max(f1, s1);
        if (orient === 'h') { A.x0 = lo; A.x1 = hi; } else { A.y0 = lo; A.y1 = hi; }
        A.thickness = Math.round((A.thickness + B.thickness) / 2);
        A.confidence = +Math.min(A.confidence, B.confidence).toFixed(2);
        if (gap > gapMinMerge) {
          // ink inside the gap but thinner than a wall → window symbol; empty → door
          const line = Math.round(orient === 'h' ? A.y0 : A.x0);
          let inkCount = 0, samples = 0;
          for (let s = Math.round(f1 + 1); s < s0; s++) for (let k = -Math.floor(A.thickness / 2); k <= Math.floor(A.thickness / 2); k++) {
            const x = orient === 'h' ? s : line + k, y = orient === 'h' ? line + k : s;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            samples++; if (mask[y * W + x]) inkCount++;
          }
          const inkFrac = samples ? inkCount / samples : 0;
          const widthM = ppm ? gap / ppm : null;
          const type: 'door' | 'window' = inkFrac > 0.08 ? 'window' : 'door';
          const plausible = !widthM || (type === 'door' ? widthM >= 0.6 && widthM <= 1.6 : widthM >= 0.4 && widthM <= 2.6);
          if (plausible) openings.push({ wallId: A.id, type, center: f1 + gap / 2, width: gap, confidence: type === 'door' ? 0.55 : 0.5 });
        }
        for (const o of openings) if (o.wallId === B.id) o.wallId = A.id;
        B.id = -1;
        j = i; // rescan since A grew
      }
    }
  }
  const kept = walls.filter((w) => w.id >= 0);

  // join corners: snap endpoints onto perpendicular centrelines
  for (const w of kept) {
    for (const end of [0, 1] as const) {
      const ex = end === 0 ? w.x0 : w.x1, ey = end === 0 ? w.y0 : w.y1;
      let best: { d: number; v: number } | null = null;
      for (const o of kept) {
        if (o === w || o.orient === w.orient) continue;
        const tol = Math.max(o.thickness, w.thickness) * 1.2 + 4;
        if (w.orient === 'h') {
          const d = Math.abs(o.x0 - ex);
          if (d < tol && ey >= o.y0 - tol && ey <= o.y1 + tol && (!best || d < best.d)) best = { d, v: o.x0 };
        } else {
          const d = Math.abs(o.y0 - ey);
          if (d < tol && ex >= o.x0 - tol && ex <= o.x1 + tol && (!best || d < best.d)) best = { d, v: o.y0 };
        }
      }
      if (best) {
        if (w.orient === 'h') { if (end === 0) w.x0 = best.v; else w.x1 = best.v; }
        else { if (end === 0) w.y0 = best.v; else w.y1 = best.v; }
      }
    }
  }

  // opening centres were tracked in absolute pixels; express them relative to the wall start
  const outOpenings: DetOpening[] = [];
  for (const o of openings) {
    const w = kept.find((k) => k.id === o.wallId);
    if (w) outOpenings.push({ ...o, center: o.center - (w.orient === 'h' ? w.x0 : w.y0) });
  }
  const rooms = findRooms(kept, W, H, ppm);
  return { walls: kept, openings: outOpenings, rooms, stats: { inkRatio: ink / (W * H), threshold: thr } };
}

/** Rasterise walls at low resolution, flood the exterior, label enclosed regions. */
function findRooms(walls: DetWall[], W: number, H: number, ppm: number | null): DetRoom[] {
  const k = Math.max(1, Math.round(Math.max(W, H) / 400));
  const w = Math.ceil(W / k) + 2, h = Math.ceil(H / k) + 2;
  const grid = new Uint8Array(w * h); // 1 = wall, 2 = exterior, 3+ = room labels
  for (const s of walls) {
    const t = Math.max(1, Math.ceil(s.thickness / k / 2) + 1);
    const x0 = Math.floor(Math.min(s.x0, s.x1) / k) + 1 - (s.orient === 'v' ? t : 0);
    const x1 = Math.ceil(Math.max(s.x0, s.x1) / k) + 1 + (s.orient === 'v' ? t : 0);
    const y0 = Math.floor(Math.min(s.y0, s.y1) / k) + 1 - (s.orient === 'h' ? t : 0);
    const y1 = Math.ceil(Math.max(s.y0, s.y1) / k) + 1 + (s.orient === 'h' ? t : 0);
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) grid[y * w + x] = 1;
  }
  const fill = (sx: number, sy: number, label: number) => {
    const st = [sy * w + sx];
    let n = 0, minX = sx, maxX = sx, minY = sy, maxY = sy;
    grid[sy * w + sx] = label;
    while (st.length) {
      const i = st.pop()!;
      n++;
      const x = i % w, y = (i / w) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= grid.length) continue;
        if ((j % w === 0 && i % w === w - 1) || (i % w === 0 && j % w === w - 1)) continue;
        if (grid[j] === 0) { grid[j] = label; st.push(j); }
      }
    }
    return { n, minX, maxX, minY, maxY };
  };
  fill(0, 0, 2);
  const rooms: DetRoom[] = [];
  let label = 3;
  const minArea = ppm ? (1.5 * ppm * ppm) / (k * k) : (w * h) / 400;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y * w + x] !== 0) continue;
    const r = fill(x, y, label++);
    if (r.n < minArea) continue;
    const bboxArea = (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    const rectness = r.n / bboxArea;
    rooms.push({
      x0: (r.minX - 1) * k, y0: (r.minY - 1) * k, x1: (r.maxX) * k, y1: (r.maxY) * k,
      areaPx: r.n * k * k, confidence: +(0.4 + 0.5 * rectness).toFixed(2),
    });
  }
  return rooms;
}
