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
export interface DetRoom {
  x0: number; y0: number; x1: number; y1: number; areaPx: number; confidence: number;
  /** Traced outline in pixels (keeps concave corners of L-shaped rooms). */
  polygon: { x: number; y: number }[];
  /** True when the outline is not a plain rectangle — flagged for review. */
  irregular: boolean;
}
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
  // Inclusive comparison: Otsu returns 0 for pure black-on-white drawings, and `< 0` would find no ink.
  const mask = new Uint8Array(W * H);
  let ink = 0;
  for (let i = 0; i < mask.length; i++) if (g.data[i] <= thr) { mask[i] = 1; ink++; }
  // Inverted drawings (light lines on a dark sheet): ink would cover most of the page.
  if (ink > mask.length * 0.5) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
    ink = mask.length - ink;
  }

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
  const grid = new Int32Array(w * h); // 1 = wall, 2 = exterior, 3+ = room labels
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
    const outline = traceRegion(grid, w, h, label - 1, r);
    const poly = outline.map((p) => ({ x: (p.x - 1) * k, y: (p.y - 1) * k }));
    rooms.push({
      x0: (r.minX - 1) * k, y0: (r.minY - 1) * k, x1: (r.maxX) * k, y1: (r.maxY) * k,
      areaPx: r.n * k * k, confidence: +(0.4 + 0.5 * rectness).toFixed(2),
      polygon: poly, irregular: poly.length > 4 || rectness < 0.97,
    });
  }
  return rooms;
}

/** Trace the outer boundary of a labelled grid region into a simplified polygon (grid-corner coordinates). */
function traceRegion(grid: Int32Array, w: number, h: number, label: number, r: { minX: number; maxX: number; minY: number; maxY: number }) {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === label;
  const next = new Map<number, number[]>(); // vertex key → end vertex keys (clockwise, interior on the right in screen space)
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k0 = key(x0, y0);
    const l = next.get(k0);
    if (l) l.push(key(x1, y1)); else next.set(k0, [key(x1, y1)]);
  };
  for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: { x: number; y: number }[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop: { x: number; y: number }[] = [];
      let cur = start;
      for (let guard = 0; guard < 1e6; guard++) {
        loop.push({ x: cur % (w + 1), y: Math.floor(cur / (w + 1)) });
        const outs = next.get(cur);
        if (!outs || !outs.length) break;
        const nx = outs.shift()!;
        cur = nx;
        if (cur === start) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((a, q, i) => { const n = p[(i + 1) % p.length]; return a + q.x * n.y - n.x * q.y; }, 0)) / 2;
  const outer = loops.sort((a, b) => area(b) - area(a))[0] ?? [];
  return simplify(dropCollinear(outer), 1.25);
}

function dropCollinear(p: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) out.push(b);
  }
  return out;
}

/** Douglas–Peucker on a closed ring; removes 1-cell raster steps but keeps real corners. */
function simplify(p: { x: number; y: number }[], eps: number) {
  if (p.length <= 4) return p;
  // split the ring at the two most distant points
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < p.length; i++) { const d = (p[i].x - p[0].x) ** 2 + (p[i].y - p[0].y) ** 2; if (d > best) { best = d; i1 = i; } }
  const dp = (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    let idx = 0, dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= eps) return [a, b];
    const left = dp(pts.slice(0, idx + 1)), right = dp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  const first = dp(p.slice(i0, i1 + 1));
  const second = dp([...p.slice(i1), p[i0]]);
  const ring = [...first.slice(0, -1), ...second.slice(0, -1)];
  return ring.length >= 3 ? ring : p;
}
