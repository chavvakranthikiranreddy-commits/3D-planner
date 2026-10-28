import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Upload, RotateCw, RotateCcw, Ruler, ScanLine, Box, Loader2, AlertTriangle, CheckCircle2, FileImage } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Btn, Field, NumField, inputCls } from '../components/ui';
import { MAX_UPLOAD_BYTES, loadImage, pdfPageCount, readAsDataUrl, renderPdfPage, sniffType, toCanvas } from '../lib/image';
import { detectPlan, toGray, type DetectResult } from '../lib/detect';
import { makeRoom, makeWall, uid } from '../lib/templates';
import { dist, validateGeometry } from '../lib/geometry';
import type { Opening, Pt } from '../lib/types';

const STEPS = ['Upload', 'Scale', 'Detect & review', 'Generate 3D'];

/** SVG stage with wheel-zoom and drag-pan; reports clicks in image pixel coordinates. */
function Stage({ w, h, href, onClick, children, cursor = 'crosshair' }: { w: number; h: number; href: string; onClick?: (p: Pt) => void; children?: ReactNode; cursor?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w, h });
  useEffect(() => setVb({ x: 0, y: 0, w, h }), [w, h]);
  const down = useRef<{ x: number; y: number; vb: typeof vb } | null>(null);
  const toImg = (e: { clientX: number; clientY: number }) => {
    const pt = ref.current!.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ref.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  return (
    <svg ref={ref} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-full w-full touch-none select-none" style={{ cursor }}
      onWheel={(e) => {
        const p = toImg(e);
        const k = Math.exp(e.deltaY * 0.0015);
        setVb((v) => { const nw = Math.min(w * 2, Math.max(w / 40, v.w * k)); const s = nw / v.w; return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w: nw, h: v.h * s }; });
      }}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); down.current = { x: e.clientX, y: e.clientY, vb }; }}
      onPointerMove={(e) => {
        const d = down.current;
        if (!d || (Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4)) return;
        const r = ref.current!.getBoundingClientRect();
        const s = Math.max(d.vb.w / r.width, d.vb.h / r.height);
        setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.x) * s, y: d.vb.y - (e.clientY - d.y) * s });
      }}
      onPointerUp={(e) => {
        const d = down.current; down.current = null;
        if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) onClick?.(toImg(e));
      }}>
      <image href={href} x={0} y={0} width={w} height={h} />
      {children}
    </svg>
  );
}

