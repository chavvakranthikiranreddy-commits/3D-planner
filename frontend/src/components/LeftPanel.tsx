import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, Layers } from 'lucide-react';
import { useEditor } from '../store/editor';
import { fmtArea, fmtLen, polygonArea, validateGeometry, wallLength } from '../lib/geometry';
import { Badge } from './ui';

function Group({ title, count, children, defaultOpen = true }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-800">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-200">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title} <span className="ml-auto font-normal text-stone-600">{count}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

export default function LeftPanel() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const activeFloorId = useEditor((s) => s.activeFloorId);
  const showBlueprint = useEditor((s) => s.showBlueprint);
  const { select, setActiveFloor, toggle, updateProject } = useEditor.getState();
  const s = project.scene;
  const u = project.units;
  const walls = s.walls.filter((w) => w.floorId === activeFloorId);
  const rooms = s.rooms.filter((r) => r.floorId === activeFloorId);
  const objects = s.objects.filter((o) => o.floorId === activeFloorId);
  const openings = s.openings.filter((o) => walls.some((w) => w.id === o.wallId));
  const issues = validateGeometry(walls, openings);
  const toReview = walls.filter((w) => w.confidence !== undefined).length + openings.filter((o) => o.confidence !== undefined).length + rooms.filter((r) => r.source === 'detected').length;
  const item = (active: boolean, onClick: () => void, children: React.ReactNode, key: string) => (
    <button key={key} onClick={onClick} className={`flex w-full items-center gap-2 px-4 py-1 text-left text-[13px] ${active ? 'bg-amber-500/15 text-amber-200' : 'text-stone-300 hover:bg-stone-800'}`}>{children}</button>
  );
  const bp = project.blueprint;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-stone-800 p-3">
        <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400"><Layers size={12} /> Floor</label>
        <select value={activeFloorId} onChange={(e) => setActiveFloor(e.target.value)} className="w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-100">
          {[...s.floors].sort((a, b) => a.level - b.level).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {bp && (
          <div className="mt-2 flex items-center gap-2 text-xs text-stone-400">
            <button onClick={() => toggle('showBlueprint')} className="flex items-center gap-1 hover:text-white">{showBlueprint ? <Eye size={13} /> : <EyeOff size={13} />} Blueprint</button>
            <input type="range" min={0.05} max={1} step={0.05} value={bp.opacity} aria-label="Blueprint opacity"
              onChange={(e) => updateProject((p) => { p.blueprint = { ...p.blueprint!, opacity: +e.target.value }; })} className="flex-1 accent-amber-500" />
          </div>
        )}
      </div>
      {(issues.length > 0 || toReview > 0) && (
        <div className="space-y-1 border-b border-stone-800 bg-amber-500/5 p-3 text-xs">
          {toReview > 0 && <p className="flex items-center gap-1 text-amber-300"><AlertTriangle size={12} /> {toReview} detected item(s) awaiting your confirmation</p>}
          {issues.slice(0, 4).map((i, k) => <p key={k} className="text-stone-400">• {i}</p>)}
        </div>
      )}
      <Group title="Rooms" count={rooms.length}>
        {rooms.map((r) => item(selection?.kind === 'room' && selection.id === r.id, () => select({ kind: 'room', id: r.id }), <>
          <span className="flex-1 truncate">{r.name}</span>
          {r.source === 'detected' && <Badge tone="amber">?</Badge>}
          <span className="text-[11px] text-stone-500">{fmtArea(polygonArea(r.polygon), u)}</span>
        </>, r.id))}
        {rooms.length === 0 && <p className="px-4 text-xs text-stone-600">Use the Room tool (R) to outline rooms.</p>}
      </Group>
      <Group title="Walls" count={walls.length} defaultOpen={walls.length < 14}>
        {walls.map((w, i) => item(selection?.kind === 'wall' && selection.id === w.id, () => select({ kind: 'wall', id: w.id }), <>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.materials[w.materialId]?.colorHex }} />
          <span className="flex-1">Wall {i + 1}</span>
          {w.confidence !== undefined && <Badge tone={w.confidence < 0.6 ? 'amber' : 'sky'}>{Math.round(w.confidence * 100)}%</Badge>}
          <span className="text-[11px] text-stone-500">{fmtLen(wallLength(w), u)}</span>
        </>, w.id))}
      </Group>
      <Group title="Doors & windows" count={openings.length} defaultOpen={false}>
        {openings.map((o) => item(selection?.kind === 'opening' && selection.id === o.id, () => select({ kind: 'opening', id: o.id }), <>
          <span className="flex-1 capitalize">{o.type}</span>
          {o.confidence !== undefined && <Badge tone="amber">?</Badge>}
          <span className="text-[11px] text-stone-500">{fmtLen(o.width, u)}</span>
        </>, o.id))}
      </Group>
      <Group title="Furniture" count={objects.length}>
        {objects.map((o) => item(selection?.kind === 'object' && selection.id === o.id, () => select({ kind: 'object', id: o.id }), <>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.colorHex }} />
          <span className="flex-1 truncate">{o.name}</span>
          {o.estimated && <Badge tone="amber">est.</Badge>}
        </>, o.id))}
      </Group>
    </div>
  );
}
