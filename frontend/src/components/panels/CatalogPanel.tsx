import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Section, inputCls, Empty } from '../ui';
import { CATALOG, CATEGORIES, STYLES, type Asset, type AssetCategory, type AssetStyle } from '../../lib/catalog';
import { bbox, centroid, fmtLen } from '../../lib/geometry';
import { makeObject } from '../../lib/templates';
import type { Scene } from '../../lib/types';

export function placementPoint(scene: Scene, floorId: string, selection: ReturnType<typeof useEditor.getState>['selection']) {
  if (selection?.kind === 'room') {
    const r = scene.rooms.find((x) => x.id === selection.id);
    if (r) return centroid(r.polygon);
  }
  const pts = scene.walls.filter((w) => w.floorId === floorId).flatMap((w) => [w.a, w.b]);
  const b = bbox(pts.length ? pts : [{ x: 0, y: 0 }, { x: 4, y: 4 }]);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function addAsset(a: Asset) {
  const { project, activeFloorId, selection, mutate, select, toast } = useEditor.getState();
  if (!project) return;
  const p = placementPoint(project.scene, activeFloorId, selection);
  const o = makeObject(a.id, activeFloorId, +p.x.toFixed(2), +p.y.toFixed(2));
  mutate((s) => { s.objects.push(o); });
  select({ kind: 'object', id: o.id });
  toast(`${a.name} added — drag it in the plan or use the 3D gizmo`, 'success');
}

function AssetIcon({ a }: { a: Asset }) {
  // top-view footprint, to scale within the tile
  const k = 34 / Math.max(a.dims.w, a.dims.d, 0.5);
  return (
    <svg width="44" height="44" viewBox="-22 -22 44 44" className="shrink-0 rounded bg-stone-800">
      <rect x={(-a.dims.w * k) / 2} y={(-a.dims.d * k) / 2} width={a.dims.w * k} height={a.dims.d * k} rx={2} fill={a.colorHex} stroke="#0c0a09" strokeWidth={1} />
      {a.accentHex && <rect x={(-a.dims.w * k) / 4} y={(-a.dims.d * k) / 4} width={(a.dims.w * k) / 2} height={(a.dims.d * k) / 2} rx={1} fill={a.accentHex} opacity={0.8} />}
    </svg>
  );
}

export default function CatalogPanel() {
  const currency = useEditor((s) => s.project?.currency ?? '₹');
  const units = useEditor((s) => s.project?.units ?? 'm');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AssetCategory | 'all'>('all');
  const [style, setStyle] = useState<AssetStyle | 'all'>('all');
  const [maxW, setMaxW] = useState(4);
  const [maxPrice, setMaxPrice] = useState(0);
  const list = CATALOG.filter((a) =>
    (cat === 'all' || a.category === cat) && (style === 'all' || a.styles.includes(style)) && a.dims.w <= maxW &&
    (!maxPrice || a.price <= maxPrice) && (!q || a.name.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <>
      <Section title="Furniture & fixtures">
        <div className="space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search catalog…" className={`${inputCls} pl-7`} />
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setCat('all')} className={`rounded-full px-2 py-0.5 text-[11px] ${cat === 'all' ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300'}`}>All</button>
            {CATEGORIES.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={`rounded-full px-2 py-0.5 text-[11px] ${cat === c.id ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}>{c.label}</button>)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={style} onChange={(e) => setStyle(e.target.value as AssetStyle | 'all')} className={inputCls} aria-label="Style">
              <option value="all">Any style</option>
              {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={maxW} onChange={(e) => setMaxW(+e.target.value)} className={inputCls} aria-label="Max width">
              <option value={4}>Any width</option><option value={2}>≤ 2 m</option><option value={1.2}>≤ 1.2 m</option><option value={0.6}>≤ 0.6 m</option>
            </select>
            <select value={maxPrice} onChange={(e) => setMaxPrice(+e.target.value)} className={inputCls} aria-label="Max price">
              <option value={0}>Any price</option><option value={10000}>≤ {currency}10k</option><option value={30000}>≤ {currency}30k</option><option value={60000}>≤ {currency}60k</option>
            </select>
          </div>
        </div>
      </Section>
      <div className="space-y-1 p-2">
        {list.length === 0 && <Empty>No items match these filters.</Empty>}
        {list.map((a) => (
          <button key={a.id} onClick={() => addAsset(a)} className="group flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-stone-800" title={`Licence: ${a.licence}`}>
            <AssetIcon a={a} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-stone-100">{a.name}</div>
              <div className="text-[11px] text-stone-500">{fmtLen(a.dims.w, units)} × {fmtLen(a.dims.d, units)} × {fmtLen(a.dims.h, units)}</div>
              <div className="text-[11px] text-stone-400">{currency}{a.price.toLocaleString('en-IN')} · {a.styles.slice(0, 2).join(', ')}</div>
            </div>
            <Plus size={16} className="text-stone-500 group-hover:text-amber-400" />
          </button>
        ))}
        <p className="px-2 pt-2 text-[10px] leading-snug text-stone-600">All built-in models are original procedural geometry released with this project (MIT). Prices are indicative placeholders — connect a supplier catalog for real pricing.</p>
      </div>
    </>
  );
}