export default function ImportWizard() {
  const project = useEditor((s) => s.project)!;
  const settings = useEditor((s) => s.settings);
  const { navigate, updateProject, mutate, toast, setView, activeFloorId } = useEditor.getState();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [pdf, setPdf] = useState<{ data: ArrayBuffer; pages: number; page: number } | null>(null);
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rot, setRot] = useState(0);
  const [img, setImg] = useState<{ url: string; w: number; h: number; canvas: HTMLCanvasElement } | null>(null);
  const [units, setUnits] = useState(project.units);
  const [calPts, setCalPts] = useState<Pt[]>([]);
  const [calLen, setCalLen] = useState(0);
  const [ppm, setPpm] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<'browser' | 'server'>('browser');
  const [replace, setReplace] = useState(true);
  const floor = project.scene.floors.find((f) => f.id === activeFloorId) ?? project.scene.floors[0];
  const [wallH, setWallH] = useState(floor.ceilingHeight);

  // rebuild working image whenever source / rotation changes
  useEffect(() => {
    if (!baseCanvas) return;
    const c = toCanvas(baseCanvas, 2400, rot);
    setImg({ url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height, canvas: c });
    setCalPts([]); setPpm(null); setResult(null);
  }, [baseCanvas, rot]);

  const onFile = async (f: File) => {
    setError(null);
    if (f.size > MAX_UPLOAD_BYTES) { setError(`File is ${(f.size / 1e6).toFixed(1)} MB — the limit is 25 MB.`); return; }
    const t = await sniffType(f);
    if (!t) { setError('Unsupported file. Upload a PDF, PNG or JPG floor plan (CAD formats like DWG/DXF are not supported yet).'); return; }
    setBusy(true);
    setFileName(f.name);
    try {
      if (t === 'pdf') {
        const data = await f.arrayBuffer();
        const pages = await pdfPageCount(data);
        if (pages > 50) throw new Error('PDFs are limited to 50 pages.');
        setPdf({ data, pages, page: 1 });
        setBaseCanvas(await renderPdfPage(data, 1));
      } else {
        setPdf(null);
        const im = await loadImage(await readAsDataUrl(f));
        setBaseCanvas(toCanvas(im, 3000));
      }
      setRot(0);
    } catch (e) {
      setError((e as Error).message || 'The file could not be read. It may be corrupted or password-protected.');
    } finally { setBusy(false); }
  };
  const choosePage = async (page: number) => {
    if (!pdf) return;
    setBusy(true);
    try { setPdf({ ...pdf, page }); setBaseCanvas(await renderPdfPage(pdf.data, page)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const applyScale = () => {
    if (calPts.length < 2 || !(calLen > 0)) return;
    const meters = units === 'ft' ? calLen / 3.28084 : calLen;
    const v = dist(calPts[0], calPts[1]) / meters;
    setPpm(v);
    if (units !== project.units) updateProject((p) => { p.units = units; });
  };
  const planSize = ppm && img ? { w: img.w / ppm, h: img.h / ppm } : null;
  const suspicious = planSize && (planSize.w > 150 || planSize.h > 150 || planSize.w < 3);

  const runDetect = async () => {
    if (!img || !ppm) return;
    setBusy(true); setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      let res: DetectResult;
      if (engine === 'server' && settings.backendUrl) {
        const blob: Blob = await new Promise((r) => img.canvas.toBlob((b) => r(b!), 'image/png'));
        const fd = new FormData();
        fd.append('file', blob, 'plan.png');
        const qs = new URLSearchParams({ px_per_meter: String(ppm), ...(threshold ? { threshold: String(threshold) } : {}) });
        const r = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/blueprints/detect?${qs}`, { method: 'POST', body: fd, headers: settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {} });
        if (!r.ok) throw new Error(`Server detection failed (${r.status}). Try the in-browser engine.`);
        res = await r.json();
      } else {
        // run on a ≤1600 px copy for speed, then scale results back
        const small = toCanvas(img.canvas, 1600);
        const k = img.w / small.width;
        const d = small.getContext('2d')!.getImageData(0, 0, small.width, small.height);
        const r = detectPlan(toGray(d), { pxPerMeter: ppm / k, darkThreshold: threshold ?? undefined });
        res = {
          ...r,
          walls: r.walls.map((w) => ({ ...w, x0: w.x0 * k, y0: w.y0 * k, x1: w.x1 * k, y1: w.y1 * k, thickness: w.thickness * k })),
          openings: r.openings.map((o) => ({ ...o, center: o.center * k, width: o.width * k })),
          rooms: r.rooms.map((m) => ({ ...m, x0: m.x0 * k, y0: m.y0 * k, x1: m.x1 * k, y1: m.y1 * k, areaPx: m.areaPx * k * k })),
        };
        if (!threshold) setThreshold(r.stats.threshold);
      }
      setResult(res);
      setExcluded(new Set());
      if (res.walls.length === 0) setError('No walls were found. Try adjusting the ink threshold, or skip detection and trace the plan manually.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const generate = (withDetections: boolean) => {
    if (!img || !ppm) return;
    const P = (x: number, y: number): Pt => ({ x: +(x / ppm).toFixed(3), y: +(y / ppm).toFixed(3) });
    const fId = floor.id;
    mutate((s) => {
      if (replace) {
        const ids = new Set(s.walls.filter((w) => w.floorId === fId).map((w) => w.id));
        s.walls = s.walls.filter((w) => w.floorId !== fId);
        s.openings = s.openings.filter((o) => !ids.has(o.wallId));
        s.rooms = s.rooms.filter((r) => r.floorId !== fId);
      }
      if (!withDetections || !result) return;
      const idMap = new Map<number, string>();
      result.walls.forEach((w) => {
        if (excluded.has('w' + w.id)) return;
        const t = Math.max(0.05, Math.min(0.6, +(w.thickness / ppm).toFixed(3)));
        const wall = makeWall(fId, P(w.x0, w.y0), P(w.x1, w.y1), t, wallH, 'detected');
        wall.confidence = w.confidence;
        wall.materialId = 'paint-white';
        idMap.set(w.id, wall.id);
        s.walls.push(wall);
      });
      result.openings.forEach((o, i) => {
        const wid = idMap.get(o.wallId);
        if (!wid || excluded.has('o' + i)) return;
        const op: Opening = { id: uid(), wallId: wid, type: o.type, offset: +(o.center / ppm).toFixed(3), width: +(o.width / ppm).toFixed(3), height: o.type === 'door' ? 2.1 : 1.2, sill: o.type === 'door' ? 0 : 0.9, source: 'detected', confidence: o.confidence };
        s.openings.push(op);
      });
      result.rooms.forEach((r, i) => {
        if (excluded.has('r' + i)) return;
        const room = makeRoom(fId, `Room ${i + 1}`, 'other', [P(r.x0, r.y0), P(r.x1, r.y0), P(r.x1, r.y1), P(r.x0, r.y1)], 'tile-vitrified', 'detected');
        s.rooms.push(room);
      });
      s.floors.forEach((f) => { if (f.id === fId) f.ceilingHeight = wallH; });
    });
    updateProject((p) => {
      p.blueprint = { dataUrl: img.url, fileName, widthPx: img.w, heightPx: img.h, pxPerMeter: ppm, originX: 0, originY: 0, opacity: 0.45, visible: true, floorId: fId };
    });
    const st = useEditor.getState().project!.scene;
    const issues = validateGeometry(st.walls.filter((w) => w.floorId === fId), st.openings);
    toast(withDetections ? `3D model generated${issues.length ? ` — ${issues.length} geometry note(s) to review` : ''}. Confirm detected items in the layers panel.` : 'Blueprint placed as a tracing underlay. Use the Wall and Room tools to trace it.', 'success');
    setView('split');
    navigate({ page: 'editor', id: project.id });
  };

  const stats = useMemo(() => {
    if (!result) return null;
    const low = result.walls.filter((w) => w.confidence < 0.6).length;
    return { walls: result.walls.length - [...excluded].filter((e) => e[0] === 'w').length, low, doors: result.openings.filter((o) => o.type === 'door').length, windows: result.openings.filter((o) => o.type === 'window').length, rooms: result.rooms.length };
  }, [result, excluded]);

  const toggleEx = (k: string) => { const n = new Set(excluded); if (n.has(k)) n.delete(k); else n.add(k); setExcluded(n); };
  const sw = img ? Math.max(2, img.w / 400) : 2;

  return (
    <div className="flex h-dvh flex-col bg-stone-950 text-stone-200">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-stone-800 bg-stone-900 px-3">
        <Btn title="Back" onClick={() => navigate({ page: 'editor', id: project.id })}><ArrowLeft size={16} /></Btn>
        <span className="text-sm font-semibold text-stone-100">Import blueprint · {project.name}</span>
        <ol className="ml-auto hidden items-center gap-1 md:flex">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${i === step ? 'bg-amber-500 text-stone-950' : i < step ? 'text-emerald-400' : 'text-stone-500'}`}>
              {i < step ? <CheckCircle2 size={12} /> : <span className="font-mono">{i + 1}</span>} {s}
            </li>
          ))}
        </ol>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-[45vh] flex-1 bg-[#1f1d1b]">
          {!img ? (
            <label className="absolute inset-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-stone-700 text-center hover:border-amber-500"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}>
              {busy ? <Loader2 className="animate-spin text-amber-400" size={32} /> : <Upload className="text-stone-500" size={32} />}
              <span className="text-base font-medium text-stone-200">Drop your floor plan here or click to browse</span>
              <span className="text-sm text-stone-500">PDF, PNG or JPG · up to 25 MB · clean single-floor plans work best</span>
              <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
              <a href={`${import.meta.env.BASE_URL}samples/sample-plan.png`} download onClick={(e) => e.stopPropagation()} className="mt-2 text-xs text-amber-400 underline">Download a sample plan to try</a>
            </label>
          ) : (
            <Stage w={img.w} h={img.h} href={img.url} cursor={step === 1 ? 'crosshair' : 'grab'} onClick={(p) => { if (step === 1) setCalPts((c) => (c.length >= 2 ? [p] : [...c, p])); }}>
              {step === 1 && calPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={sw * 3} fill="#22d3ee" stroke="#083344" strokeWidth={sw / 2} />)}
              {step === 1 && calPts.length === 2 && <line x1={calPts[0].x} y1={calPts[0].y} x2={calPts[1].x} y2={calPts[1].y} stroke="#22d3ee" strokeWidth={sw} />}
              {step >= 2 && result && (
                <g>
                  {result.rooms.map((r, i) => !excluded.has('r' + i) && <rect key={'r' + i} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="rgba(52,211,153,0.12)" stroke="#34d399" strokeWidth={sw / 2} strokeDasharray={`${sw * 3} ${sw * 2}`} onClick={() => toggleEx('r' + i)} />)}
                  {result.walls.map((w) => (
                    <line key={w.id} x1={w.x0} y1={w.y0} x2={w.x1} y2={w.y1} strokeWidth={Math.max(w.thickness, sw * 2)} strokeLinecap="square"
                      stroke={excluded.has('w' + w.id) ? 'rgba(120,113,108,0.5)' : w.confidence < 0.6 ? 'rgba(251,146,60,0.85)' : 'rgba(245,158,11,0.75)'}
                      style={{ cursor: 'pointer' }} onClick={() => toggleEx('w' + w.id)} />
                  ))}
                  {result.openings.map((o, i) => {
                    const w = result.walls.find((x) => x.id === o.wallId);
                    if (!w) return null;
                    const h = w.orient === 'h';
                    const cx = h ? w.x0 + o.center : w.x0, cy = h ? w.y0 : w.y0 + o.center;
                    return <rect key={'o' + i} x={cx - (h ? o.width / 2 : w.thickness)} y={cy - (h ? w.thickness : o.width / 2)} width={h ? o.width : w.thickness * 2} height={h ? w.thickness * 2 : o.width}
                      fill={excluded.has('o' + i) ? 'none' : o.type === 'door' ? 'rgba(244,114,182,0.6)' : 'rgba(56,189,248,0.6)'} stroke={o.type === 'door' ? '#f472b6' : '#38bdf8'} strokeWidth={sw / 2} onClick={() => toggleEx('o' + i)} style={{ cursor: 'pointer' }} />;
                  })}
                </g>
              )}
            </Stage>
          )}
          {img && <p className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-stone-300">Scroll to zoom · drag to pan{step >= 2 ? ' · click a detection to include/exclude it' : ''}</p>}
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-stone-800 bg-stone-900 p-5 md:w-[360px] md:border-l md:border-t-0">
          {error && <div className="mb-4 flex gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">1 · Upload plan</h2>
              {!img ? <p className="text-sm text-stone-400">Supported: PDF, PNG and JPG. Files are validated by content and processed entirely in your browser unless you choose the server engine.</p> : (
                <>
                  <div className="flex items-center gap-2 rounded-md bg-stone-800/60 p-2 text-sm"><FileImage size={16} className="text-stone-400" /><span className="flex-1 truncate">{fileName}</span><span className="text-xs text-stone-500">{img.w}×{img.h}px</span></div>
                  {pdf && pdf.pages > 1 && (
                    <Field label={`PDF page (${pdf.pages} pages)`}>
                      <select className={inputCls} value={pdf.page} onChange={(e) => void choosePage(+e.target.value)}>
                        {Array.from({ length: pdf.pages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Orientation">
                    <div className="flex gap-2"><Btn variant="outline" onClick={() => setRot((r) => (r + 270) % 360)}><RotateCcw size={14} /> Left</Btn><Btn variant="outline" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw size={14} /> Right</Btn></div>
                  </Field>
                  <div className="flex gap-2 pt-2">
                    <label className="cursor-pointer"><span className="inline-flex rounded-md border border-stone-700 px-3 py-1.5 text-sm hover:bg-stone-800">Replace file</span><input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} /></label>
                    <Btn variant="primary" className="ml-auto" onClick={() => setStep(1)}>Next: set scale</Btn>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">2 · Calibrate scale</h2>
              <p className="text-sm text-stone-400">Click both ends of a dimension you know — ideally a long one, like an overall outside measurement — then enter its real length. Archiform never guesses the scale.</p>
              <div className="flex items-center gap-2 text-sm"><Ruler size={16} className="text-cyan-400" />{calPts.length === 0 ? 'Click the first point' : calPts.length === 1 ? 'Click the second point' : `Line: ${dist(calPts[0], calPts[1]).toFixed(0)} px`}</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Real length"><NumField value={calLen} min={0} step={0.1} onCommit={setCalLen} /></Field>
                <Field label="Units">
                  <select className={inputCls} value={units} onChange={(e) => setUnits(e.target.value as 'm' | 'ft')}><option value="m">metres</option><option value="ft">feet</option></select>
                </Field>
              </div>
              <Btn variant="outline" className="w-full" disabled={calPts.length < 2 || !(calLen > 0)} onClick={applyScale}>Apply scale</Btn>
              {ppm && planSize && (
                <div className={`rounded-md p-3 text-sm ${suspicious ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}`}>
                  {ppm.toFixed(1)} px per metre → the full sheet is {planSize.w.toFixed(1)} × {planSize.h.toFixed(1)} m.
                  {suspicious && <p className="mt-1">That size looks unusual for a building — please double-check the points and length.</p>}
                </div>
              )}
              <div className="flex gap-2 pt-2"><Btn variant="outline" onClick={() => setStep(0)}>Back</Btn><Btn variant="primary" className="ml-auto" disabled={!ppm} onClick={() => { setStep(2); if (!result) void runDetect(); }}>Next: detect</Btn></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">3 · Detect & review</h2>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Engine">
                  <select className={inputCls} value={engine} onChange={(e) => setEngine(e.target.value as 'browser' | 'server')}>
                    <option value="browser">In-browser (private)</option>
                    <option value="server" disabled={!settings.backendUrl}>Server · OpenCV{settings.backendUrl ? '' : ' (not set)'}</option>
                  </select>
                </Field>
                <Field label={`Ink threshold ${threshold ?? 'auto'}`}><input type="range" min={40} max={220} value={threshold ?? 128} onChange={(e) => setThreshold(+e.target.value)} className="mt-2 w-full accent-amber-500" /></Field>
              </div>
              <Btn variant="outline" className="w-full" onClick={() => void runDetect()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} {result ? 'Re-run detection' : 'Run detection'}</Btn>
              {stats && (
                <div className="space-y-2 rounded-md bg-stone-800/50 p-3 text-sm">
                  <div className="flex justify-between"><span>Walls</span><span>{stats.walls} {stats.low > 0 && <Badge tone="amber">{stats.low} uncertain</Badge>}</span></div>
                  <div className="flex justify-between"><span>Doors / windows</span><span>{stats.doors} / {stats.windows}</span></div>
                  <div className="flex justify-between"><span>Rooms</span><span>{stats.rooms}</span></div>
                  <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-stone-400">
                    <span className="flex items-center gap-1"><i className="h-2 w-3 bg-amber-500" />wall</span><span className="flex items-center gap-1"><i className="h-2 w-3 bg-orange-400" />uncertain</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-3 bg-pink-400" />door</span><span className="flex items-center gap-1"><i className="h-2 w-3 bg-sky-400" />window</span><span className="flex items-center gap-1"><i className="h-2 w-3 border border-emerald-400" />room</span>
                  </div>
                </div>
              )}
              <p className="text-xs text-stone-500">Click any detection on the plan to exclude it. After generating you can drag wall ends, add missing doors and confirm each detected item in the editor.</p>
              <div className="flex gap-2 pt-2"><Btn variant="outline" onClick={() => setStep(1)}>Back</Btn><Btn variant="primary" className="ml-auto" disabled={!result || busy} onClick={() => setStep(3)}>Next</Btn></div>
              <button className="w-full text-center text-xs text-stone-400 underline" onClick={() => generate(false)}>Skip detection — trace the plan manually</button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-stone-50">4 · Generate 3D</h2>
              <Field label="Wall / ceiling height (m)"><NumField value={wallH} min={2.2} max={8} step={0.05} onCommit={setWallH} /></Field>
              <label className="flex items-center gap-2 text-sm text-stone-300"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-amber-500" /> Replace existing walls and rooms on {floor.name}</label>
              <div className="rounded-md bg-stone-800/50 p-3 text-xs text-stone-400">
                Detected walls, doors, windows and rooms are imported with their confidence scores and highlighted for review. The blueprint stays as an adjustable underlay so you can verify every line.
              </div>
              <div className="flex gap-2 pt-2"><Btn variant="outline" onClick={() => setStep(2)}>Back</Btn><Btn variant="primary" className="ml-auto" onClick={() => generate(true)}><Box size={14} /> Generate 3D model</Btn></div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
