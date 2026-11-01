import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Upload, RotateCw, RotateCcw, Ruler, ScanLine, Box, Loader2, AlertTriangle, CheckCircle2, FileImage, Sparkles, Undo2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Btn, Field, inputCls } from '../components/ui';
import { MAX_UPLOAD_BYTES, loadImage, openPdf, readAsDataUrl, sniffType, toCanvas, type PdfHandle } from '../lib/image';
import { detectPlan, toGray, type DetectResult } from '../lib/detect';
import { makeRoom, makeWall, uid } from '../lib/templates';
import { dist, fmtArea, fmtLen, parseFeetInches, polygonArea, validateGeometry } from '../lib/geometry';
import { thumbnail } from '../lib/capture';
import type { Opening, Pt, RoomType } from '../lib/types';

const STEPS = ['Upload', 'Scale', 'Detect & review', 'Confirm & generate'];
const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'balcony', 'utility', 'pooja', 'other'];
/** Calibration points for the bundled sample plan (its "12.00 m" dimension line). */
const SAMPLE = { file: 'samples/sample-plan.png', pts: [{ x: 90, y: 670 }, { x: 810, y: 670 }], length: 12 };

/** SVG stage with wheel-zoom, drag-pan and two-finger pinch; reports clicks in image pixel coordinates. */
function Stage({ w, h, href, onClick, children, cursor = 'crosshair' }: { w: number; h: number; href: string; onClick?: (p: Pt) => void; children?: ReactNode; cursor?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w, h });
  useEffect(() => setVb({ x: 0, y: 0, w, h }), [w, h]);
  const down = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; vb: typeof vb; mid: Pt } | null>(null);
  const toImg = (e: { clientX: number; clientY: number }) => {
    const pt = ref.current!.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ref.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const zoomAt = (p: Pt, k: number, base = vb) => {
    const nw = Math.min(w * 2, Math.max(w / 40, base.w * k)); const s = nw / base.w;
    return { x: p.x - (p.x - base.x) * s, y: p.y - (p.y - base.y) * s, w: nw, h: base.h * s };
  };
  return (
    <svg ref={ref} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-full w-full touch-none select-none" style={{ cursor }}
      onWheel={(e) => { const p = toImg(e); setVb((v) => zoomAt(p, Math.exp(e.deltaY * 0.0015), v)); }}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), vb, mid: toImg({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
          down.current = null;
        } else down.current = { x: e.clientX, y: e.clientY, vb, moved: false };
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.current && pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          setVb(zoomAt(pinch.current.mid, pinch.current.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), pinch.current.vb));
          return;
        }
        const d = down.current;
        if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 5 && Math.abs(e.clientY - d.y) < 5)) return;
        d.moved = true;
        const r = ref.current!.getBoundingClientRect();
        const s = Math.max(d.vb.w / r.width, d.vb.h / r.height);
        setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.x) * s, y: d.vb.y - (e.clientY - d.y) * s });
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        const d = down.current; down.current = null;
        if (d && !d.moved) onClick?.(toImg(e));
      }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); pinch.current = null; down.current = null; }}>
      <image href={href} x={0} y={0} width={w} height={h} />
      {children}
    </svg>
  );
}

interface Img { url: string; w: number; h: number; canvas: HTMLCanvasElement; key: string }
interface Scale { ppm: number; pts: Pt[]; length: number; units: 'm' | 'ft' }
interface RoomEdit { name: string; type: RoomType }

