import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Empty, Field, Section, inputCls } from '../ui';
import type { Material, Scene, Selection } from '../../lib/types';
import { materialSwatch } from '../../three/textures';
import { parseColorInput } from '../../lib/materials';
import { readAsDataUrl, sniffType } from '../../lib/image';
import { roomWallSides } from '../../lib/ai';
import { setWallMaterial, wallMaterialFor } from '../../lib/geometry';
import { uid } from '../../lib/templates';

type Target = 'wall' | 'room-walls' | 'floor' | 'ceiling' | 'object';
export type WallSide = 'A' | 'B' | 'both';

function currentMaterialId(s: Scene, sel: Selection, target: Target, side: WallSide = 'A'): string | undefined {
  if (!sel) return;
  if (sel.kind === 'wall') { const w = s.walls.find((x) => x.id === sel.id); return w && wallMaterialFor(w, side === 'B' ? 'B' : 'A'); }
  if (sel.kind === 'room') {
    const r = s.rooms.find((x) => x.id === sel.id);
    if (target === 'floor') return r?.floorMaterialId;
    if (target === 'ceiling') return r?.ceilingMaterialId;
    const ws = r && roomWallSides(s, r)[0];
    if (ws) return wallMaterialFor(ws.wall, ws.side);
  }
  if (sel.kind === 'object') return s.objects.find((o) => o.id === sel.id)?.materialId;
}

/** Apply a material to the chosen surface. Geometry is never touched. */
export function applyMaterial(s: Scene, sel: Selection, target: Target, m: Material, side: WallSide = 'both') {
  if (!s.materials[m.id]) s.materials[m.id] = m;
  if (!sel) return;
  if (sel.kind === 'wall') { const w = s.walls.find((x) => x.id === sel.id); if (w) setWallMaterial(w, side, m.id); }
  if (sel.kind === 'room') {
    const r = s.rooms.find((x) => x.id === sel.id);
    if (!r) return;
    if (target === 'floor') r.floorMaterialId = m.id;
    else if (target === 'ceiling') r.ceilingMaterialId = m.id;
    else roomWallSides(s, r).forEach(({ wall, side: sd }) => setWallMaterial(wall, sd, m.id));
  }
  if (sel.kind === 'object') { const o = s.objects.find((x) => x.id === sel.id); if (o) { o.materialId = m.id; o.colorHex = m.colorHex; } }
}

