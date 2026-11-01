import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Field, LenField, Section, inputCls } from '../ui';
import { CARCASS, COUNTERS, HANDLES, MODULAR_ASSETS, SHUTTERS, UNIT_TYPES, cutList, cutListCsv, defaultConfig, defaultUnits, modularCost, unitsTotal } from '../../lib/modular';
import { downloadDataUrl } from '../../lib/capture';
import { fmtLen } from '../../lib/geometry';
import { parseColorInput } from '../../lib/materials';
import { uid } from '../../lib/templates';
import type { ModUnit, ModularConfig, SceneObject } from '../../lib/types';

const UNIT_COLORS: Record<string, string> = { drawers: '#60a5fa', shutter: '#a8a29e', sink: '#22d3ee', hob: '#f97316', tall: '#a78bfa', appliance: '#525252', corner: '#facc15', open: '#4ade80', hanging: '#f472b6', shelves: '#a8a29e', mirror: '#bae6fd' };
const SHUTTER_SWATCHES = ['#f4f1ea', '#e8e4dc', '#d8cfc2', '#a8b5a0', '#3d4b63', '#2f3a3a', '#7b4f33', '#c9a27a', '#1f1f1f', '#8c2f39'];
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function UnitStrip({ units, L, sel, onSel }: { units: ModUnit[]; L: number; sel: string | null; onSel: (id: string) => void }) {
  const total = unitsTotal(units) || 1;
  return (
    <div className="flex h-12 w-full overflow-hidden rounded border border-stone-700">
      {units.map((u) => (
        <button key={u.id} onClick={() => onSel(u.id)} title={`${u.type} ${u.width.toFixed(2)} m`}
          className={`relative flex min-w-0 flex-col items-center justify-center border-r border-stone-900 text-[9px] leading-tight text-stone-950 ${sel === u.id ? 'ring-2 ring-inset ring-amber-400' : ''}`}
          style={{ width: `${(u.width / total) * 100}%`, background: UNIT_COLORS[u.type] ?? '#a8a29e' }}>
          <span className="truncate px-0.5 font-semibold">{u.type}</span><span>{Math.round(u.width * 100)}</span>
        </button>
      ))}
      {Math.abs(total - L) > 0.02 && <span className="sr-only">units do not fill the width</span>}
    </div>
  );
}