export default function ImportWizard() {
  const project = useEditor((s) => s.project)!;
  const settings = useEditor((s) => s.settings);
  const activeFloorId = useEditor((s) => s.activeFloorId);
  const { navigate, updateProject, mutate, toast, setView } = useEditor.getState();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const pdfRef = useRef<PdfHandle | null>(null);
  const samplePending = useRef(false);
  const [pdfPages, setPdfPages] = useState<{ pages: number; page: number } | null>(null);
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rot, setRot] = useState(0);
  const [img, setImg] = useState<Img | null>(null);
  const [units, setUnits] = useState(project.units);
  const [calPts, setCalPts] = useState<Pt[]>([]);
  const [calText, setCalText] = useState('');
  const [scale, setScale] = useState<Scale | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [engine, setEngine] = useState<'browser' | 'server'>('browser');
  const [result, setResult] = useState<{ fp: string; data: DetectResult } | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [rooms, setRooms] = useState<RoomEdit[]>([]);
  const [mode, setMode] = useState<'detected' | 'manual'>('detected');
  const [replace, setReplace] = useState(true);
  const [furniture, setFurniture] = useState<'keep' | 'remove'>('keep');
  const floorId = activeFloorId;
  const floor = project.scene.floors.find((f) => f.id === floorId) ?? project.scene.floors[0];
  const [wallH, setWallH] = useState(String(floor.ceilingHeight));
  const existing = {
    walls: project.scene.walls.filter((w) => w.floorId === floor.id).length,
    rooms: project.scene.rooms.filter((r) => r.floorId === floor.id).length,
    objects: project.scene.objects.filter((o) => o.floorId === floor.id).length,
    blueprint: !!project.scene.blueprints?.[floor.id],
  };

  useEffect(() => () => pdfRef.current?.destroy(), []);

  // rebuild the working image whenever source / rotation changes; everything downstream becomes stale
  useEffect(() => {
    if (!baseCanvas) return;
    const c = toCanvas(baseCanvas, 2400, rot);
    setImg({ url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height, canvas: c, key: uid() });
    setCalPts([]); setScale(null); setResult(null);
    if (samplePending.current) {
      // pre-mark the sample's 12.00 m dimension line — the user only has to press Apply
      samplePending.current = false;
      setUnits('m'); setCalPts(SAMPLE.pts); setCalText(String(SAMPLE.length)); setStep(1);
    }
  }, [baseCanvas, rot]);

  // A07: editing the calibration after Apply invalidates the applied scale
  const calLenM = useMemo(() => {
    const v = units === 'ft' ? parseFeetInches(calText) : parseFloat(calText);
    if (v === null || !(v > 0)) return null;
    return units === 'ft' ? v / 3.28084 : v;
  }, [calText, units]);
  useEffect(() => {
    if (!scale) return;
    const same = calPts.length === 2 && scale.pts.length === 2 && dist(calPts[0], scale.pts[0]) < 1e-6 && dist(calPts[1], scale.pts[1]) < 1e-6 && calLenM !== null && Math.abs(calLenM - scale.length) < 1e-9 && units === scale.units;
    if (!same) setScale(null);
  }, [calPts, calLenM, units, scale]);

  const fingerprint = img && scale ? `${img.key}|${scale.ppm.toFixed(6)}|${threshold ?? 'auto'}|${engine}` : null;
  const fresh = result && result.fp === fingerprint ? result.data : null;

  // new detection → reset exclusions and room confirmations
  useEffect(() => {
    if (!fresh) return;
    setExcluded(new Set());
    const order = fresh.rooms.map((r, i) => ({ i, a: r.areaPx })).sort((a, b) => b.a - a.a);
    const edits: RoomEdit[] = fresh.rooms.map((_, i) => ({ name: `Room ${i + 1}`, type: 'other' as RoomType }));
    if (order[0]) edits[order[0].i] = { name: 'Living', type: 'living' }; // largest space is usually the hall
    setRooms(edits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const loadCanvas = (c: HTMLCanvasElement, name: string) => { setFileName(name); setBaseCanvas(c); setRot(0); };

  const onFile = async (f: File) => {
    setError(null);
    if (f.size > MAX_UPLOAD_BYTES) { setError(`File is ${(f.size / 1e6).toFixed(1)} MB — the limit is 25 MB.`); return; }
    const t = await sniffType(f);
    if (!t) { setError('Unsupported file. Upload a PDF, PNG or JPG floor plan (CAD formats like DWG/DXF are not supported yet).'); return; }
    setBusy(true);
    try {
      pdfRef.current?.destroy(); pdfRef.current = null; setPdfPages(null);
      if (t === 'pdf') {
        const pdf = await openPdf(await f.arrayBuffer());
        if (pdf.pages > 50) { pdf.destroy(); throw new Error('PDFs are limited to 50 pages.'); }
        pdfRef.current = pdf;
        setPdfPages({ pages: pdf.pages, page: 1 });
        loadCanvas(await pdf.render(1), f.name);
      } else {
        const im = await loadImage(await readAsDataUrl(f));
        if (im.width * im.height > 60_000_000) throw new Error('That image is too large (over 60 megapixels). Export it at a lower resolution.');
        loadCanvas(toCanvas(im, 3000), f.name);
      }
    } catch (e) {
      setError((e as Error).message || 'The file could not be read.');
    } finally { setBusy(false); }
  };
  const trySample = async () => {
    setBusy(true); setError(null);
    try {
      const blob = await (await fetch(`${import.meta.env.BASE_URL}${SAMPLE.file}`)).blob();
      samplePending.current = true;
      await onFile(new File([blob], 'sample-plan.png', { type: 'image/png' }));
    } catch { samplePending.current = false; setError('Could not load the sample plan.'); setBusy(false); }
  };
  const choosePage = async (page: number) => {
    if (!pdfRef.current) return;
    setBusy(true);
    try { setPdfPages((p) => (p ? { ...p, page } : p)); loadCanvas(await pdfRef.current.render(page), fileName); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const applyScale = () => {
    if (calPts.length < 2 || calLenM === null) return;
    setScale({ ppm: dist(calPts[0], calPts[1]) / calLenM, pts: calPts, length: calLenM, units });
    if (units !== project.units) updateProject((p) => { p.units = units; });
  };
  const planSize = scale && img ? { w: img.w / scale.ppm, h: img.h / scale.ppm } : null;
  const suspicious = planSize && (planSize.w > 150 || planSize.h > 150 || planSize.w < 3);

  const runDetect = async () => {
    if (!img || !scale || !fingerprint) return;
    const fp = fingerprint;
    setBusy(true); setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      let res: DetectResult;
      if (engine === 'server' && settings.backendUrl) {
        const blob: Blob = await new Promise((r) => img.canvas.toBlob((b) => r(b!), 'image/png'));
        const fd = new FormData();
        fd.append('file', blob, 'plan.png');
        const qs = new URLSearchParams({ px_per_meter: String(scale.ppm), ...(threshold ? { threshold: String(threshold) } : {}) });
        const r = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/blueprints/detect?${qs}`, { method: 'POST', body: fd, headers: settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {} });
        if (r.status === 401) throw new Error('The server rejected the API token. Check Settings → Optional processing server.');
        if (!r.ok) throw new Error(`Server detection failed (${r.status}). Try the in-browser engine.`);
        res = await r.json();
        res.rooms = res.rooms.map((m) => ({ ...m, polygon: m.polygon ?? [{ x: m.x0, y: m.y0 }, { x: m.x1, y: m.y0 }, { x: m.x1, y: m.y1 }, { x: m.x0, y: m.y1 }], irregular: !!m.irregular }));
      } else {
        const small = toCanvas(img.canvas, 1600);
        const k = img.w / small.width;
        const d = small.getContext('2d')!.getImageData(0, 0, small.width, small.height);
        const r = detectPlan(toGray(d), { pxPerMeter: scale.ppm / k, darkThreshold: threshold ?? undefined });
        res = {
          ...r,
          walls: r.walls.map((w) => ({ ...w, x0: w.x0 * k, y0: w.y0 * k, x1: w.x1 * k, y1: w.y1 * k, thickness: w.thickness * k })),
          openings: r.openings.map((o) => ({ ...o, center: o.center * k, width: o.width * k })),
          rooms: r.rooms.map((m) => ({ ...m, x0: m.x0 * k, y0: m.y0 * k, x1: m.x1 * k, y1: m.y1 * k, areaPx: m.areaPx * k * k, polygon: m.polygon.map((p) => ({ x: p.x * k, y: p.y * k })) })),
        };
      }
      setResult({ fp, data: res });
      if (res.walls.length === 0) setError('No walls were found. Try moving the ink threshold slider, or trace the plan manually.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // auto-run detection whenever the inputs change on the review step
  useEffect(() => {
    if (step === 2 && fingerprint && !fresh && !busy) void runDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fingerprint]);

  const accepted = useMemo(() => {
    if (!fresh) return null;
    const walls = fresh.walls.filter((w) => !excluded.has('w' + w.id));
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = fresh.openings.map((o, i) => ({ o, i })).filter(({ o, i }) => wallIds.has(o.wallId) && !excluded.has('o' + i));
    const roomsIdx = fresh.rooms.map((r, i) => ({ r, i })).filter(({ i }) => !excluded.has('r' + i));
    return { walls, openings, rooms: roomsIdx };
  }, [fresh, excluded]);

  const generate = () => {
    if (!img || !scale) return;
    const ppm = scale.ppm;
    const fId = floor.id;
    const P = (x: number, y: number): Pt => ({ x: +(x / ppm).toFixed(3), y: +(y / ppm).toFixed(3) });
    const h = parseFloat(wallH);
    const height = h >= 2.2 && h <= 8 ? h : floor.ceilingHeight;
    // A08: one recoverable transaction — snapshot first, then a single undoable scene edit.
    const before = structuredClone(project.scene);
    const assetId = 'bp-' + uid();
    updateProject((p) => {
      p.versions = [...p.versions, { id: uid(), number: (p.versions.at(-1)?.number ?? 0) + 1, label: `Before import: ${fileName}`.slice(0, 120), createdAt: Date.now(), thumbnail: thumbnail() ?? undefined, scene: before }];
      p.assets = { ...p.assets, [assetId]: img.url };
    });
    let irregular = 0;
    mutate((s) => {
      if (replace) {
        const ids = new Set(s.walls.filter((w) => w.floorId === fId).map((w) => w.id));
        s.walls = s.walls.filter((w) => w.floorId !== fId);
        s.openings = s.openings.filter((o) => !ids.has(o.wallId));
        s.rooms = s.rooms.filter((r) => r.floorId !== fId);
      }
      if (furniture === 'remove') s.objects = s.objects.filter((o) => o.floorId !== fId);
      s.blueprints = { ...(s.blueprints ?? {}), [fId]: { assetId, fileName, widthPx: img.w, heightPx: img.h, pxPerMeter: ppm, originX: 0, originY: 0, opacity: 0.45, visible: true } };
      s.floors.forEach((f) => { if (f.id === fId) f.ceilingHeight = height; });
      if (mode === 'manual' || !accepted) return;
      const idMap = new Map<number, string>();
      accepted.walls.forEach((w) => {
        const t = Math.max(0.05, Math.min(0.6, +(w.thickness / ppm).toFixed(3)));
        const wall = makeWall(fId, P(w.x0, w.y0), P(w.x1, w.y1), t, height, 'detected');
        wall.confidence = w.confidence;
        idMap.set(w.id, wall.id);
        s.walls.push(wall);
      });
      accepted.openings.forEach(({ o }) => {
        const wid = idMap.get(o.wallId);
        if (!wid) return;
        const op: Opening = { id: uid(), wallId: wid, type: o.type, offset: +(o.center / ppm).toFixed(3), width: +(o.width / ppm).toFixed(3), height: o.type === 'door' ? 2.1 : 1.2, sill: o.type === 'door' ? 0 : 0.9, source: 'detected', confidence: o.confidence };
        s.openings.push(op);
      });
      accepted.rooms.forEach(({ r, i }) => {
        const poly = r.polygon.map((p) => P(p.x, p.y));
        const edit = rooms[i] ?? { name: `Room ${i + 1}`, type: 'other' };
        const room = makeRoom(fId, edit.name || `Room ${i + 1}`, edit.type, poly, edit.type === 'bathroom' ? 'tile-vitrified' : edit.type === 'kitchen' ? 'tile-slate' : 'tile-vitrified', 'detected');
        if (r.irregular) irregular++;
        s.rooms.push(room);
      });
    });
    const st = useEditor.getState().project!.scene;
    const issues = validateGeometry(st.walls.filter((w) => w.floorId === fId), st.openings);
    toast(mode === 'manual'
      ? 'Blueprint placed as a tracing underlay. Use the Wall (W) and Room (R) tools to trace it.'
      : `3D model generated${issues.length ? ` — ${issues.length} geometry note(s)` : ''}${irregular ? ` — ${irregular} irregular room outline(s) to check` : ''}. A “Before import” version was saved; Undo also reverts the import.`, 'success');
    setView(window.innerWidth < 768 ? '3d' : 'split');
    navigate({ page: 'editor', id: project.id });
  };

  const toggleEx = (k: string) => { const n = new Set(excluded); if (n.has(k)) n.delete(k); else n.add(k); setExcluded(n); };
  const sw = img ? Math.max(2, img.w / 400) : 2;
  const stale = !!result && !fresh;

  return (
    <div className="flex h-dvh flex-col bg-stone-950 text-stone-200">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-stone-800 bg-stone-900 px-3">
        <Btn title="Back to the editor" onClick={() => navigate({ page: 'editor', id: project.id })}><ArrowLeft size={16} /></Btn>
        <span className="truncate text-sm font-semibold text-stone-100">Import floor plan · {floor.name}</span>
        <ol className="ml-auto hidden items-center gap-1 md:flex">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${i === step ? 'bg-amber-500 text-stone-950' : i < step ? 'text-emerald-400' : 'text-stone-500'}`}>
              {i < step ? <CheckCircle2 size={12} /> : <span className="font-mono">{i + 1}</span>} {s}
            </li>
          ))}
        </ol>
        <span className="ml-auto text-xs text-stone-500 md:hidden">Step {step + 1} of 4</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-[45vh] flex-1 bg-[#1f1d1b]">
          {!img ? (
            <div className="absolute inset-4 flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-stone-700 p-4 text-center md:inset-6"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}>
              {busy ? <Loader2 className="animate-spin text-amber-400" size={32} /> : <Upload className="text-stone-500" size={32} />}
              <span className="text-base font-medium text-stone-200">Drop your floor plan here</span>
              <label className="cursor-pointer rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-400">
                Choose a file
                <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
              </label>
              <span className="text-sm text-stone-500">PDF, PNG or JPG · up to 25 MB</span>
              <button onClick={() => void trySample()} className="inline-flex items-center gap-1.5 text-sm text-amber-400 hover:underline"><Sparkles size={14} /> No plan handy? Try our sample plan</button>
              <div className="mt-2 grid max-w-md grid-cols-2 gap-3 text-left text-xs">
                <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-200"><b>Works best</b><br />Clean, straight-walled plans exported from CAD or drawn neatly · one floor per page</div>
                <div className="rounded-md bg-amber-500/10 p-2 text-amber-200"><b>Needs manual tracing</b><br />Phone photos, hand sketches, curved or diagonal walls, hatched walls</div>
              </div>
            </div>
          ) : (
            <Stage w={img.w} h={img.h} href={img.url} cursor={step === 1 ? 'crosshair' : 'grab'} onClick={(p) => { if (step === 1) setCalPts((c) => (c.length >= 2 ? [p] : [...c, p])); }}>
              {step === 1 && calPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={sw * 3} fill="#22d3ee" stroke="#083344" strokeWidth={sw / 2} />)}
              {step === 1 && calPts.length === 2 && <line x1={calPts[0].x} y1={calPts[0].y} x2={calPts[1].x} y2={calPts[1].y} stroke="#22d3ee" strokeWidth={sw} />}
              {step >= 2 && fresh && mode === 'detected' && (
                <g>
                  {fresh.rooms.map((r, i) => {
                    const off = excluded.has('r' + i);
                    return <polygon key={'r' + i} points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={off ? 'rgba(120,113,108,0.05)' : r.irregular ? 'rgba(251,191,36,0.14)' : 'rgba(52,211,153,0.12)'}
                      stroke={off ? '#78716c' : r.irregular ? '#fbbf24' : '#34d399'} strokeWidth={sw / 2} strokeDasharray={`${sw * 3} ${sw * 2}`} onClick={() => toggleEx('r' + i)} style={{ cursor: 'pointer' }} />;
                  })}
                  {fresh.walls.map((w) => (
                    <line key={w.id} x1={w.x0} y1={w.y0} x2={w.x1} y2={w.y1} strokeWidth={Math.max(w.thickness, sw * 2)} strokeLinecap="square"
                      stroke={excluded.has('w' + w.id) ? 'rgba(120,113,108,0.5)' : w.confidence < 0.6 ? 'rgba(251,146,60,0.85)' : 'rgba(245,158,11,0.75)'}
                      style={{ cursor: 'pointer' }} onClick={() => toggleEx('w' + w.id)} />
                  ))}
                  {fresh.openings.map((o, i) => {
                    const w = fresh.walls.find((x) => x.id === o.wallId);
                    if (!w) return null;
                    const hz = w.orient === 'h';
                    const off = excluded.has('o' + i) || excluded.has('w' + w.id);
                    const cx = hz ? w.x0 + o.center : w.x0, cy = hz ? w.y0 : w.y0 + o.center;
                    return <rect key={'o' + i} x={cx - (hz ? o.width / 2 : w.thickness)} y={cy - (hz ? w.thickness : o.width / 2)} width={hz ? o.width : w.thickness * 2} height={hz ? w.thickness * 2 : o.width}
                      fill={off ? 'none' : o.type === 'door' ? 'rgba(244,114,182,0.6)' : 'rgba(56,189,248,0.6)'} stroke={off ? '#78716c' : o.type === 'door' ? '#f472b6' : '#38bdf8'} strokeWidth={sw / 2} onClick={() => toggleEx('o' + i)} style={{ cursor: 'pointer' }} />;
                  })}
                </g>
              )}
            </Stage>
          )}
          {img && <p className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-stone-300">{step === 1 ? 'Click the two ends of a known measurement · ' : ''}Scroll or pinch to zoom · drag to pan{step >= 2 ? ' · click a detection to include/exclude it' : ''}</p>}
          {busy && img && <div className="absolute right-3 top-3 flex items-center gap-2 rounded bg-black/70 px-3 py-1.5 text-xs text-stone-200"><Loader2 size={12} className="animate-spin" /> Working…</div>}
        </div>

        <aside className="max-h-[55vh] w-full shrink-0 overflow-y-auto border-t border-stone-800 bg-stone-900 p-5 md:max-h-none md:w-[380px] md:border-l md:border-t-0">
          {error && <div role="alert" className="mb-4 flex gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">1 · Upload your floor plan</h2>
              {!img ? <p className="text-sm text-stone-400">Files are checked by their content and processed in your browser unless you choose the server engine.</p> : (
                <>
                  <div className="flex items-center gap-2 rounded-md bg-stone-800/60 p-2 text-sm"><FileImage size={16} className="text-stone-400" /><span className="flex-1 truncate">{fileName}</span><span className="text-xs text-stone-500">{img.w}×{img.h}px</span></div>
                  {pdfPages && pdfPages.pages > 1 && (
                    <Field label={`PDF page (${pdfPages.pages} pages)`}>
                      <select className={inputCls} value={pdfPages.page} onChange={(e) => void choosePage(+e.target.value)}>
                        {Array.from({ length: pdfPages.pages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Orientation">
                    <div className="flex gap-2"><Btn variant="outline" onClick={() => setRot((r) => (r + 270) % 360)}><RotateCcw size={14} /> Left</Btn><Btn variant="outline" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw size={14} /> Right</Btn></div>
                  </Field>
                  <div className="flex gap-2 pt-2">
                    <label className="cursor-pointer"><span className="inline-flex rounded-md border border-stone-700 px-3 py-1.5 text-sm hover:bg-stone-800">Replace file</span><input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} /></label>
                    <Btn variant="primary" className="ml-auto" onClick={() => setStep(1)}>Next: one measurement</Btn>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">2 · Confirm one measurement</h2>
              <p className="text-sm text-stone-400">Click both ends of a dimension you know — best is a long one, like the overall width of the house — then type its real length.</p>
              <div className="flex items-center gap-2 text-sm"><Ruler size={16} className="text-cyan-400" />{calPts.length === 0 ? 'Click the first point on the plan' : calPts.length === 1 ? 'Now click the second point' : `Line drawn (${dist(calPts[0], calPts[1]).toFixed(0)} px) — click again to redraw`}</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={units === 'ft' ? 'Real length (e.g. 39\' 4")' : 'Real length (metres)'}>
                  <input value={calText} onChange={(e) => setCalText(e.target.value)} inputMode="decimal" className={inputCls} placeholder={units === 'ft' ? `39' 4"` : '12.00'} aria-invalid={calText !== '' && calLenM === null} />
                </Field>
                <Field label="Units">
                  <select className={inputCls} value={units} onChange={(e) => setUnits(e.target.value as 'm' | 'ft')}><option value="m">metres</option><option value="ft">feet & inches</option></select>
                </Field>
              </div>
              {calText !== '' && calLenM === null && <p className="text-xs text-red-300">Enter a length like {units === 'ft' ? `39' 4" or 39.33` : '12 or 12.5'}.</p>}
              <Btn variant={scale ? 'outline' : 'primary'} className="w-full" disabled={calPts.length < 2 || calLenM === null} onClick={applyScale}>{scale ? 'Scale applied ✓' : 'Apply scale'}</Btn>
              {!scale && calPts.length === 2 && calLenM !== null && <p className="text-xs text-amber-300">{fileName === 'sample-plan.png' ? 'We marked the sample’s 12.00 m line for you — ' : ''}Press “Apply scale” to use this measurement.</p>}
              {scale && planSize && (
                <div className={`rounded-md p-3 text-sm ${suspicious ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}`}>
                  {fmtLen(scale.length, units)} reference → the full sheet is {fmtLen(planSize.w, units)} × {fmtLen(planSize.h, units)}.
                  {suspicious && <p className="mt-1">That size looks unusual for a building — please double-check the points and length.</p>}
                </div>
              )}
              <div className="flex gap-2 pt-2"><Btn variant="outline" onClick={() => setStep(0)}>Back</Btn><Btn variant="primary" className="ml-auto" disabled={!scale} onClick={() => { setMode('detected'); setStep(2); }}>Next: find rooms</Btn></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">3 · Check what was found</h2>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Engine">
                  <select className={inputCls} value={engine} onChange={(e) => setEngine(e.target.value as 'browser' | 'server')}>
                    <option value="browser">In-browser (private)</option>
                    <option value="server" disabled={!settings.backendUrl}>Server · OpenCV{settings.backendUrl ? '' : ' (not set)'}</option>
                  </select>
                </Field>
                <Field label={`Line darkness ${threshold ?? 'auto'}`}>
                  <input type="range" min={20} max={220} value={threshold ?? 128} onChange={(e) => setThreshold(+e.target.value)} className="mt-2 w-full accent-amber-500" aria-label="Ink threshold" />
                  {threshold !== null && <button className="text-[10px] text-amber-400 underline" onClick={() => setThreshold(null)}>back to auto</button>}
                </Field>
              </div>
              {stale && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-200">Settings changed — results below are being refreshed.</p>}
              <Btn variant="outline" className="w-full" onClick={() => void runDetect()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Run detection again</Btn>
              {fresh && accepted && (
                <>
                  <div className="space-y-1.5 rounded-md bg-stone-800/50 p-3 text-sm">
                    <div className="flex justify-between"><span>Walls kept</span><span>{accepted.walls.length} of {fresh.walls.length} {fresh.walls.some((w) => w.confidence < 0.6) && <Badge tone="amber">some uncertain</Badge>}</span></div>
                    <div className="flex justify-between"><span>Doors / windows kept</span><span>{accepted.openings.filter(({ o }) => o.type === 'door').length} / {accepted.openings.filter(({ o }) => o.type === 'window').length}</span></div>
                    <div className="flex justify-between"><span>Rooms kept</span><span>{accepted.rooms.length} of {fresh.rooms.length}</span></div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Rooms</span>
                      {excluded.size > 0 && <button className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:underline" onClick={() => setExcluded(new Set())}><Undo2 size={11} /> Reset exclusions</button>}
                    </div>
                    <ul className="space-y-1">
                      {fresh.rooms.map((r, i) => (
                        <li key={i}><label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-stone-800">
                          <input type="checkbox" className="accent-amber-500" checked={!excluded.has('r' + i)} onChange={() => toggleEx('r' + i)} />
                          <span className="flex-1">{rooms[i]?.name ?? `Room ${i + 1}`}</span>
                          {r.irregular && <Badge tone="amber">irregular</Badge>}
                          <span className="text-[11px] text-stone-500">{fmtArea(r.areaPx / (scale!.ppm * scale!.ppm), units)}</span>
                        </label></li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-stone-400">
                    <span className="flex items-center gap-1"><i className="h-2 w-3 bg-amber-500" />wall</span><span className="flex items-center gap-1"><i className="h-2 w-3 bg-orange-400" />uncertain</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-3 bg-pink-400" />door</span><span className="flex items-center gap-1"><i className="h-2 w-3 bg-sky-400" />window</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-3 border border-emerald-400" />room</span><span className="flex items-center gap-1"><i className="h-2 w-3 border border-amber-300" />irregular room</span>
                  </div>
                </>
              )}
              <p className="text-xs text-stone-500">Click anything on the plan to leave it out (click again to bring it back). You can drag wall ends and add missing doors later in the editor.</p>
              <div className="flex gap-2 pt-2"><Btn variant="outline" onClick={() => setStep(1)}>Back</Btn><Btn variant="primary" className="ml-auto" disabled={!fresh || busy} onClick={() => setStep(3)}>Next: name rooms</Btn></div>
              <button className="w-full text-center text-xs text-stone-400 underline" onClick={() => { setMode('manual'); setStep(3); }}>Skip detection — I'll trace the plan myself</button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">4 · {mode === 'manual' ? 'Place plan for tracing' : 'Name rooms & generate'}</h2>
              {mode === 'detected' && accepted && (
                <div>
                  <p className="mb-2 text-xs text-stone-400">Naming rooms now lets you say things like “paint the master bedroom sage” later.</p>
                  <ul className="space-y-1.5">
                    {accepted.rooms.map(({ r, i }) => (
                      <li key={i} className="grid grid-cols-[1fr_110px] gap-1.5">
                        <input value={rooms[i]?.name ?? ''} aria-label={`Name of room ${i + 1}`} onChange={(e) => setRooms((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} />
                        <select value={rooms[i]?.type ?? 'other'} aria-label={`Type of room ${i + 1}`} className={inputCls} onChange={(e) => {
                          const type = e.target.value as RoomType;
                          setRooms((rs) => {
                            const n = rs.filter((x, j) => j !== i && x.type === type).length + 1;
                            const pretty = type === 'living' ? 'Living' : type[0].toUpperCase() + type.slice(1);
                            return rs.map((x, j) => (j === i ? { type, name: /^Room \d+$|^Living$|^[A-Z][a-z]+( \d+)?$/.test(x.name) ? `${pretty}${n > 1 ? ' ' + n : ''}` : x.name } : x));
                          });
                        }}>
                          {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {r.irregular && <p className="col-span-2 -mt-1 text-[10px] text-amber-300">Irregular outline ({fmtArea(polygonArea(r.polygon) / (scale!.ppm * scale!.ppm), units)}) — check its shape in the plan.</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label="Ceiling height (metres)"><input value={wallH} onChange={(e) => setWallH(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <div className="space-y-2 rounded-md border border-stone-700 p-3 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">What happens to {floor.name}</p>
                {(existing.walls > 0 || existing.rooms > 0) ? (
                  <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-amber-500" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                    <span>Replace the existing {existing.walls} walls and {existing.rooms} rooms{existing.blueprint ? ' and the current underlay' : ''}</span></label>
                ) : <p className="text-stone-400">This floor is empty — nothing will be replaced.</p>}
                {existing.objects > 0 && (
                  <fieldset className="space-y-1">
                    <legend className="text-stone-300">{existing.objects} furniture items on this floor:</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="furn" className="accent-amber-500" checked={furniture === 'keep'} onChange={() => setFurniture('keep')} /> Keep them where they are</label>
                    <label className="flex items-center gap-2"><input type="radio" name="furn" className="accent-amber-500" checked={furniture === 'remove'} onChange={() => setFurniture('remove')} /> Remove them</label>
                  </fieldset>
                )}
                <p className="text-[11px] text-stone-500">A “Before import” version is saved automatically, and Undo reverts the whole import.</p>
              </div>
              {scale && planSize && (
                <div className="rounded-md bg-stone-800/50 p-3 text-xs text-stone-300">
                  Scale: {fmtLen(scale.length, units)} reference · sheet {fmtLen(planSize.w, units)} × {fmtLen(planSize.h, units)}
                  {mode === 'detected' && accepted && <> · {accepted.walls.length} walls, {accepted.openings.length} openings, {accepted.rooms.length} rooms</>}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Btn variant="outline" onClick={() => setStep(2)}>Back</Btn>
                <Btn variant="primary" className="ml-auto" onClick={generate} disabled={mode === 'detected' && !accepted}><Box size={14} /> {mode === 'manual' ? 'Place plan for tracing' : 'Generate 3D model'}</Btn>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
