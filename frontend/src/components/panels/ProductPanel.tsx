import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RotateCw, Wand2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Badge, Btn, Field, LenField, Section, TextInput, inputCls, NumField } from '../ui';
import { CATALOG, CATEGORIES, type AssetCategory } from '../../lib/catalog';
import { dominantColor, extractPalette, loadImage, MAX_UPLOAD_BYTES, readAsDataUrl, removeBackground, sniffType, toCanvas, trimTransparent } from '../../lib/image';
import { makeObject } from '../../lib/templates';
import { placementPoint } from './CatalogPanel';
import { applyMaterial } from './MaterialsPanel';
import type { Material } from '../../lib/types';

const DEFAULT_DIMS: Record<AssetCategory, { w: number; h: number; d: number }> = {
  seating: { w: 0.9, h: 0.85, d: 0.85 }, tables: { w: 1.2, h: 0.75, d: 0.7 }, beds: { w: 1.6, h: 1, d: 2.1 }, storage: { w: 1, h: 1.2, d: 0.45 },
  kitchen: { w: 0.6, h: 0.9, d: 0.6 }, bath: { w: 0.6, h: 0.85, d: 0.5 }, lighting: { w: 0.4, h: 0.6, d: 0.4 }, decor: { w: 0.6, h: 0.6, d: 0.1 }, office: { w: 1.2, h: 0.75, d: 0.6 },
};