export default function ModularSection({ o }: { o: SceneObject }) {
  const project = useEditor((s) => s.project)!;
  const { mutate } = useEditor.getState();
  const meta = MODULAR_ASSETS[o.assetId];
  const [leg, setLeg] = useState<1 | 2>(1);
  const [sel, setSel] = useState<string | null>(null);
  if (!meta) return null;
  const cfg = o.modular;
  const u = project.units;
  const upd = (fn: (c: ModularConfig, x: SceneObject) => void) => mutate((sc) => {
    const x = sc.objects.find((q) => q.id === o.id); if (!x?.modular) return;
    fn(x.modular, x);
    x.price = modularCost(x, x.modular).total;
    x.colorHex = x.modular.shutterHex;
  });

  if (!cfg) {
    return (
      <Section title={meta.kind === 'kitchen' ? 'Modular kitchen planner' : 'Wardrobe planner'}>
        <p className="mb-2 text-[11px] text-stone-400">Split this {meta.kind} into drawers, shutters, {meta.kind === 'kitchen' ? 'sink, hob, tall pantry' : 'hanging, shelves, mirror'} units; choose finishes and handles; get an indicative cost and a cut list for the carpenter.</p>
        <Btn variant="primary" className="w-full" onClick={() => mutate((sc) => { const x = sc.objects.find((q) => q.id === o.id); if (!x) return; x.modular = defaultConfig(x)!; x.price = modularCost(x, x.modular).total; if (x.modular.loft && meta.kind === 'kitchen' && x.dims.h < 2.6) x.dims.h = 2.7; })}><LayoutGrid size={14} /> Plan modules</Btn>
      </Section>
    );
  }
  const L = leg === 2 ? Math.max(0.3, o.dims.d - 0.62) : o.dims.w;
  const units = (leg === 2 ? cfg.units2 : cfg.units) ?? [];
  const setUnits = (fn: (us: ModUnit[]) => ModUnit[]) => upd((c) => { if (leg === 2) c.units2 = fn(c.units2 ?? []); else c.units = fn(c.units); });
  const selU = units.find((x) => x.id === sel);
  const diff = L - unitsTotal(units);
  const cost = modularCost(o, cfg);
  const cl = cutList(o, cfg);

  return (
    <>
      <Section title={meta.kind === 'kitchen' ? 'Modular kitchen planner' : 'Wardrobe planner'} right={<label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" className="accent-amber-500" checked={!!cfg.open} onChange={(e) => upd((c) => { c.open = e.target.checked; })} /> Show inside</label>}>
        {meta.layout === 'l' && (
          <div className="mb-2 flex overflow-hidden rounded-md border border-stone-700 text-xs">
            {([1, 2] as const).map((n) => <button key={n} onClick={() => { setLeg(n); setSel(null); }} className={`flex-1 py-1 ${leg === n ? 'bg-amber-500 text-stone-950' : 'text-stone-300'}`}>{n === 1 ? `Main run (${fmtLen(o.dims.w, u)})` : `Side run (${fmtLen(L, u)})`}</button>)}
          </div>
        )}
        <UnitStrip units={units} L={L} sel={sel} onSel={setSel} />
        <p className={`mt-1 text-[11px] ${Math.abs(diff) > 0.02 ? 'text-amber-300' : 'text-stone-500'}`}>
          {Math.abs(diff) > 0.02 ? <>Units add up to {fmtLen(unitsTotal(units), u)} of {fmtLen(L, u)} — {diff > 0 ? 'add a unit or widen one' : 'narrow a unit'}; the 3D view stretches them to fit. <button className="underline" onClick={() => setUnits((us) => { const k = L / (unitsTotal(us) || 1); return us.map((x) => ({ ...x, width: +(x.width * k).toFixed(3) })); })}>Fit exactly</button></> : 'Click a unit to edit it.'}
        </p>
        {selU && (
          <div className="mt-2 space-y-2 rounded-md border border-amber-500/40 p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Unit type"><select className={inputCls} value={selU.type} onChange={(e) => { const t = e.target.value as ModUnit['type']; setUnits((us) => us.map((x) => x.id === selU.id ? { ...x, type: t, drawers: t === 'drawers' ? 3 : t === 'hob' ? 2 : undefined } : x)); }}>
                {UNIT_TYPES[cfg.kind].map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select></Field>
              <Field label="Width"><LenField meters={selU.width} units={u} min={0.15} max={1.5} onCommit={(v) => setUnits((us) => us.map((x) => x.id === selU.id ? { ...x, width: v } : x))} /></Field>
            </div>
            {(selU.type === 'drawers' || selU.type === 'hob') && (
              <Field label="Drawers"><select className={inputCls} value={selU.drawers ?? 3} onChange={(e) => { const n = +e.target.value; setUnits((us) => us.map((x) => x.id === selU.id ? { ...x, drawers: n } : x)); }}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field>
            )}
            <div className="flex gap-1.5">
              <Btn variant="outline" title="Move left" onClick={() => setUnits((us) => { const i = us.findIndex((x) => x.id === selU.id); if (i <= 0) return us; const n = [...us]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><ChevronLeft size={14} /></Btn>
              <Btn variant="outline" title="Move right" onClick={() => setUnits((us) => { const i = us.findIndex((x) => x.id === selU.id); if (i < 0 || i >= us.length - 1) return us; const n = [...us]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}><ChevronRight size={14} /></Btn>
              <Btn variant="danger" onClick={() => { setUnits((us) => us.filter((x) => x.id !== selU.id)); setSel(null); }}><Trash2 size={14} /> Remove</Btn>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {UNIT_TYPES[cfg.kind].map((t) => <button key={t.type} onClick={() => { const nu = { id: uid(), type: t.type, width: t.w, drawers: t.type === 'drawers' ? 3 : t.type === 'hob' ? 2 : undefined }; setUnits((us) => [...us, nu]); setSel(nu.id); }} className="flex items-center gap-0.5 rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-300 hover:border-amber-500"><Plus size={10} />{t.label}</button>)}
          <button onClick={() => { setUnits(() => defaultUnits(cfg.kind, L, leg === 2)); setSel(null); }} className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:border-amber-500">Reset layout</button>
        </div>
      </Section>

      <Section title="Finishes & hardware">
        <div className="space-y-2">
          <Field label="Shutter finish"><select className={inputCls} value={cfg.shutter} onChange={(e) => upd((c) => { c.shutter = e.target.value as ModularConfig['shutter']; })}>{Object.entries(SHUTTERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <p className="-mt-1 text-[10px] text-stone-500">{SHUTTERS[cfg.shutter].note}</p>
          <Field label={cfg.kind === 'kitchen' ? 'Base shutter colour' : 'Shutter colour'}>
            <div className="flex flex-wrap gap-1">{SHUTTER_SWATCHES.map((h) => <button key={h} title={h} onClick={() => upd((c) => { c.shutterHex = h; })} className={`h-6 w-6 rounded border ${cfg.shutterHex === h ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-700'}`} style={{ background: h }} />)}
              <input type="color" aria-label="Custom shutter colour" value={cfg.shutterHex} onChange={(e) => { const v = e.target.value; upd((c) => { c.shutterHex = v; }); }} className="h-6 w-8 rounded border border-stone-700 bg-transparent" /></div>
          </Field>
          {cfg.kind === 'kitchen' && meta.layout !== 'base' && (
            <Field label="Wall-unit colour (two-tone)">
              <div className="flex flex-wrap gap-1">{SHUTTER_SWATCHES.map((h) => <button key={h} title={h} onClick={() => upd((c) => { c.upperHex = h; })} className={`h-6 w-6 rounded border ${(cfg.upperHex ?? cfg.shutterHex) === h ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-700'}`} style={{ background: h }} />)}
                <input key={cfg.upperHex} defaultValue={(cfg.upperHex ?? '').toUpperCase()} placeholder="#HEX" aria-label="Wall-unit HEX" className={`${inputCls} h-6 w-20 py-0 text-xs`} onBlur={(e) => { const h = parseColorInput(e.target.value); if (h) upd((c) => { c.upperHex = h; }); }} /></div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Carcass board"><select className={inputCls} value={cfg.carcass} onChange={(e) => upd((c) => { c.carcass = e.target.value as ModularConfig['carcass']; })}>{Object.entries(CARCASS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Handles"><select className={inputCls} value={cfg.handle} onChange={(e) => upd((c) => { c.handle = e.target.value as ModularConfig['handle']; })}>{Object.entries(HANDLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
          <p className="-mt-1 text-[10px] text-stone-500">{CARCASS[cfg.carcass].note}{cfg.kind === 'kitchen' && cfg.carcass !== 'bwp-ply' && ' · BWP ply is recommended under the sink.'}</p>
          {cfg.kind === 'kitchen' && (
            <Field label="Countertop"><select className={inputCls} value={cfg.counter ?? 'quartz'} onChange={(e) => upd((c) => { c.counter = e.target.value as ModularConfig['counter']; c.counterHex = undefined; })}>{Object.entries(COUNTERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-300">
            {meta.layout !== 'base' && <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={cfg.loft} onChange={(e) => upd((c, x) => { c.loft = e.target.checked; if (c.kind === 'kitchen') x.dims.h = c.loft ? Math.max(x.dims.h, 2.7) : Math.min(x.dims.h, 2.3); })} /> Loft above</label>}
            {cfg.kind === 'kitchen' && meta.layout !== 'base' && <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={cfg.wallUnits} onChange={(e) => upd((c) => { c.wallUnits = e.target.checked; })} /> Wall cabinets</label>}
          </div>
        </div>
      </Section>

      <Section title="Indicative cost" right={<span className="text-sm font-semibold text-amber-300">{inr(cost.total)}</span>}>
        <table className="w-full text-[11px]">
          <tbody>{cost.lines.map((l) => <tr key={l.label} className="border-t border-stone-800 text-stone-300"><td className="py-1 pr-2">{l.label}<div className="text-stone-500">{l.qty} {l.unit} × {inr(l.rate)}</div></td><td className="text-right">{inr(l.total)}</td></tr>)}</tbody>
        </table>
        <p className="mt-1 text-[10px] text-stone-500">{cost.frontSqft} sq ft of front area. Rates are 2026 placeholders for comparing options — take written quotes. Appliances, sink, chimney and hob are not included.</p>
      </Section>

      <Section title="Cut list for the carpenter">
        <div className="grid grid-cols-2 gap-1 text-[11px] text-stone-300">
          <span>18 mm boards (8×4 ft)</span><b className="text-right">{cl.sheets18}</b>
          <span>8 mm back panels</span><b className="text-right">{cl.sheets8}</b>
          <span>Shutter boards</span><b className="text-right">{cl.shutterSheets}</b>
          <span>Edge banding</span><b className="text-right">{cl.edgeM} m</b>
          <span>Parts</span><b className="text-right">{cl.parts.reduce((a, p) => a + p.qty, 0)}</b>
        </div>
        <Btn variant="outline" className="mt-2 w-full" onClick={() => downloadDataUrl('data:text/csv;charset=utf-8,' + encodeURIComponent(cutListCsv(o, cfg)), `${o.name}-cut-list.csv`.replace(/[^\w.-]+/g, '_'))}><Download size={14} /> Download cut list (Excel CSV)</Btn>
        <p className="mt-1 text-[10px] text-stone-500">Sizes in mm with 18 mm carcass and 8 mm backs, +15% wastage in sheet counts. Check site measurements before cutting.</p>
        <Btn variant="outline" className="mt-2 w-full" onClick={() => mutate((sc) => { const x = sc.objects.find((q) => q.id === o.id); if (x) { delete x.modular; } })}>Stop using the planner for this item</Btn>
      </Section>
    </>
  );
}
