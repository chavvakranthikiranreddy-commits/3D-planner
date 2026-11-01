import { useMemo, useState } from 'react';
import { Download, Eye, EyeOff, FileImage, Sparkles, Trash2, Zap } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Empty, Field, LenField, Section, TextInput, inputCls } from '../ui';
import { ELEC, ELEC_KINDS, electricalPlanSvg, roomOf, schedule, scheduleCsv, suggestForRoom, svgToPng, symbolSvg, totals } from '../../lib/electrical';
import { downloadDataUrl } from '../../lib/capture';
import type { ElecKind, ElecPoint } from '../../lib/types';

const GROUPS = ['Switches & sockets', 'Lighting', 'Appliance points', 'Other'] as const;

function Sym({ kind, size = 22 }: { kind: ElecKind; size?: number }) {
  return <svg width={size} height={size} viewBox="-13 -13 26 26" aria-hidden dangerouslySetInnerHTML={{ __html: symbolSvg({ kind }, 0, 0, 11) }} />;
}

export function ElecPointEditor({ e }: { e: ElecPoint }) {
  const project = useEditor((s) => s.project)!;
  const { mutate, select } = useEditor.getState();
  const upd = (fn: (x: ElecPoint) => void, key?: string) => mutate((s) => { const x = s.electrical?.find((q) => q.id === e.id); if (x) fn(x); }, key);
  const meta = ELEC[e.kind];
  const room = roomOf(project.scene, e);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-stone-200"><Sym kind={e.kind} /> {meta.label}{room && <span className="text-xs text-stone-500">· {room.name}</span>}</div>
      <Field label="Type">
        <select className={inputCls} value={e.kind} onChange={(ev) => { const k = ev.target.value as ElecKind; upd((x) => { x.kind = k; x.height = ELEC[k].height; }); }}>
          {ELEC_KINDS.filter((k) => ELEC[k].mount === meta.mount).map((k) => <option key={k} value={k}>{ELEC[k].label}</option>)}
        </select>
      </Field>
      {meta.mount === 'wall' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Height from floor"><LenField meters={e.height} units={project.units} min={0.1} max={4} onCommit={(v) => upd((x) => { x.height = v; })} /></Field>
          {(e.kind === 'switchboard' || e.kind === 'socket' || e.kind === 'tv-point') && (
            <Field label="Modules"><select className={inputCls} value={e.gang ?? 0} onChange={(ev) => { const v = +ev.target.value; upd((x) => { x.gang = v || undefined; }); }}>
              <option value={0}>—</option>{[1, 2, 3, 4, 6, 8, 12, 16, 18].map((n) => <option key={n} value={n}>{n}-module</option>)}
            </select></Field>
          )}
        </div>
      )}
      <Field label="Note for the electrician"><TextInput key={e.id} defaultValue={e.note ?? ''} placeholder="e.g. 2-way switch with bedside" onBlur={(ev) => upd((x) => { x.note = ev.target.value.trim() || undefined; })} /></Field>
      <Btn variant="danger" onClick={() => { mutate((s) => { s.electrical = (s.electrical ?? []).filter((x) => x.id !== e.id); }); select(null); }}><Trash2 size={14} /> Delete point</Btn>
    </div>
  );
}