/** Reference photo → catalog match or a clearly-labelled approximation; also palette sampling. */
export default function ProductPanel() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const { toast, mutate, select, activeFloorId } = useEditor.getState();
  const u = project.units;
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [rot, setRot] = useState(0);
  const [bg, setBg] = useState(true);
  const [tol, setTol] = useState(38);
  const [preview, setPreview] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [cat, setCat] = useState<AssetCategory>('seating');
  const [dims, setDims] = useState(DEFAULT_DIMS.seating);
  const [dimsGiven, setDimsGiven] = useState(false);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState(0);
  const processed = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!src) return;
    let c = toCanvas(src, 900, rot);
    if (bg) c = trimTransparent(removeBackground(c, tol));
    processed.current = c;
    setPreview(c.toDataURL('image/png'));
    setPalette(extractPalette(c, 6));
  }, [src, rot, bg, tol]);

  useEffect(() => { if (!dimsGiven) setDims(DEFAULT_DIMS[cat]); }, [cat, dimsGiven]);

  const onFile = async (f: File) => {
    const t = await sniffType(f);
    if (!t || t === 'pdf') { toast('Product references must be PNG, JPG or WebP images.', 'error'); return; }
    if (f.size > MAX_UPLOAD_BYTES) { toast('Image is larger than 25 MB.', 'error'); return; }
    try {
      const img = await loadImage(await readAsDataUrl(f));
      setSrc(toCanvas(img, 1400));
      setRot(0);
      setName(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40));
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const matches = CATALOG.filter((a) => a.category === cat)
    .map((a) => ({ a, score: Math.abs(a.dims.w - dims.w) + Math.abs(a.dims.h - dims.h) + Math.abs(a.dims.d - dims.d) }))
    .sort((x, y) => x.score - y.score).slice(0, 3);

  const placeCatalog = (id: string) => {
    const a = CATALOG.find((x) => x.id === id)!;
    const p = placementPoint(project.scene, activeFloorId, selection);
    const o = makeObject(id, activeFloorId, +p.x.toFixed(2), +p.y.toFixed(2));
    if (processed.current) o.colorHex = dominantColor(processed.current);
    if (brand) o.brand = brand;
    mutate((s) => { s.objects.push(o); });
    select({ kind: 'object', id: o.id });
    toast(`Placed verified catalog model “${a.name}” in your product's colour`, 'success');
  };
  const placeApprox = () => {
    if (!processed.current) return;
    const p = placementPoint(project.scene, activeFloorId, selection);
    const base = makeObject('box', activeFloorId, +p.x.toFixed(2), +p.y.toFixed(2));
    const c = toCanvas(processed.current, 512);
    const keep = document.createElement('canvas');
    keep.width = c.width; keep.height = c.height;
    keep.getContext('2d')!.drawImage(processed.current, 0, 0, c.width, c.height);
    const o = { ...base, name: name || 'Reference product', dims: { ...dims }, colorHex: dominantColor(processed.current), imageDataUrl: keep.toDataURL('image/png'), estimated: true, price, brand, assetId: 'box' };
    mutate((s) => { s.objects.push(o); });
    select({ kind: 'object', id: o.id });
    toast('Approximation placed — it is marked as estimated geometry', 'info');
  };
  const applySwatch = (hex: string) => {
    if (!selection || selection.kind === 'opening') { toast('Select a wall, room or item to receive this colour.', 'info'); return; }
    const m: Material = { id: `custom-${hex.slice(1)}-90-0`, name: `Sampled ${hex.toUpperCase()}`, kind: 'custom', colorHex: hex, roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 45 };
    mutate((s) => applyMaterial(s, selection, selection.kind === 'room' ? 'room-walls' : (selection.kind as 'wall' | 'object'), m));
    toast(`Applied ${hex} to the selected ${selection.kind === 'room' ? "room's walls" : selection.kind}`, 'success');
  };

  return (
    <>
      <Section title="Product reference image">
        {!src ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-600 py-8 text-center text-sm text-stone-300 hover:border-amber-500"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
            <ImagePlus size={24} className="text-stone-500" />
            Drop or choose a product photo
            <span className="text-[11px] text-stone-500">PNG · JPG · WebP, up to 25 MB. Plain backgrounds work best.</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex h-40 items-center justify-center rounded-md bg-[repeating-conic-gradient(#292524_0_25%,#1c1917_0_50%)] bg-[length:16px_16px]">
              {preview && <img src={preview} alt="Product preview" className="max-h-full max-w-full object-contain" />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Btn variant="outline" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw size={14} /> Rotate</Btn>
              <Btn variant={bg ? 'primary' : 'outline'} onClick={() => setBg(!bg)}><Wand2 size={14} /> Remove background</Btn>
              <Btn variant="ghost" onClick={() => { setSrc(null); setPreview(null); setPalette([]); }}>Clear</Btn>
            </div>
            {bg && <Field label={`Background tolerance ${tol}`}><input type="range" min={5} max={90} value={tol} onChange={(e) => setTol(+e.target.value)} className="w-full accent-amber-500" /></Field>}
          </div>
        )}
      </Section>
      {src && (
        <>
          <Section title="Colours sampled from image">
            <div className="flex flex-wrap gap-2">
              {palette.map((h) => (
                <button key={h} onClick={() => applySwatch(h)} title={`Apply ${h} to selection`} className="group flex flex-col items-center gap-1">
                  <span className="h-9 w-9 rounded-md border border-stone-700 group-hover:ring-2 group-hover:ring-amber-500" style={{ background: h }} />
                  <span className="font-mono text-[10px] text-stone-400">{h}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-stone-500">Select a target surface first (wall, room or item), then click a swatch.</p>
          </Section>
          <Section title="Product details">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select value={cat} onChange={(e) => setCat(e.target.value as AssetCategory)} className={inputCls}>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Brand / model"><TextInput value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="optional" /></Field>
                <Field label={`Price (${project.currency})`}><NumField value={price} min={0} step={500} onCommit={setPrice} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Width"><LenField meters={dims.w} units={u} min={0.05} onCommit={(v) => { setDims({ ...dims, w: v }); setDimsGiven(true); }} /></Field>
                <Field label="Depth"><LenField meters={dims.d} units={u} min={0.01} onCommit={(v) => { setDims({ ...dims, d: v }); setDimsGiven(true); }} /></Field>
                <Field label="Height"><LenField meters={dims.h} units={u} min={0.01} onCommit={(v) => { setDims({ ...dims, h: v }); setDimsGiven(true); }} /></Field>
              </div>
              {!dimsGiven && <p className="flex items-start gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Using typical {cat} dimensions. Enter the real width, depth and height from the product listing for an accurate fit.</p>}
            </div>
          </Section>
          <Section title="Place in scene">
            <p className="mb-2 text-[11px] text-stone-400">Closest verified catalog models (preferred):</p>
            <div className="space-y-1">
              {matches.map(({ a, score }) => (
                <button key={a.id} onClick={() => placeCatalog(a.id)} className="flex w-full items-center justify-between rounded-md border border-stone-800 px-2 py-1.5 text-left text-sm hover:border-stone-600">
                  <span className="text-stone-200">{a.name} <span className="text-[11px] text-stone-500">{a.dims.w}×{a.dims.d}×{a.dims.h} m</span></span>
                  {score < 0.25 ? <Badge tone="green"><CheckCircle2 size={10} className="mr-0.5" />good match</Badge> : <Badge>similar</Badge>}
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <p className="text-[11px] text-amber-200">No exact model? Create an approximation: a dimensioned block carrying your photo. It is always marked as <b>estimated</b> in the plan, 3D view and reports — a single photo cannot give exact 3D geometry.</p>
              <Btn variant="primary" className="mt-2 w-full" onClick={placeApprox}>Create approximation</Btn>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
