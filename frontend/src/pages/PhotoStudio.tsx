import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ImagePlus, MousePointer2, PenLine, Wand2, Move, Ruler, Trash2, Download, Eye, EyeOff, Columns2, Box, Loader2,
  Sticker, Check, AlertTriangle, Paintbrush, Copy,
} from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Btn, Empty, Field, LenField, Section, TextInput, inputCls } from '../components/ui';
import type { Material, PhotoRegion, PhotoSticker, Pt, RoomType, SitePhoto } from '../lib/types';
import { analyse, defaultFinish, floorMapper, guessSurface, openingOnSide, orderQuad, regionMask, renderRegions, type Base } from '../lib/photo';
import { patternCanvas, materialSwatch } from '../three/textures';
import { MAX_UPLOAD_BYTES, loadImage, readAsDataUrl, removeBackground, sniffType, toCanvas, trimTransparent } from '../lib/image';
import { makeRoom, makeWall, uid } from '../lib/templates';
import { bbox, fmtLen, setWallSpanMaterial } from '../lib/geometry';
import { parseColorInput } from '../lib/materials';
import { roomWallSides } from '../lib/placement';
import { downloadDataUrl } from '../lib/capture';

type Mode = 'select' | 'draw' | 'wand' | 'quad' | 'sticker' | 'measure';
const PALETTE = [
  ['#f2ece1', 'Warm White'], ['#e6d9c4', 'Beige'], ['#d8cfc2', 'Greige'], ['#a8b5a0', 'Sage'], ['#3d4b63', 'Muted Navy'], ['#e3b9a8', 'Plaster Pink'],
  ['#c46a4a', 'Terracotta'], ['#8a8a5c', 'Olive'], ['#a46a4f', 'Clay'], ['#2c3a52', 'Deep Navy'], ['#3d3d3f', 'Charcoal'], ['#fbfaf7', 'Ceiling White'],
] as const;
const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'balcony', 'utility', 'pooja', 'other'];

interface Opening { id: string; type: 'door' | 'window'; pts: Pt[]; height: number; sill: number }