export default function ElectricalPanel() {
  const project = useEditor((s) => s.project)!;
  const scene = project.scene;
  const tool = useEditor((s) => s.tool), elecKind = useEditor((s) => s.elecKind), show = useEditor((s) => s.showElectrical);
  const selection = useEditor((s) => s.selection), activeFloorId = useEditor((s) => s.activeFloorId);
  const view = useEditor((s) => s.view);
  const { setElecKind, setTool, toggle, mutate, toast, setView } = useEditor.getState();
  const floor = scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0];
  const rooms = scene.rooms.filter((r) => r.floorId === floor.id);
  const selRoomId = selection?.kind === 'room' ? selection.id : '';
  const [target, setTarget] = useState<string>('all');
  const [replace, setReplace] = useState(true);
  const selPoint = selection?.kind === 'elec' ? scene.electrical?.find((e) => e.id === selection.id) : undefined;
  const rows = useMemo(() => schedule(scene, project.units, floor.id), [scene, project.units, floor.id]);
  const t = useMemo(() => totals(scene), [scene]);
  const roomTarget = target === 'sel' ? selRoomId : target;

  const suggest = () => {
    const list = roomTarget === 'all' ? rooms : rooms.filter((r) => r.id === roomTarget);
    if (!list.length) { toast('Select a room first, or choose “All rooms on this floor”.', 'info'); return; }
    const ids = new Set(list.map((r) => r.id));
    let added = 0;
    mutate((s) => {
      let pts = s.electrical ?? [];
      if (replace) pts = pts.filter((e) => !(e.source === 'ai' && e.floorId === floor.id && ids.has(roomOf(s, e)?.id ?? '')));
      for (const r of list) { const n = suggestForRoom(s, r); added += n.length; pts = [...pts, ...n]; }
      s.electrical = pts;
    });
    if (!show) toggle('showElectrical');
    if (view === '3d' || view === 'walk') setView('split');
    toast(`Added ${added} electrical points to ${list.length === 1 ? list[0].name : `${list.length} rooms`}. Drag any symbol to adjust; your own points are kept.`, 'success');
  };

  const planFile = async (fmt: 'png' | 'svg') => {
    const { svg, w, h } = electricalPlanSvg(scene, floor.id, `${project.name} — ${floor.name} — Electrical & lighting layout`, project.units);
    const name = `${project.name}-${floor.name}-electrical`.replace(/[^\w-]+/g, '_');
    if (fmt === 'svg') downloadDataUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name + '.svg');
    else downloadDataUrl(await svgToPng(svg, w, h, 2), name + '.png');
  };

  return (
    <>
      <Section title="Place points" right={<button className="flex items-center gap-1 text-xs text-stone-400 hover:text-white" onClick={() => toggle('showElectrical')}>{show ? <Eye size={13} /> : <EyeOff size={13} />} {show ? 'Shown' : 'Hidden'}</button>}>
        <p className="mb-2 text-[11px] text-stone-500">Pick a symbol, then click on the 2D plan. Wall points snap to the nearest wall; drag to move.</p>
        {GROUPS.map((g) => (
          <div key={g} className="mb-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-500">{g}</div>
            <div className="grid grid-cols-2 gap-1">
              {ELEC_KINDS.filter((k) => ELEC[k].group === g).map((k) => (
                <button key={k} onClick={() => { setElecKind(k); if (view === '3d' || view === 'walk') setView('split'); }} title={ELEC[k].label}
                  className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] ${tool === 'electric' && elecKind === k ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-stone-700 text-stone-300 hover:border-stone-500'}`}>
                  <Sym kind={k} size={18} /><span className="truncate">{ELEC[k].label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {tool === 'electric' && <Btn variant="outline" className="w-full" onClick={() => setTool('select')}>Done placing</Btn>}
      </Section>

      {selPoint && <Section title="Selected point"><ElecPointEditor e={selPoint} /></Section>}

      <Section title="Suggest a layout">
        <div className="space-y-2">
          <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Rooms">
            <option value="all">All rooms on {floor.name}</option>
            {selRoomId && <option value="sel">Selected room</option>}
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" className="accent-amber-500" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace earlier suggestions (your own points stay)</label>
          <Btn variant="primary" className="w-full" onClick={suggest} disabled={!rooms.length}><Sparkles size={14} /> Suggest points</Btn>
          <p className="text-[11px] text-stone-500">Uses each room's type, doors and walls: switchboard by the door, fan and lights on the ceiling, bedside and TV points, kitchen counter 16A sockets, geyser and exhaust in bathrooms, AC points.</p>
        </div>
      </Section>

      <Section title={`Schedule · ${floor.name}`}>
        {!rows.length ? <Empty>No points yet. Use “Suggest points” or place them by hand.</Empty> : (
          <>
            <div className="mb-2 flex flex-wrap gap-1">
              {ELEC_KINDS.filter((k) => t.counts[k]).map((k) => <span key={k} className="flex items-center gap-1 rounded bg-stone-800 px-1.5 py-0.5 text-[11px] text-stone-300"><Sym kind={k} size={14} />{t.counts[k]}</span>)}
            </div>
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-stone-500"><th className="py-1 font-normal">Room</th><th className="font-normal">Point</th><th className="text-right font-normal">Qty</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.room + r.kind} className="border-t border-stone-800 text-stone-300"><td className="py-1 pr-1">{r.room}</td><td>{r.label}<div className="text-stone-500">{r.heights}</div></td><td className="text-right">{r.qty}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-[11px] text-stone-400"><Zap size={11} className="inline" /> {t.points} points · indicative connected load ≈ {(t.watts / 1000).toFixed(1)} kW (all floors)</p>
          </>
        )}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Btn variant="outline" disabled={!rows.length} onClick={() => void planFile('png')}><FileImage size={14} /> Plan PNG</Btn>
          <Btn variant="outline" disabled={!rows.length} onClick={() => void planFile('svg')}><FileImage size={14} /> Plan SVG</Btn>
          <Btn variant="outline" className="col-span-2" disabled={!scene.electrical?.length} onClick={() => downloadDataUrl('data:text/csv;charset=utf-8,' + encodeURIComponent(scheduleCsv(scene, project.units)), `${project.name}-electrical-schedule.csv`.replace(/[^\w.-]+/g, '_'))}><Download size={14} /> Schedule (Excel CSV)</Btn>
        </div>
        <p className="mt-2 text-[11px] text-stone-500">A planning aid for discussing points with your electrician. Circuits, wire sizes, earthing and MCB/RCCB ratings must be designed by a licensed electrician to local code.</p>
      </Section>
    </>
  );
}
