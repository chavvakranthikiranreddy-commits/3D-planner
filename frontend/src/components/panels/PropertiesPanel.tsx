import { Copy, Trash2, Check, Plus, Scissors, AlertTriangle } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Badge, Btn, Empty, Field, LenField, NumField, Section, TextInput, inputCls } from '../ui';
import { fmtArea, fmtLen, polygonArea, polygonPerimeter, wallAngle, wallLength } from '../../lib/geometry';
import { getAsset } from '../../lib/catalog';
import { parseColorInput } from '../../lib/materials';
import { uid } from '../../lib/templates';
import type { Opening, Room, RoomType, SceneObject, Wall } from '../../lib/types';

const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hallway', 'balcony', 'utility', 'pooja', 'other'];

function ColorInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  return (
    <div className="flex gap-2">
      <input type="color" value={value} onChange={(e) => onCommit(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-stone-700 bg-transparent" aria-label="Pick colour" />
      <input key={value} defaultValue={value} className={inputCls} placeholder="#RRGGBB or rgb(…)"
        onBlur={(e) => { const h = parseColorInput(e.target.value); if (h) onCommit(h); else e.target.value = value; }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

export default function PropertiesPanel() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const { mutate, select, updateProject, setRightTab, activeFloorId, setActiveFloor } = useEditor.getState();
  const s = project.scene;
  const u = project.units;

  if (!selection) {
    return (
      <>
        <Section title="Project">
          <div className="space-y-3">
            <Field label="Name"><TextInput defaultValue={project.name} onBlur={(e) => updateProject((p) => { p.name = e.target.value || p.name; })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Units">
                <select className={inputCls} value={project.units} onChange={(e) => updateProject((p) => { p.units = e.target.value as 'm' | 'ft'; })}>
                  <option value="m">Metric (m)</option><option value="ft">Imperial (ft-in)</option>
                </select>
              </Field>
              <Field label="Currency"><TextInput defaultValue={project.currency} maxLength={4} onBlur={(e) => updateProject((p) => { p.currency = e.target.value || '₹'; })} /></Field>
            </div>
          </div>
        </Section>
        <Section title="Floors" right={
          <Btn title="Add floor" onClick={() => mutate((sc) => {
            const top = [...sc.floors].sort((a, b) => b.level - a.level)[0];
            const f = { id: uid(), name: `Floor ${top.level + 1}`, level: top.level + 1, elevation: +(top.elevation + top.ceilingHeight + 0.2).toFixed(2), ceilingHeight: top.ceilingHeight };
            sc.floors.push(f);
            // copy exterior walls up so floors align vertically
            sc.walls.filter((w) => w.floorId === top.id && w.thickness >= 0.2).forEach((w) => sc.walls.push({ ...w, id: uid(), floorId: f.id, height: f.ceilingHeight, confidence: undefined }));
          })}><Plus size={14} /> Floor</Btn>
        }>
          <div className="space-y-2">
            {[...s.floors].sort((a, b) => a.level - b.level).map((f) => (
              <div key={f.id} className={`rounded-md border p-2 ${f.id === activeFloorId ? 'border-amber-500/60 bg-amber-500/5' : 'border-stone-800'}`}>
                <div className="flex items-center gap-2">
                  <button className="flex-1 text-left text-sm text-stone-200" onClick={() => setActiveFloor(f.id)}>{f.name}</button>
                  {s.floors.length > 1 && f.level > 0 && (
                    <button aria-label="Delete floor" className="text-stone-500 hover:text-red-400" onClick={() => {
                      if (!confirm(`Delete ${f.name} and everything on it?`)) return;
                      mutate((sc) => {
                        const wallIds = new Set(sc.walls.filter((w) => w.floorId === f.id).map((w) => w.id));
                        sc.floors = sc.floors.filter((x) => x.id !== f.id);
                        sc.walls = sc.walls.filter((w) => w.floorId !== f.id);
                        sc.openings = sc.openings.filter((o) => !wallIds.has(o.wallId));
                        sc.rooms = sc.rooms.filter((r) => r.floorId !== f.id);
                        sc.objects = sc.objects.filter((o) => o.floorId !== f.id);
                      });
                      setActiveFloor(s.floors[0].id);
                    }}><Trash2 size={14} /></button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Elevation"><LenField meters={f.elevation} units={u} onCommit={(v) => mutate((sc) => { sc.floors.find((x) => x.id === f.id)!.elevation = v; })} /></Field>
                  <Field label="Ceiling"><LenField meters={f.ceilingHeight} units={u} min={2} onCommit={(v) => mutate((sc) => {
                    sc.floors.find((x) => x.id === f.id)!.ceilingHeight = v;
                    sc.walls.forEach((w) => { if (w.floorId === f.id) w.height = v; });
                  })} /></Field>
                </div>
              </div>
            ))}
            {(() => {
              // vertical alignment check
              const sorted = [...s.floors].sort((a, b) => a.level - b.level);
              const bad = sorted.slice(1).filter((f, i) => f.elevation < sorted[i].elevation + sorted[i].ceilingHeight - 0.01);
              return bad.length ? <p className="flex items-center gap-1 text-xs text-amber-300"><AlertTriangle size={12} /> {bad.map((b) => b.name).join(', ')} overlaps the floor below.</p> : null;
            })()}
          </div>
        </Section>
        <Section title="Selection"><Empty>Select a wall, room, opening or item in the 2D plan or 3D view to edit it.</Empty></Section>
      </>
    );
  }

  if (selection.kind === 'wall') {
    const w = s.walls.find((x) => x.id === selection.id);
    if (!w) return <Section title="Wall"><Empty>Wall no longer exists.</Empty></Section>;
    const L = wallLength(w);
    const ops = s.openings.filter((o) => o.wallId === w.id);
    const m = s.materials[w.materialId];
    const upd = (fn: (x: Wall) => void) => mutate((sc) => { const x = sc.walls.find((q) => q.id === w.id); if (x) fn(x); });
    return (
      <>
        <Section title="Wall" right={w.confidence !== undefined ? <Badge tone={w.confidence < 0.6 ? 'amber' : 'sky'}>detected {Math.round(w.confidence * 100)}%</Badge> : <Badge>{w.source}</Badge>}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Length"><LenField meters={L} units={u} min={0.05} onCommit={(v) => upd((x) => { const a = wallAngle(x); x.b = { x: x.a.x + Math.cos(a) * v, y: x.a.y + Math.sin(a) * v }; })} /></Field>
            <Field label="Height"><LenField meters={w.height} units={u} min={1} onCommit={(v) => upd((x) => { x.height = v; })} /></Field>
            <Field label="Thickness"><LenField meters={w.thickness} units={u} min={0.03} max={1} onCommit={(v) => upd((x) => { x.thickness = v; })} /></Field>
            <Field label="Angle"><NumField value={+((wallAngle(w) * 180) / Math.PI).toFixed(1)} step={1} suffix="°" onCommit={(v) => upd((x) => { const r = (v * Math.PI) / 180; x.b = { x: x.a.x + Math.cos(r) * L, y: x.a.y + Math.sin(r) * L }; })} /></Field>
          </div>
          <button onClick={() => setRightTab('materials')} className="mt-3 flex w-full items-center gap-2 rounded-md border border-stone-700 p-2 text-left text-sm hover:border-stone-500">
            <span className="h-6 w-6 rounded" style={{ background: m?.colorHex }} />
            <span className="flex-1 text-stone-200">{m?.name ?? 'Material'}</span>
            <span className="text-xs text-stone-500">{m?.colorHex}</span>
          </button>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {w.confidence !== undefined && <Btn variant="outline" onClick={() => upd((x) => { x.confidence = undefined; })}><Check size={14} /> Confirm</Btn>}
            <Btn variant="outline" title="Split wall in the middle" onClick={() => mutate((sc) => {
              const x = sc.walls.find((q) => q.id === w.id)!;
              const mid = { x: (x.a.x + x.b.x) / 2, y: (x.a.y + x.b.y) / 2 };
              const nw = { ...x, id: uid(), a: mid };
              x.b = mid;
              sc.walls.push(nw);
              sc.openings.forEach((o) => { if (o.wallId === x.id && o.offset > L / 2) { o.wallId = nw.id; o.offset -= L / 2; } });
            })}><Scissors size={14} /> Split</Btn>
            <Btn variant="outline" onClick={() => mutate((sc) => { sc.openings.push({ id: uid(), wallId: w.id, type: 'door', offset: L / 2, width: Math.min(0.9, L), height: 2.1, sill: 0, source: 'manual' }); })}><Plus size={14} /> Door</Btn>
            <Btn variant="outline" onClick={() => mutate((sc) => { sc.openings.push({ id: uid(), wallId: w.id, type: 'window', offset: L / 2, width: Math.min(1.2, L), height: 1.2, sill: 0.9, source: 'manual' }); })}><Plus size={14} /> Window</Btn>
            <Btn variant="danger" onClick={() => { mutate((sc) => { sc.walls = sc.walls.filter((q) => q.id !== w.id); sc.openings = sc.openings.filter((o) => o.wallId !== w.id); }); select(null); }}><Trash2 size={14} /> Delete</Btn>
          </div>
        </Section>
        <Section title={`Openings (${ops.length})`}>
          {ops.length === 0 ? <Empty>No doors or windows on this wall.</Empty> : (
            <ul className="space-y-1">
              {ops.map((o) => (
                <li key={o.id}><button className="w-full rounded px-2 py-1 text-left text-sm text-stone-300 hover:bg-stone-800" onClick={() => select({ kind: 'opening', id: o.id })}>
                  {o.type === 'door' ? 'Door' : 'Window'} · {fmtLen(o.width, u)} at {fmtLen(o.offset, u)}
                </button></li>
              ))}
            </ul>
          )}
        </Section>
      </>
    );
  }

  if (selection.kind === 'opening') {
    const o = s.openings.find((x) => x.id === selection.id);
    const w = o && s.walls.find((x) => x.id === o.wallId);
    if (!o || !w) return <Section title="Opening"><Empty>Opening no longer exists.</Empty></Section>;
    const upd = (fn: (x: Opening) => void) => mutate((sc) => { const x = sc.openings.find((q) => q.id === o.id); if (x) fn(x); });
    return (
      <Section title={o.type === 'door' ? 'Door' : 'Window'} right={o.confidence !== undefined ? <Badge tone="amber">detected {Math.round(o.confidence * 100)}%</Badge> : null}>
        <div className="mb-3 flex overflow-hidden rounded-md border border-stone-700 text-sm">
          {(['door', 'window'] as const).map((t) => (
            <button key={t} onClick={() => upd((x) => { x.type = t; if (t === 'door') x.sill = 0; else if (x.sill === 0) { x.sill = 0.9; x.height = 1.2; } })} className={`flex-1 py-1.5 capitalize ${o.type === t ? 'bg-amber-500 text-stone-950' : 'text-stone-300 hover:bg-stone-800'}`}>{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width"><LenField meters={o.width} units={u} min={0.2} max={wallLength(w)} onCommit={(v) => upd((x) => { x.width = v; })} /></Field>
          <Field label="Height"><LenField meters={o.height} units={u} min={0.2} max={w.height} onCommit={(v) => upd((x) => { x.height = v; })} /></Field>
          {o.type === 'window' && <Field label="Sill height"><LenField meters={o.sill} units={u} min={0} max={w.height - 0.2} onCommit={(v) => upd((x) => { x.sill = v; })} /></Field>}
          <Field label="From wall start"><LenField meters={o.offset} units={u} min={0} max={wallLength(w)} onCommit={(v) => upd((x) => { x.offset = v; })} /></Field>
        </div>
        <div className="mt-3 flex gap-1.5">
          {o.confidence !== undefined && <Btn variant="outline" onClick={() => upd((x) => { x.confidence = undefined; })}><Check size={14} /> Confirm</Btn>}
          <Btn variant="outline" onClick={() => select({ kind: 'wall', id: w.id })}>Select wall</Btn>
          <Btn variant="danger" onClick={() => { mutate((sc) => { sc.openings = sc.openings.filter((q) => q.id !== o.id); }); select(null); }}><Trash2 size={14} /> Delete</Btn>
        </div>
      </Section>
    );
  }

  if (selection.kind === 'room') {
    const r = s.rooms.find((x) => x.id === selection.id);
    if (!r) return <Section title="Room"><Empty>Room no longer exists.</Empty></Section>;
    const upd = (fn: (x: Room) => void) => mutate((sc) => { const x = sc.rooms.find((q) => q.id === r.id); if (x) fn(x); });
    return (
      <Section title="Room" right={r.source === 'detected' ? <Badge tone="amber">detected</Badge> : null}>
        <div className="space-y-2">
          <Field label="Name"><TextInput key={r.id} defaultValue={r.name} onBlur={(e) => upd((x) => { x.name = e.target.value || x.name; })} /></Field>
          <Field label="Room type">
            <select className={inputCls} value={r.roomType} onChange={(e) => upd((x) => { x.roomType = e.target.value as RoomType; })}>
              {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2 rounded-md bg-stone-800/50 p-2 text-sm">
            <div><div className="text-[11px] text-stone-500">Area</div><div className="text-stone-100">{fmtArea(polygonArea(r.polygon), u)}</div></div>
            <div><div className="text-[11px] text-stone-500">Perimeter</div><div className="text-stone-100">{fmtLen(polygonPerimeter(r.polygon), u)}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setRightTab('materials')} className="flex items-center gap-2 rounded-md border border-stone-700 p-2 text-left text-xs hover:border-stone-500">
              <span className="h-5 w-5 rounded" style={{ background: s.materials[r.floorMaterialId]?.colorHex }} /> Floor
            </button>
            <button onClick={() => setRightTab('materials')} className="flex items-center gap-2 rounded-md border border-stone-700 p-2 text-left text-xs hover:border-stone-500">
              <span className="h-5 w-5 rounded" style={{ background: s.materials[r.ceilingMaterialId]?.colorHex }} /> Ceiling
            </button>
          </div>
          <p className="text-[11px] text-stone-500">Drag the room or its corner handles in the 2D plan to reshape it.</p>
          <div className="flex gap-1.5">
            {r.source === 'detected' && <Btn variant="outline" onClick={() => upd((x) => { x.source = 'manual'; })}><Check size={14} /> Confirm</Btn>}
            <Btn variant="outline" onClick={() => setRightTab('ai')}>Design with AI</Btn>
            <Btn variant="danger" onClick={() => { mutate((sc) => { sc.rooms = sc.rooms.filter((q) => q.id !== r.id); }); select(null); }}><Trash2 size={14} /></Btn>
          </div>
        </div>
      </Section>
    );
  }

  const o = s.objects.find((x) => x.id === selection.id);
  if (!o) return <Section title="Item"><Empty>Item no longer exists.</Empty></Section>;
  const asset = getAsset(o.assetId);
  const upd = (fn: (x: SceneObject) => void) => mutate((sc) => { const x = sc.objects.find((q) => q.id === o.id); if (x) fn(x); });
  return (
    <>
      <Section title="Item" right={o.estimated ? <Badge tone="amber">approximation</Badge> : o.source === 'ai' ? <Badge tone="sky">AI</Badge> : <Badge tone="green">catalog</Badge>}>
        <div className="space-y-2">
          {o.imageDataUrl && <img src={o.imageDataUrl} alt="" className="h-24 w-full rounded-md bg-[repeating-conic-gradient(#292524_0_25%,#1c1917_0_50%)] bg-[length:16px_16px] object-contain" />}
          <Field label="Name"><TextInput key={o.id} defaultValue={o.name} onBlur={(e) => upd((x) => { x.name = e.target.value || x.name; })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Width"><LenField meters={o.dims.w} units={u} min={0.02} onCommit={(v) => upd((x) => { x.dims.w = v; })} /></Field>
            <Field label="Depth"><LenField meters={o.dims.d} units={u} min={0.005} onCommit={(v) => upd((x) => { x.dims.d = v; })} /></Field>
            <Field label="Height"><LenField meters={o.dims.h} units={u} min={0.005} onCommit={(v) => upd((x) => { x.dims.h = v; })} /></Field>
          </div>
          {asset && !o.estimated && (Math.abs(o.dims.w / asset.dims.w - 1) > 0.3 || Math.abs(o.dims.h / asset.dims.h - 1) > 0.3) && (
            <p className="flex items-start gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Resized more than 30% from the catalog product ({asset.dims.w}×{asset.dims.d}×{asset.dims.h} m) — no longer matches a verified size.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="X"><LenField meters={o.x} units={u} min={-1000} onCommit={(v) => upd((x) => { x.x = v; })} /></Field>
            <Field label="Y"><LenField meters={o.y} units={u} min={-1000} onCommit={(v) => upd((x) => { x.y = v; })} /></Field>
            <Field label="Above floor"><LenField meters={o.elevation} units={u} min={0} onCommit={(v) => upd((x) => { x.elevation = v; })} /></Field>
            <Field label="Rotation"><NumField value={+(((o.rotation * 180) / Math.PI) % 360).toFixed(1)} step={15} suffix="°" onCommit={(v) => upd((x) => { x.rotation = (v * Math.PI) / 180; })} /></Field>
          </div>
          <Field label="Colour (HEX / RGB)"><ColorInput value={o.colorHex} onCommit={(h) => upd((x) => { x.colorHex = h; x.materialId = undefined; })} /></Field>
          {o.accentHex && <Field label="Accent colour"><ColorInput value={o.accentHex} onCommit={(h) => upd((x) => { x.accentHex = h; })} /></Field>}
          <Field label={`Price (${project.currency}, indicative)`}><NumField value={o.price ?? 0} step={100} min={0} onCommit={(v) => upd((x) => { x.price = v; })} /></Field>
          {asset && <p className="text-[11px] leading-snug text-stone-500">Source: {o.estimated ? 'your reference image (approximate geometry)' : asset.source} · Licence: {asset.licence}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Btn variant="outline" onClick={() => upd((x) => { x.rotation += Math.PI / 2; })}>Rotate 90°</Btn>
            <Btn variant="outline" onClick={() => {
              const nid = uid();
              mutate((sc) => { sc.objects.push({ ...structuredClone(o), id: nid, x: o.x + 0.3, y: o.y + 0.3 }); });
              select({ kind: 'object', id: nid });
            }}><Copy size={14} /> Duplicate</Btn>
            <Btn variant="danger" onClick={() => { mutate((sc) => { sc.objects = sc.objects.filter((q) => q.id !== o.id); }); select(null); }}><Trash2 size={14} /></Btn>
          </div>
        </div>
      </Section>
    </>
  );
}
