import { useMemo, useState } from 'react';
import { Check, Sparkles, Wand2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Empty, Section, inputCls } from '../ui';
import { ROOM_STYLES, applyPalette, applyRoomStyle, lrv, palettesFrom, type Palette } from '../../lib/roomStyle';
import { materialSwatch } from '../../three/textures';
import { parseColorInput } from '../../lib/materials';
import { applyChanges, localProvider } from '../../lib/ai';
import { CEILING_TYPES } from '../../lib/interiors';
import { polygonArea } from '../../lib/geometry';

const QUICK = ['#a8b5a0', '#c46a4a', '#3d4b63', '#e3b9a8', '#8a8a5c', '#d8cfc2', '#2c3a52', '#b38b4d'];
const ROLES: [keyof Palette, string][] = [['walls', 'Walls'], ['feature', 'Feature wall'], ['ceiling', 'Ceiling'], ['upholstery', 'Sofa / bed'], ['soft', 'Cushions, curtains'], ['wood', 'Wood']];

export default function StylePanel() {
  const project = useEditor((s) => s.project)!;
  const scene = project.scene;
  const selection = useEditor((s) => s.selection), activeFloorId = useEditor((s) => s.activeFloorId);
  const { mutate, toast } = useEditor.getState();
  const rooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
  const [roomId, setRoomId] = useState<string>(selection?.kind === 'room' ? selection.id : rooms[0]?.id ?? '');
  const room = scene.rooms.find((r) => r.id === (selection?.kind === 'room' ? selection.id : roomId)) ?? scene.rooms.find((r) => r.id === roomId);
  const [base, setBase] = useState('#a8b5a0');
  const [hexTxt, setHexTxt] = useState('#A8B5A0');
  const pals = useMemo(() => palettesFrom(base), [base]);
  const [opt, setOpt] = useState({ floor: true, ceiling: true, furniture: true, addFurniture: false, feature: true });
  const [busy, setBusy] = useState<string | null>(null);

  if (!scene.rooms.length) return <Section title="Room style & palettes"><Empty>Add or detect rooms first — styles are applied room by room.</Empty></Section>;

  const applyStyle = async (id: string) => {
    if (!room) return;
    const st = ROOM_STYLES.find((x) => x.id === id)!;
    setBusy(id);
    try {
      const adds = opt.addFurniture ? (await localProvider.propose(scene, { roomId: room.id, style: st.assetStyle, prompt: '', replaceFurniture: false })).changes.filter((c) => c.kind === 'add') : [];
      mutate((s) => {
        applyChanges(s, adds);
        applyRoomStyle(s, room.id, st, { floor: opt.floor, ceiling: opt.ceiling, furniture: opt.furniture });
      });
      toast(`${st.name} applied to ${room.name}${adds.length ? ` with ${adds.length} new item(s)` : ''}. One undo reverts it.`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const applyPal = (p: Palette) => {
    if (!room) return;
    mutate((s) => applyPalette(s, room.id, p, { walls: true, feature: opt.feature, ceilingColour: true, furniture: opt.furniture }));
    toast(`“${p.name}” palette applied to ${room.name}.`, 'success');
  };
  const small = room ? Math.abs(polygonArea(room.polygon)) < 10 : false;

  return (
    <>
      <Section title="Room">
        <select className={inputCls} value={room?.id ?? ''} onChange={(e) => setRoomId(e.target.value)} aria-label="Room to style">
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-stone-300">
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={opt.feature} onChange={(e) => setOpt({ ...opt, feature: e.target.checked })} /> Feature wall</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={opt.furniture} onChange={(e) => setOpt({ ...opt, furniture: e.target.checked })} /> Recolour furniture</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={opt.floor} onChange={(e) => setOpt({ ...opt, floor: e.target.checked })} /> Change floor</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={opt.ceiling} onChange={(e) => setOpt({ ...opt, ceiling: e.target.checked })} /> False ceiling</label>
          <label className="col-span-2 flex items-center gap-1.5"><input type="checkbox" className="accent-amber-500" checked={opt.addFurniture} onChange={(e) => setOpt({ ...opt, addFurniture: e.target.checked })} /> Also add missing furniture in that style</label>
        </div>
      </Section>

      <Section title="Style presets">
        <div className="space-y-2">
          {ROOM_STYLES.map((st) => {
            const feat = st.featureMaterial ? scene.materials[st.featureMaterial] : null;
            const floor = scene.materials[st.floor];
            return (
              <div key={st.id} className="rounded-lg border border-stone-700 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 shrink-0 overflow-hidden rounded">
                    <span className="w-5" style={{ background: st.walls }} />
                    {feat ? <img src={materialSwatch(feat, 40)} alt="" className="h-9 w-5 object-cover" /> : <span className="w-5" style={{ background: st.featureHex }} />}
                    {floor && <img src={materialSwatch(floor, 40)} alt="" className="h-9 w-5 object-cover" />}
                    <span className="w-3" style={{ background: st.upholstery }} /><span className="w-3" style={{ background: st.wood }} /><span className="w-3" style={{ background: st.soft }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-stone-100">{st.name}</div>
                    <div className="truncate text-[10px] text-stone-500">{CEILING_TYPES.find((c) => c.type === st.ceiling)?.label}</div>
                  </div>
                  <Btn variant="outline" disabled={!room || !!busy} onClick={() => void applyStyle(st.id)}>{busy === st.id ? '…' : <><Wand2 size={13} /> Apply</>}</Btn>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-stone-400">{st.blurb}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Matching palette from one colour">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((h) => <button key={h} title={h} onClick={() => { setBase(h); setHexTxt(h.toUpperCase()); }} className={`h-6 w-6 rounded border ${base === h ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-700'}`} style={{ background: h }} />)}
        </div>
        <div className="mt-2 flex gap-2">
          <input type="color" value={base} aria-label="Base colour" onChange={(e) => { setBase(e.target.value); setHexTxt(e.target.value.toUpperCase()); }} className="h-8 w-10 rounded border border-stone-700 bg-transparent" />
          <input value={hexTxt} onChange={(e) => { setHexTxt(e.target.value); const h = parseColorInput(e.target.value); if (h) setBase(h); }} placeholder="#C46A4A or a shade code's HEX" className={inputCls} aria-label="Base colour HEX" />
        </div>
        <div className="mt-3 space-y-3">
          {pals.map((p) => {
            const L = lrv(p.walls);
            return (
              <div key={p.id} className="rounded-lg border border-stone-700 p-2">
                <div className="flex items-center justify-between"><span className="text-sm font-medium text-stone-100">{p.name}</span>
                  <Btn variant="outline" disabled={!room} onClick={() => applyPal(p)}><Check size={13} /> Apply</Btn></div>
                <div className="mt-1.5 grid grid-cols-6 gap-1">
                  {ROLES.map(([k, label]) => (
                    <div key={k} title={`${label} ${String(p[k]).toUpperCase()}`}>
                      <div className="h-8 rounded border border-stone-700" style={{ background: p[k] as string }} />
                      <div className="mt-0.5 truncate text-[9px] text-stone-500">{label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-stone-400">{p.note}</p>
                <p className="mt-0.5 text-[10px] text-stone-500">Wall LRV ≈ {L} {L < 25 ? (small ? '· dark for a small room — it will feel smaller' : '· dark, cosy') : L > 70 ? '· bright, bounces daylight' : ''}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-stone-500"><Sparkles size={11} className="inline" /> Have a shade from a paint brand's fan deck? Enter its HEX here, then match the final pick against the physical shade card in daylight.</p>
      </Section>
    </>
  );
}