export default function PhotoStudio() {
  const project = useEditor((s) => s.project)!;
  const { navigate, updateProject, mutate, toast, activeFloorId } = useEditor.getState();
  const photos = project.photos ?? [];
  const [activeId, setActiveId] = useState<string | null>(photos[0]?.id ?? null);
  const photo = photos.find((p) => p.id === activeId) ?? null;
  const [mode, setMode] = useState<Mode>('select');
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [fenceFor, setFenceFor] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState<string | null>(null);
  const baseRef = useRef<{ key: string; base: Base; img: HTMLImageElement } | null>(null);
  const masks = useRef(new Map<string, Uint8ClampedArray>());
  const maskKeys = useRef(new Map<string, string>());
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { kind: 'poly' | 'quad' | 'sticker' | 'floor' | 'open'; i: number; id?: string; dx?: number; dy?: number }>(null);
  // measure → 3D state
  const [floorPts, setFloorPts] = useState<Pt[]>(photo?.measure?.floor ?? []);
  const [sideA, setSideA] = useState(photo?.measure?.sideA ?? 4);
  const [sideB, setSideB] = useState(photo?.measure?.sideB ?? 3.5);
  const [height, setHeight] = useState(photo?.measure?.height ?? 3);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [placing, setPlacing] = useState<Opening['type'] | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('bedroom');
  const [thickness, setThickness] = useState(0.23);
  const [applyFinishes, setApplyFinishes] = useState(true);

  useEffect(() => { setSelId(null); setDraft([]); setFloorPts(photo?.measure?.floor ?? []); setOpenings([]); setRoomName(photo?.name.replace(/\.[^.]+$/, '') ?? ''); masks.current.clear(); maskKeys.current.clear(); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPhoto = useCallback((fn: (p: SitePhoto) => void) => {
    if (!activeId) return;
    updateProject((pr) => { const p = pr.photos?.find((x) => x.id === activeId); if (p) fn(p); });
  }, [activeId, updateProject]);

  // ── uploads
  const addPhotos = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const f of [...files]) {
        const t = await sniffType(f);
        if (!t || t === 'pdf') { toast(`${f.name}: use JPG, PNG or WebP photos (iPhone HEIC photos: export as JPG first).`, 'error'); continue; }
        if (f.size > MAX_UPLOAD_BYTES) { toast(`${f.name} is larger than 25 MB.`, 'error'); continue; }
        const img = await loadImage(await readAsDataUrl(f));
        const c = toCanvas(img, 1600);
        const assetId = 'ph-' + uid();
        const ph: SitePhoto = { id: uid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 60), assetId, w: c.width, h: c.height, createdAt: Date.now(), regions: [], stickers: [] };
        updateProject((pr) => { pr.assets = { ...pr.assets, [assetId]: c.toDataURL('image/jpeg', 0.9) }; pr.photos = [...(pr.photos ?? []), ph]; });
        setActiveId(ph.id);
      }
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  // ── base analysis (once per photo)
  useEffect(() => {
    if (!photo) { setRendered(null); return; }
    const url = project.assets[photo.assetId];
    if (!url || baseRef.current?.key === photo.id) return;
    let alive = true;
    void loadImage(url).then((img) => {
      if (!alive) return;
      const c = document.createElement('canvas'); c.width = photo.w; c.height = photo.h;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, photo.w, photo.h);
      baseRef.current = { key: photo.id, base: analyse(ctx.getImageData(0, 0, photo.w, photo.h)), img };
      setRenderTick((n) => n + 1);
    });
    return () => { alive = false; };
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [renderTick, setRenderTick] = useState(0);

  // ── render (debounced)
  useEffect(() => {
    const b = baseRef.current;
    if (!photo || !b || b.key !== photo.id) return;
    const t = setTimeout(() => {
      // invalidate masks whose geometry changed
      for (const r of photo.regions) {
        const k = JSON.stringify([r.polygon, r.wand]);
        if (maskKeys.current.get(r.id) !== k) { masks.current.delete(r.id); maskKeys.current.set(r.id, k); }
      }
      const img = renderRegions(b.base, photo.regions, { materials: project.scene.materials, pattern: (m: Material) => patternCanvas(m, 256), highlight: mode === 'select' || mode === 'quad' ? selId : null }, masks.current);
      const c = document.createElement('canvas'); c.width = photo.w; c.height = photo.h;
      const ctx = c.getContext('2d')!; ctx.putImageData(img, 0, 0);
      for (const st of photo.stickers) {
        const su = project.assets[st.assetId]; if (!su) continue;
        const im = stickerCache.get(st.assetId);
        if (im) { ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.rotation); ctx.drawImage(im, -st.w / 2, -(st.w * im.height / im.width) / 2, st.w, st.w * im.height / im.width); ctx.restore(); }
        else void loadImage(su).then((x) => { stickerCache.set(st.assetId, x); setRenderTick((n) => n + 1); });
      }
      setRendered(c.toDataURL('image/jpeg', 0.92));
    }, 60);
    return () => clearTimeout(t);
  }, [photo, selId, mode, renderTick, project.scene.materials, project.assets]);

  const sel = photo?.regions.find((r) => r.id === selId) ?? null;
  const selSticker = photo?.stickers.find((s) => s.id === selId) ?? null;

  const toImg = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse()); return { x: p.x, y: p.y };
  };

  const finishDraft = () => {
    if (!photo || draft.length < 3) { setDraft([]); return; }
    if (fenceFor) {
      const pts = draft;
      setPhoto((p) => { const r = p.regions.find((x) => x.id === fenceFor); if (r) r.polygon = pts; });
      setSelId(fenceFor); setFenceFor(null); setDraft([]); setMode('select');
      return;
    }
    const c = { x: draft.reduce((a, p) => a + p.x, 0) / draft.length, y: draft.reduce((a, p) => a + p.y, 0) / draft.length };
    const surface = guessSurface(c, photo.h);
    const r: PhotoRegion = { id: uid(), name: `${surface[0].toUpperCase()}${surface.slice(1)} ${photo.regions.filter((x) => x.surface === surface).length + 1}`, surface, polygon: draft, quad: draft.length === 4 ? orderQuad(draft) : undefined, finish: defaultFinish(surface), smooth: 0.6, visible: true };
    setPhoto((p) => { p.regions = [...p.regions, r]; });
    setSelId(r.id); setDraft([]); setMode('select');
  };

  const onDown = (e: React.PointerEvent) => {
    if (!photo) return;
    const p = toImg(e);
    if (mode === 'draw') {
      if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) < photo.w / 80) { finishDraft(); return; }
      setDraft([...draft, p]); return;
    }
    if (mode === 'wand') {
      const surface = guessSurface(p, photo.h);
      const r: PhotoRegion = { id: uid(), name: `${surface[0].toUpperCase()}${surface.slice(1)} ${photo.regions.filter((x) => x.surface === surface).length + 1}`, surface, polygon: [], wand: { seed: p, tolerance: 18 }, finish: defaultFinish(surface), smooth: 0.6, visible: true };
      setPhoto((ph) => { ph.regions = [...ph.regions, r]; });
      setSelId(r.id); setMode('select');
      toast('Area selected by colour. Adjust “Colour tolerance” if it spills over or misses parts, or draw an outline to limit it.', 'info');
      return;
    }
    if (mode === 'measure') {
      if (placing) {
        setOpenings((os) => {
          const last = os[os.length - 1];
          if (last && last.pts.length === 1) return os.map((o) => (o === last ? { ...o, pts: [...o.pts, p] } : o));
          return [...os, { id: uid(), type: placing, pts: [p], height: placing === 'door' ? 2.1 : 1.2, sill: placing === 'door' ? 0 : 0.9 }];
        });
        if (openings[openings.length - 1]?.pts.length === 1) setPlacing(null);
        return;
      }
      if (floorPts.length < 4) setFloorPts([...floorPts, p]);
      return;
    }
    if (mode === 'select') {
      // click inside a region mask selects it (topmost first)
      const b = baseRef.current;
      if (b) {
        const ix = Math.round(p.y) * photo.w + Math.round(p.x);
        const hit = [...photo.regions].reverse().find((r) => { let m = masks.current.get(r.id); if (!m) { m = regionMask(b.base, r); masks.current.set(r.id, m); } return m[ix] > 127; });
        setSelId(hit?.id ?? null);
      }
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !photo) return;
    const p = toImg(e);
    if (d.kind === 'poly' && sel) setPhoto((ph) => { const r = ph.regions.find((x) => x.id === sel.id)!; r.polygon = r.polygon.map((q, i) => (i === d.i ? p : q)); });
    if (d.kind === 'quad' && sel) setPhoto((ph) => { const r = ph.regions.find((x) => x.id === sel.id)!; const q = [...(r.quad ?? defaultQuad(r))]; q[d.i] = p; r.quad = q; });
    if (d.kind === 'sticker' && d.id) setPhoto((ph) => { const s = ph.stickers.find((x) => x.id === d.id)!; s.x = p.x - (d.dx ?? 0); s.y = p.y - (d.dy ?? 0); });
    if (d.kind === 'floor') setFloorPts((fs) => fs.map((q, i) => (i === d.i ? p : q)));
    if (d.kind === 'open' && d.id) setOpenings((os) => os.map((o) => (o.id === d.id ? { ...o, pts: o.pts.map((q, i) => (i === d.i ? p : q)) } : o)));
  };
  const defaultQuad = (r: PhotoRegion): Pt[] => {
    const pts = r.polygon.length >= 3 ? r.polygon : r.wand ? [r.wand.seed] : [];
    const b = bbox(pts.length > 1 ? pts : [{ x: 0, y: 0 }, { x: photo!.w, y: photo!.h }]);
    return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
  };

  // ── stickers (product cut-outs)
  const addSticker = async (f: File) => {
    if (!photo) return;
    const t = await sniffType(f);
    if (!t || t === 'pdf') { toast('Use a PNG, JPG or WebP product photo.', 'error'); return; }
    const img = await loadImage(await readAsDataUrl(f));
    let c = toCanvas(img, 900);
    const cut = trimTransparent(removeBackground(c, 36));
    const d = cut.getContext('2d')!.getImageData(0, 0, cut.width, cut.height).data;
    let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 10) clear++;
    const removed = clear / (cut.width * cut.height) > 0.05;
    c = removed ? cut : c;
    const assetId = 'st-' + uid();
    const st: PhotoSticker = { id: uid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), assetId, x: photo.w / 2, y: photo.h * 0.68, w: photo.w * 0.35, rotation: 0 };
    updateProject((pr) => { pr.assets = { ...pr.assets, [assetId]: c.toDataURL('image/png') }; const p = pr.photos!.find((x) => x.id === photo.id)!; p.stickers = [...p.stickers, st]; });
    setSelId(st.id); setMode('select');
    if (!removed) toast('The product photo has a busy background, so it was kept. Plain-background product shots work best.', 'info');
  };

  // ── apply photo finishes to the linked 3D room
  const applyToRoom = (roomId: string, ph: SitePhoto) => {
    const finishMat = (r: PhotoRegion): Material | string => r.finish.kind === 'material' ? r.finish.materialId : { id: `custom-${r.finish.hex.slice(1)}-90-0`, name: `Custom ${r.finish.hex.toUpperCase()}`, kind: 'paint', colorHex: r.finish.hex, roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 45 };
    const wall = ph.regions.find((r) => r.surface === 'wall' && r.visible), floor = ph.regions.find((r) => r.surface === 'floor' && r.visible), ceil = ph.regions.find((r) => r.surface === 'ceiling' && r.visible);
    mutate((s) => {
      const room = s.rooms.find((x) => x.id === roomId); if (!room) return;
      const use = (r?: PhotoRegion) => { if (!r) return null; const m = finishMat(r); if (typeof m === 'string') return m; s.materials[m.id] = m; return m.id; };
      const wm = use(wall), fm = use(floor), cm = use(ceil);
      if (wm) for (const f of roomWallSides(s, room)) { const w = s.walls.find((x) => x.id === f.wall.id); if (w) setWallSpanMaterial(w, f.side, f.from, f.to, wm); }
      if (fm) room.floorMaterialId = fm;
      if (cm) room.ceilingMaterialId = cm;
    });
    toast('Photo finishes applied to the 3D room.', 'success');
  };

  // ── photo → measured 3D room
  const measureReady = floorPts.length === 4 && sideA > 0.5 && sideB > 0.5 && height >= 2;
  const mapped = useMemo(() => {
    if (!measureReady) return null;
    try {
      // make the click order clockwise on screen so the plan isn't mirrored
      const area = floorPts.reduce((a, p, i) => { const q = floorPts[(i + 1) % 4]; return a + p.x * q.y - q.x * p.y; }, 0);
      const pts = area >= 0 ? floorPts : [floorPts[0], floorPts[3], floorPts[2], floorPts[1]];
      const A = area >= 0 ? sideA : sideB, B = area >= 0 ? sideB : sideA;
      const map = floorMapper(pts, A, B);
      return { A, B, ops: openings.filter((o) => o.pts.length === 2).map((o) => ({ o, at: openingOnSide(map(o.pts[0]), map(o.pts[1]), A, B) })) };
    } catch { return null; }
  }, [measureReady, floorPts, sideA, sideB, openings]);

  const create3D = () => {
    if (!photo || !mapped) return;
    const { A, B, ops } = mapped;
    const t = thickness;
    const floor = project.scene.floors.find((f) => f.id === activeFloorId) ?? project.scene.floors[0];
    const existing = project.scene.walls.filter((w) => w.floorId === floor.id).flatMap((w) => [w.a, w.b]);
    const ox = existing.length ? bbox(existing).maxX + 1.5 : 0, oy = existing.length ? bbox(existing).minY : 0;
    // tape measurements are inside faces: wall centre-lines sit half a thickness outside
    const C = [{ x: -t / 2, y: -t / 2 }, { x: A + t / 2, y: -t / 2 }, { x: A + t / 2, y: B + t / 2 }, { x: -t / 2, y: B + t / 2 }].map((p) => ({ x: +(p.x + ox).toFixed(3), y: +(p.y + oy).toFixed(3) }));
    const walls = C.map((a, i) => makeWall(floor.id, a, C[(i + 1) % 4], t, height));
    const room = makeRoom(floor.id, roomName || photo.name, roomType, [{ x: ox, y: oy }, { x: ox + A, y: oy }, { x: ox + A, y: oy + B }, { x: ox, y: oy + B }], roomType === 'bathroom' ? 'tile-vitrified' : 'tile-vitrified');
    mutate((s) => {
      s.walls.push(...walls);
      s.rooms.push(room);
      for (const { o, at } of ops) {
        s.openings.push({ id: uid(), wallId: walls[at.side].id, type: o.type, offset: +(at.center + t / 2).toFixed(3), width: +Math.max(0.4, at.width).toFixed(3), height: o.height, sill: o.type === 'door' ? 0 : o.sill, source: 'detected', confidence: 0.7 });
      }
      if (!existing.length) s.floors.forEach((f) => { if (f.id === floor.id) f.ceilingHeight = height; });
    });
    setPhoto((p) => { p.roomId = room.id; p.measure = { floor: floorPts, sideA, sideB, height }; });
    if (applyFinishes) setTimeout(() => applyToRoom(room.id, { ...photo, roomId: room.id }), 0);
    toast(`3D room “${room.name}” created (${fmtLen(A, project.units)} × ${fmtLen(B, project.units)}, ${ops.length} opening(s)). Check door and window positions in the plan.`, 'success');
    useEditor.setState({ selection: { kind: 'room', id: room.id } });
    useEditor.getState().setView('split');
    navigate({ page: 'editor', id: project.id });
    setTimeout(() => useEditor.getState().setCamPreset('dollhouse'), 400);
  };

  // ── render helpers
  const r6 = photo ? Math.max(4, photo.w / 220) : 4;
  const origUrl = photo ? project.assets[photo.assetId] : null;
  const linkedRoom = project.scene.rooms.find((r) => r.id === photo?.roomId);
  const surfaceMaterials = (s: PhotoRegion['surface']) => Object.values(project.scene.materials).filter((m) =>
    s === 'floor' ? ['wood', 'stone', 'tile', 'concrete'].includes(m.kind) && !m.id.startsWith('panel') && m.pattern !== 'stone-cladding' && m.pattern !== 'brick'
      : s === 'ceiling' ? m.kind === 'paint' || m.pattern === 'wood-panel' || m.pattern === 'wood'
        : m.pattern && m.pattern !== 'none');

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-stone-950 text-stone-200">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-800 bg-stone-900 px-2">
        <Btn title="Back to the editor" onClick={() => navigate({ page: 'editor', id: project.id })}><ArrowLeft size={16} /></Btn>
        <span className="truncate text-sm font-semibold text-stone-100">Photo Studio · {project.name}</span>
        <div className="ml-2 hidden items-center gap-0.5 sm:flex">
          {([['select', MousePointer2, 'Select & edit'], ['draw', PenLine, 'Draw an area (click corners)'], ['wand', Wand2, 'Magic select by colour'], ['quad', Move, 'Perspective for tiles/textures'], ['measure', Ruler, 'Measure → 3D room']] as const).map(([m, I, label]) => (
            <Btn key={m} title={label} active={mode === m} onClick={() => { setMode(m); setDraft([]); setFenceFor(null); }} disabled={!photo}><I size={16} /></Btn>
          ))}
        </div>
        <div className="flex-1" />
        <Btn title="Before / after" active={compare} onClick={() => setCompare(!compare)} disabled={!photo}><Columns2 size={16} /><span className="hidden md:inline">Before/after</span></Btn>
        <Btn title="Download image" onClick={() => rendered && downloadDataUrl(rendered, `${photo?.name ?? 'photo'}-design.jpg`)} disabled={!rendered}><Download size={16} /></Btn>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* photo list */}
        <aside className="flex shrink-0 gap-2 overflow-x-auto border-b border-stone-800 bg-stone-900 p-1.5 md:w-44 md:p-2 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
          <label className="flex h-16 w-24 shrink-0 cursor-pointer md:h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stone-600 text-[11px] text-stone-300 hover:border-amber-500 md:w-full">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />} Add room photos
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { if (e.target.files?.length) void addPhotos(e.target.files); e.target.value = ''; }} />
          </label>
          {photos.map((p) => (
            <button key={p.id} onClick={() => setActiveId(p.id)} className={`relative h-16 w-24 shrink-0 overflow-hidden md:h-20 rounded-lg border md:w-full ${p.id === activeId ? 'border-amber-500 ring-1 ring-amber-500' : 'border-stone-700'}`}>
              <img src={project.assets[p.assetId]} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">{p.name}{p.roomId ? ' · 3D' : ''}</span>
            </button>
          ))}
        </aside>

        {/* canvas */}
        <main className="relative min-h-[34vh] flex-1 bg-[#1f1d1b]"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void addPhotos(e.dataTransfer.files); }}>
          {!photo ? (
            <div className="absolute inset-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-stone-700 p-6 text-center">
              <ImagePlus size={32} className="text-stone-500" />
              <p className="text-base font-medium text-stone-200">Upload photos of your rooms as they are now</p>
              <p className="max-w-md text-sm text-stone-400">Bare plaster, cement floors and unfinished ceilings are fine. Stand in a corner and include as much floor and wall as you can. Then repaint walls, try tiles and wallpaper, add furniture photos, and turn the room into a measured 3D model.</p>
              <label className="cursor-pointer rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-950">Choose photos
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.length && void addPhotos(e.target.files)} />
              </label>
            </div>
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${photo.w} ${photo.h}`} className="h-full w-full touch-none select-none" style={{ cursor: mode === 'select' ? 'default' : 'crosshair' }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onDoubleClick={() => mode === 'draw' && finishDraft()}>
              <defs><clipPath id="beforeClip"><rect x={0} y={0} width={(photo.w * split) / 100} height={photo.h} /></clipPath></defs>
              {rendered ? <image href={rendered} width={photo.w} height={photo.h} /> : origUrl && <image href={origUrl} width={photo.w} height={photo.h} />}
              {compare && origUrl && (
                <>
                  <image href={origUrl} width={photo.w} height={photo.h} clipPath="url(#beforeClip)" />
                  <line x1={(photo.w * split) / 100} y1={0} x2={(photo.w * split) / 100} y2={photo.h} stroke="#f59e0b" strokeWidth={r6 / 2} />
                  <text x={(photo.w * split) / 100 - r6 * 2} y={r6 * 5} textAnchor="end" fontSize={r6 * 4} fill="#fff" stroke="#000" strokeWidth={r6 / 3} style={{ paintOrder: 'stroke' }}>Before</text>
                  <text x={(photo.w * split) / 100 + r6 * 2} y={r6 * 5} fontSize={r6 * 4} fill="#fff" stroke="#000" strokeWidth={r6 / 3} style={{ paintOrder: 'stroke' }}>After</text>
                </>
              )}
              {/* drawn outline being created */}
              {draft.length > 0 && <polyline points={draft.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={r6 / 2} />}
              {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r6} fill={i === 0 ? '#22d3ee' : '#f59e0b'} />)}
              {/* selected region outline + handles */}
              {sel && mode === 'select' && sel.polygon.length >= 3 && (
                <g>
                  <polygon points={sel.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#f59e0b" strokeWidth={r6 / 2} strokeDasharray={`${r6 * 2} ${r6}`} />
                  {sel.polygon.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r6 * 1.2} fill="#f59e0b" stroke="#000" strokeWidth={r6 / 4} style={{ cursor: 'grab' }}
                    onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { kind: 'poly', i }; }} />)}
                </g>
              )}
              {sel && mode === 'quad' && (() => {
                const q = sel.quad ?? defaultQuad(sel);
                return (
                  <g>
                    <polygon points={q.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(34,211,238,0.08)" stroke="#22d3ee" strokeWidth={r6 / 2} />
                    {q.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r6 * 1.4} fill="#22d3ee" stroke="#000" strokeWidth={r6 / 4} style={{ cursor: 'grab' }}
                      onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { kind: 'quad', i }; }} />)}
                  </g>
                );
              })()}
              {/* stickers: drag to move */}
              {mode === 'select' && photo.stickers.map((st) => {
                const im = stickerCache.get(st.assetId); const hh = im ? st.w * im.height / im.width : st.w;
                return <rect key={st.id} x={st.x - st.w / 2} y={st.y - hh / 2} width={st.w} height={hh} transform={`rotate(${(st.rotation * 180) / Math.PI} ${st.x} ${st.y})`} fill="transparent" stroke={selId === st.id ? '#f59e0b' : 'transparent'} strokeWidth={r6 / 2} strokeDasharray={`${r6 * 2} ${r6}`}
                  style={{ cursor: 'move' }} onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); const p = toImg(e); setSelId(st.id); drag.current = { kind: 'sticker', i: 0, id: st.id, dx: p.x - st.x, dy: p.y - st.y }; }} />;
              })}
              {/* measuring */}
              {mode === 'measure' && (
                <g>
                  {floorPts.length >= 2 && <polygon points={floorPts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(52,211,153,0.15)" stroke="#34d399" strokeWidth={r6 / 2} />}
                  {floorPts.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={r6 * 1.5} fill="#34d399" stroke="#000" strokeWidth={r6 / 4} style={{ cursor: 'grab' }}
                        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { kind: 'floor', i }; }} />
                      <text x={p.x + r6 * 2} y={p.y - r6 * 2} fontSize={r6 * 4} fill="#fff" stroke="#000" strokeWidth={r6 / 3} style={{ paintOrder: 'stroke' }}>{i + 1}</text>
                    </g>
                  ))}
                  {floorPts.length === 4 && [0, 1].map((k) => {
                    const a = floorPts[k], b = floorPts[k + 1];
                    return <text key={k} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - r6 * 2} textAnchor="middle" fontSize={r6 * 3.5} fill="#34d399" stroke="#000" strokeWidth={r6 / 3} style={{ paintOrder: 'stroke' }}>{k === 0 ? `A = ${fmtLen(sideA, project.units)}` : `B = ${fmtLen(sideB, project.units)}`}</text>;
                  })}
                  {openings.map((o) => (
                    <g key={o.id}>
                      {o.pts.length === 2 && <line x1={o.pts[0].x} y1={o.pts[0].y} x2={o.pts[1].x} y2={o.pts[1].y} stroke={o.type === 'door' ? '#f472b6' : '#38bdf8'} strokeWidth={r6} />}
                      {o.pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r6 * 1.2} fill={o.type === 'door' ? '#f472b6' : '#38bdf8'} stroke="#000" strokeWidth={r6 / 4}
                        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { kind: 'open', i, id: o.id }; }} />)}
                    </g>
                  ))}
                </g>
              )}
            </svg>
          )}
          {photo && compare && (
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="Before/after split" className="absolute inset-x-6 bottom-4 accent-amber-500" />
          )}
          {photo && mode === 'draw' && (
            <div className="absolute left-1/2 top-14 sm:top-3 flex -translate-x-1/2 items-center gap-2 rounded-md bg-stone-900/90 px-3 py-1.5 text-xs text-stone-300">
              {fenceFor ? 'Click around the part to keep (it can be rough) · click the first point to finish' : 'Click the corners of the wall, ceiling or floor area · click the first point to finish'}
              {draft.length >= 3 && <button onClick={finishDraft} className="rounded bg-amber-500 px-2 py-0.5 font-semibold text-stone-950">Finish</button>}
              {(draft.length > 0 || fenceFor) && <button onClick={() => { setDraft([]); if (fenceFor) { setSelId(fenceFor); setFenceFor(null); setMode('select'); } }} className="rounded bg-stone-700 px-2 py-0.5">Cancel</button>}
            </div>
          )}
          {photo && mode === 'wand' && <div className="pointer-events-none absolute left-1/2 top-14 sm:top-3 -translate-x-1/2 rounded-md bg-stone-900/90 px-3 py-1.5 text-xs text-stone-300">Click a wall, ceiling or floor — similar colours around it are selected</div>}
          {photo && mode === 'quad' && <div className="pointer-events-none absolute left-1/2 top-14 sm:top-3 -translate-x-1/2 rounded-md bg-stone-900/90 px-3 py-1.5 text-xs text-stone-300">{sel ? 'Drag the 4 blue corners onto the corners of the surface so tiles follow its perspective' : 'Select an area first'}</div>}
          {/* mobile tools */}
          {photo && (
            <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1 rounded-full bg-stone-900/95 p-1 shadow-lg sm:hidden">
              {([['select', MousePointer2], ['draw', PenLine], ['wand', Wand2], ['quad', Move], ['measure', Ruler]] as const).map(([m, I]) => (
                <button key={m} aria-label={m} onClick={() => setMode(m)} className={`rounded-full p-2 ${mode === m ? 'bg-amber-500 text-stone-950' : 'text-stone-300'}`}><I size={16} /></button>
              ))}
            </div>
          )}
        </main>

        {/* side panel */}
        <aside className="max-h-[44vh] w-full shrink-0 overflow-y-auto border-t border-stone-800 bg-stone-900 md:max-h-none md:w-[340px] md:border-l md:border-t-0">
          {!photo ? <Section title="Photo Studio"><Empty>Upload a room photo to start.</Empty></Section> : mode === 'measure' ? (
            <>
              <Section title="Photo → measured 3D room">
                <ol className="space-y-3 text-sm">
                  <li className={floorPts.length === 4 ? 'text-emerald-300' : ''}>
                    <b>1.</b> Click the <b>4 floor corners</b> of the room in order around the floor ({floorPts.length}/4). Hidden corners can be estimated — drag them later.
                    {floorPts.length > 0 && <button className="ml-2 text-[11px] text-amber-400 underline" onClick={() => setFloorPts([])}>reset</button>}
                  </li>
                  <li>
                    <b>2.</b> Type your tape measurements (inside wall to inside wall):
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Field label="Side A (1→2)"><LenField meters={sideA} units={project.units} min={0.5} max={40} onCommit={setSideA} /></Field>
                      <Field label="Side B (2→3)"><LenField meters={sideB} units={project.units} min={0.5} max={40} onCommit={setSideB} /></Field>
                      <Field label="Height"><LenField meters={height} units={project.units} min={2} max={8} onCommit={setHeight} /></Field>
                    </div>
                  </li>
                  <li>
                    <b>3.</b> Doors & windows you can see: choose one, then click the floor directly below its <b>left</b> and <b>right</b> edges.
                    <div className="mt-2 flex gap-2">
                      <Btn variant={placing === 'door' ? 'primary' : 'outline'} onClick={() => setPlacing('door')} disabled={floorPts.length < 4}>+ Door</Btn>
                      <Btn variant={placing === 'window' ? 'primary' : 'outline'} onClick={() => setPlacing('window')} disabled={floorPts.length < 4}>+ Window</Btn>
                    </div>
                    {placing && <p className="mt-1 text-[11px] text-amber-300">Click the two floor points under the {placing}.</p>}
                    <ul className="mt-2 space-y-1">
                      {mapped?.ops.map(({ o, at }) => (
                        <li key={o.id} className="flex items-center gap-2 rounded bg-stone-800/60 px-2 py-1 text-xs">
                          <span className="capitalize">{o.type}</span><span className="text-stone-400">side {['A', 'B', 'A′', 'B′'][at.side]} · {fmtLen(at.width, project.units)} wide</span>
                          {at.distanceFromWall > 0.6 && <span title="These points are far from any wall — check them"><AlertTriangle size={12} className="text-amber-400" /></span>}
                          <button className="ml-auto text-stone-500 hover:text-red-400" aria-label="Remove opening" onClick={() => setOpenings((os) => os.filter((x) => x.id !== o.id))}><Trash2 size={12} /></button>
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li>
                    <b>4.</b> Name the room:
                    <div className="mt-2 grid grid-cols-[1fr_110px] gap-2">
                      <TextInput value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Master Bedroom" aria-label="Room name" />
                      <select className={inputCls} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)} aria-label="Room type">{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                    </div>
                    <Field label="Wall thickness">
                      <select className={inputCls} value={thickness} onChange={(e) => setThickness(+e.target.value)}>
                        <option value={0.115}>4.5 inch (partition)</option><option value={0.15}>6 inch block</option><option value={0.23}>9 inch brick (outer wall)</option>
                      </select>
                    </Field>
                    <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-amber-500" checked={applyFinishes} onChange={(e) => setApplyFinishes(e.target.checked)} /> Use this photo's colours in 3D</label>
                  </li>
                </ol>
                <Btn variant="primary" className="mt-3 w-full" disabled={!mapped} onClick={create3D}><Box size={14} /> Create 3D room</Btn>
                <p className="mt-2 text-[11px] text-stone-500">Accuracy depends on how well the corners are marked; openings are flagged for review in the editor. The room is added to {project.scene.floors.find((f) => f.id === activeFloorId)?.name}, beside any existing plan.</p>
              </Section>
            </>
          ) : selSticker ? (
            <Section title="Product photo" right={<Badge tone="amber">picture only</Badge>}>
              <div className="space-y-2">
                <p className="text-sm text-stone-200">{selSticker.name}</p>
                <Field label={`Size ${Math.round((selSticker.w / photo.w) * 100)}% of photo width`}>
                  <input type="range" min={5} max={100} value={Math.round((selSticker.w / photo.w) * 100)} onChange={(e) => { const v = +e.target.value; setPhoto((p) => { const s = p.stickers.find((x) => x.id === selSticker.id)!; s.w = (photo.w * v) / 100; }); }} className="w-full accent-amber-500" />
                </Field>
                <Field label={`Tilt ${Math.round((selSticker.rotation * 180) / Math.PI)}°`}>
                  <input type="range" min={-30} max={30} value={Math.round((selSticker.rotation * 180) / Math.PI)} onChange={(e) => { const v = +e.target.value; setPhoto((p) => { const s = p.stickers.find((x) => x.id === selSticker.id)!; s.rotation = (v * Math.PI) / 180; }); }} className="w-full accent-amber-500" />
                </Field>
                <p className="text-[11px] text-stone-500">Drag it on the photo to position. This is a flat picture for a quick look — for a measured 3D item, add it from the catalog in the editor.</p>
                <Btn variant="danger" onClick={() => { setPhoto((p) => { p.stickers = p.stickers.filter((x) => x.id !== selSticker.id); }); setSelId(null); }}><Trash2 size={14} /> Remove</Btn>
              </div>
            </Section>
          ) : sel ? (
            <>
              <Section title="Area" right={<button className="text-xs text-stone-400 hover:text-white" onClick={() => setSelId(null)}>Done</button>}>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <TextInput key={sel.id} defaultValue={sel.name} aria-label="Area name" onBlur={(e) => setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.name = e.target.value || sel.name; })} />
                    <select className={inputCls} aria-label="Surface" value={sel.surface} onChange={(e) => setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.surface = e.target.value as PhotoRegion['surface']; })}>
                      <option value="wall">Wall</option><option value="ceiling">Ceiling</option><option value="floor">Floor</option><option value="other">Other</option>
                    </select>
                  </div>
                  {sel.wand && (
                    <>
                      <Field label={`Colour tolerance ${sel.wand.tolerance}`} hint="Higher grabs more of the similar colour; lower stops sooner at corners.">
                        <input type="range" min={5} max={90} value={sel.wand.tolerance} onChange={(e) => { const v = +e.target.value; setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.wand!.tolerance = v; }); }} className="w-full accent-amber-500" />
                      </Field>
                      <Btn variant="outline" className="w-full" onClick={() => { setFenceFor(sel.id); setDraft([]); setMode('draw'); }}><PenLine size={14} /> {sel.polygon.length >= 3 ? 'Redraw the limit outline' : 'Spilled onto the next wall? Limit with outline'}</Btn>
                      {sel.polygon.length >= 3 && <Btn variant="outline" className="w-full" onClick={() => setPhoto((p) => { delete p.regions.find((x) => x.id === sel.id)!.wand; })}>Fill the whole outline (ignore colour)</Btn>}
                    </>
                  )}
                  <Field label={`Hide raw plaster marks ${Math.round(sel.smooth * 100)}%`}>
                    <input type="range" min={0} max={1} step={0.05} value={sel.smooth} onChange={(e) => { const v = +e.target.value; setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.smooth = v; }); }} className="w-full accent-amber-500" />
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    <Btn variant="outline" onClick={() => setPhoto((p) => { const r = p.regions.find((x) => x.id === sel.id)!; r.visible = !r.visible; })}>{sel.visible ? <EyeOff size={14} /> : <Eye size={14} />} {sel.visible ? 'Hide' : 'Show'}</Btn>
                    <Btn variant="outline" onClick={() => { const c = { ...structuredClone(sel), id: uid(), name: sel.name + ' copy' }; setPhoto((p) => { p.regions = [...p.regions, c]; }); setSelId(c.id); }}><Copy size={14} /> Duplicate</Btn>
                    <Btn variant="danger" onClick={() => { setPhoto((p) => { p.regions = p.regions.filter((x) => x.id !== sel.id); }); setSelId(null); }}><Trash2 size={14} /></Btn>
                  </div>
                </div>
              </Section>
              <Section title="Paint colour">
                <div className="grid grid-cols-6 gap-1.5">
                  {PALETTE.map(([hex, name]) => (
                    <button key={hex} title={`${name} ${hex}`} onClick={() => setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.finish = { kind: 'paint', hex }; })}
                      className={`aspect-square rounded-md border ${sel.finish.kind === 'paint' && sel.finish.hex === hex ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-700'}`} style={{ background: hex }} />
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input type="color" aria-label="Pick colour" value={sel.finish.kind === 'paint' ? sel.finish.hex : '#f2ece1'} onChange={(e) => { const v = e.target.value; setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.finish = { kind: 'paint', hex: v }; }); }} className="h-8 w-10 rounded border border-stone-700 bg-transparent" />
                  <input key={sel.id + (sel.finish.kind === 'paint' ? sel.finish.hex : '')} defaultValue={sel.finish.kind === 'paint' ? sel.finish.hex.toUpperCase() : ''} placeholder="#C46A4A" className={inputCls} aria-label="HEX colour"
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    onBlur={(e) => { const h = parseColorInput(e.target.value); if (h) setPhoto((p) => { p.regions.find((x) => x.id === sel.id)!.finish = { kind: 'paint', hex: h }; }); }} />
                </div>
              </Section>
              <Section title={sel.surface === 'floor' ? 'Flooring' : sel.surface === 'ceiling' ? 'Ceiling finish' : 'Panelling, wallpaper & textures'}>
                <div className="grid grid-cols-4 gap-1.5">
                  {surfaceMaterials(sel.surface).map((m) => (
                    <button key={m.id} title={m.name} onClick={() => setPhoto((p) => { const r = p.regions.find((x) => x.id === sel.id)!; r.finish = { kind: 'material', materialId: m.id, tiles: r.finish.kind === 'material' ? r.finish.tiles : sel.surface === 'floor' ? 4 : 3 }; })}
                      className={`overflow-hidden rounded-md border text-left ${sel.finish.kind === 'material' && sel.finish.materialId === m.id ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-700'}`}>
                      <img src={materialSwatch(m, 64)} alt="" className="aspect-square w-full" />
                      <span className="block truncate px-1 text-[9px] text-stone-400">{m.name}</span>
                    </button>
                  ))}
                </div>
                {sel.finish.kind === 'material' && (
                  <>
                    <Field label={`Pattern repeats across ${(sel.finish as { tiles: number }).tiles}×`}>
                      <input type="range" min={0.5} max={16} step={0.5} value={(sel.finish as { tiles: number }).tiles} onChange={(e) => { const v = +e.target.value; setPhoto((p) => { const f = p.regions.find((x) => x.id === sel.id)!.finish; if (f.kind === 'material') f.tiles = v; }); }} className="w-full accent-amber-500" />
                    </Field>
                    <Btn variant="outline" className="mt-2" onClick={() => setMode('quad')}><Move size={14} /> Set perspective corners</Btn>
                  </>
                )}
              </Section>
            </>
          ) : (
            <>
              <Section title="This photo">
                <div className="space-y-2">
                  <TextInput key={photo.id} defaultValue={photo.name} aria-label="Photo name" onBlur={(e) => setPhoto((p) => { p.name = e.target.value || p.name; })} />
                  <Field label="Linked 3D room">
                    <select className={inputCls} value={photo.roomId ?? ''} onChange={(e) => setPhoto((p) => { p.roomId = e.target.value || undefined; })}>
                      <option value="">— not linked —</option>
                      {project.scene.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </Field>
                  {linkedRoom && <Btn variant="outline" className="w-full" onClick={() => applyToRoom(linkedRoom.id, photo)}><Paintbrush size={14} /> Use these colours in the 3D {linkedRoom.name}</Btn>}
                  <Btn variant="outline" className="w-full" onClick={() => setMode('measure')}><Ruler size={14} /> Measure → create 3D room</Btn>
                  <label className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800">
                    <Sticker size={14} /> Place a product photo
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addSticker(f); e.target.value = ''; }} />
                  </label>
                  <Btn variant="danger" className="w-full" onClick={() => { if (!confirm('Delete this photo and its edits?')) return; updateProject((pr) => { pr.photos = (pr.photos ?? []).filter((x) => x.id !== photo.id); const a = { ...pr.assets }; delete a[photo.assetId]; pr.assets = a; }); setActiveId(null); }}><Trash2 size={14} /> Delete photo</Btn>
                </div>
              </Section>
              <Section title={`Areas (${photo.regions.length})`}>
                {photo.regions.length === 0 ? (
                  <div className="space-y-2 text-sm text-stone-400">
                    <p><b className="text-stone-200">Quick start:</b> pick <Wand2 size={12} className="inline" /> Magic select and click a wall. Or pick <PenLine size={12} className="inline" /> Draw and click the corners of a wall, ceiling or floor.</p>
                    <Btn variant="primary" onClick={() => setMode('wand')}><Wand2 size={14} /> Magic select a wall</Btn>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {photo.regions.map((r) => (
                      <li key={r.id}><button onClick={() => { setSelId(r.id); setMode('select'); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-stone-300 hover:bg-stone-800">
                        <span className="h-4 w-4 rounded border border-stone-600" style={{ background: r.finish.kind === 'paint' ? r.finish.hex : project.scene.materials[r.finish.materialId]?.colorHex }} />
                        <span className="flex-1 truncate">{r.name}</span><span className="text-[10px] uppercase text-stone-500">{r.surface}</span>{!r.visible && <EyeOff size={12} />}
                      </button></li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Tips for raw-site photos">
                <ul className="list-disc space-y-1 pl-4 text-[11px] text-stone-400">
                  <li>Shoot in daylight from a corner at chest height, with the floor and ceiling edges visible.</li>
                  <li>Draw separate areas for each wall, so you can try an accent wall.</li>
                  <li>Raise “Hide raw plaster marks” on bare walls for a finished-paint look.</li>
                  <li>Colours on screen are a guide — check a physical shade card in daylight before ordering paint.</li>
                </ul>
              </Section>
            </>
          )}
          {photo && mode === 'select' && sel && <div className="px-4 pb-4"><Btn variant="outline" className="w-full" onClick={() => setSelId(null)}><Check size={14} /> Done editing area</Btn></div>}
        </aside>
      </div>
    </div>
  );
}

const stickerCache = new Map<string, HTMLImageElement>();