export default function MaterialsPanel() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const { mutate, toast } = useEditor.getState();
  const s = project.scene;
  const [roomTarget, setRoomTarget] = useState<'floor' | 'room-walls' | 'ceiling'>('floor');
  const [hex, setHex] = useState('#d8cfc2');
  const [rough, setRough] = useState(0.85);
  const [metal, setMetal] = useState(0);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [side, setSide] = useState<WallSide>('both');

  const target: Target | null = !selection ? null : selection.kind === 'wall' ? 'wall' : selection.kind === 'room' ? roomTarget : selection.kind === 'object' ? 'object' : null;
  const mats = Object.values(s.materials);
  const swatches = useMemo(() => Object.fromEntries(mats.map((m) => [m.id, materialSwatch(m)])), [mats.length, mats.map((m) => m.colorHex + m.pattern).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = target ? currentMaterialId(s, selection, target, side) : undefined;
  const apply = (m: Material) => {
    if (!target) return;
    mutate((sc) => applyMaterial(sc, selection, target, m, side));
  };
  const applyHex = () => {
    const h = parseColorInput(hex);
    if (!h) { toast('Enter a colour as #RRGGBB or rgb(r, g, b)', 'error'); return; }
    const id = `custom-${h.slice(1)}-${Math.round(rough * 100)}-${Math.round(metal * 100)}`;
    apply(s.materials[id] ?? { id, name: `Custom ${h.toUpperCase()}`, kind: 'custom', colorHex: h, roughness: rough, metalness: metal, pattern: 'none', pricePerM2: 45 });
  };
  const uploadTexture = async (f: File) => {
    const t = await sniffType(f);
    if (!t || t === 'pdf') { toast('Textures must be PNG, JPG or WebP images.', 'error'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('Texture images must be under 8 MB.', 'error'); return; }
    const url = await readAsDataUrl(f);
    const id = 'tex-' + uid();
    apply({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'custom', colorHex: '#ffffff', roughness: rough, metalness: metal, textureDataUrl: url, textureScale: 1, pricePerM2: 0 });
    toast('Texture applied — adjust its scale below if needed', 'success');
  };
  const cur = current ? s.materials[current] : undefined;

  if (!target) {
    return <Section title="Materials & colour"><Empty>Select a wall, room or item first. For a room you can paint its walls, floor or ceiling.</Empty></Section>;
  }
  const kinds = ['all', 'paint', 'wood', 'stone', 'tile', 'concrete', 'fabric', 'metal', 'custom'];
  return (
    <>
      <Section title="Apply to">
        {selection?.kind === 'room' ? (
          <div className="flex overflow-hidden rounded-md border border-stone-700 text-sm">
            {([['floor', 'Floor'], ['room-walls', 'All walls'], ['ceiling', 'Ceiling']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setRoomTarget(k)} className={`flex-1 py-1.5 ${roomTarget === k ? 'bg-amber-500 text-stone-950' : 'text-stone-300 hover:bg-stone-800'}`}>{l}</button>
            ))}
          </div>
        ) : target === 'wall' ? (
          <div className="flex overflow-hidden rounded-md border border-stone-700 text-sm">
            {([['both', 'Both faces'], ['A', 'Face A'], ['B', 'Face B']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSide(k)} className={`flex-1 py-1.5 ${side === k ? 'bg-amber-500 text-stone-950' : 'text-stone-300 hover:bg-stone-800'}`}>{l}</button>
            ))}
          </div>
        ) : <p className="text-sm capitalize text-stone-300">Selected {target}</p>}
        {target === 'wall' && <p className="mt-1 text-[11px] text-stone-500">Tip: select a room and choose “All walls” to paint only the faces inside that room.</p>}
        {cur && <p className="mt-2 text-xs text-stone-500">Current: <span className="text-stone-300">{cur.name}</span> · {cur.colorHex}</p>}
      </Section>
      <Section title="Colour code">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input type="color" value={parseColorInput(hex) ?? '#000000'} onChange={(e) => setHex(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-stone-700 bg-transparent" aria-label="Colour picker" />
            <input value={hex} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyHex()} className={inputCls} placeholder="#C46A4A or rgb(196,106,74)" />
            <Btn variant="primary" onClick={applyHex}>Apply</Btn>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Roughness ${rough.toFixed(2)}`}><input type="range" min={0} max={1} step={0.05} value={rough} onChange={(e) => setRough(+e.target.value)} className="w-full accent-amber-500" /></Field>
            <Field label={`Metalness ${metal.toFixed(2)}`}><input type="range" min={0} max={1} step={0.05} value={metal} onChange={(e) => setMetal(+e.target.value)} className="w-full accent-amber-500" /></Field>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-stone-600 py-2 text-xs text-stone-300 hover:border-amber-500">
            <Upload size={14} /> Upload texture image
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadTexture(e.target.files[0])} />
          </label>
          {cur?.textureDataUrl && (
            <Field label={`Texture repeat size ${cur.textureScale ?? 1} m`}>
              <input type="range" min={0.2} max={4} step={0.1} value={cur.textureScale ?? 1} className="w-full accent-amber-500"
                onChange={(e) => mutate((sc) => { sc.materials[cur.id] = { ...sc.materials[cur.id], textureScale: +e.target.value }; }, 'texscale:' + cur.id)} />
            </Field>
          )}
        </div>
      </Section>
      <Section title="Material library">
        <div className="mb-2 flex flex-wrap gap-1">
          {kinds.map((k) => <button key={k} onClick={() => setKindFilter(k)} className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${kindFilter === k ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}>{k}</button>)}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {mats.filter((m) => kindFilter === 'all' || m.kind === kindFilter || (kindFilter === 'custom' && m.id.startsWith('ai-'))).map((m) => (
            <button key={m.id} onClick={() => apply(m)} title={`${m.name} · ${m.colorHex}`} className={`group overflow-hidden rounded-md border text-left ${current === m.id ? 'border-amber-500 ring-1 ring-amber-500' : 'border-stone-700 hover:border-stone-500'}`}>
              {m.textureDataUrl ? <img src={m.textureDataUrl} alt="" className="aspect-square w-full object-cover" /> : <img src={swatches[m.id]} alt="" className="aspect-square w-full" />}
              <span className="block truncate px-1 py-0.5 text-[10px] text-stone-400 group-hover:text-stone-200">{m.name}</span>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
