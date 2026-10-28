import { useState } from 'react';
import { History, Save, GitCompare, RotateCcw, Trash2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Empty, Modal, Section, TextInput } from '../ui';
import { thumbnail } from '../../lib/capture';
import { uid } from '../../lib/templates';
import { sceneStats } from '../../lib/estimate';
import { fmtArea } from '../../lib/geometry';
import type { DesignVersion } from '../../lib/types';

function CompareModal({ a, b, onClose, units }: { a: DesignVersion; b: DesignVersion | 'current'; onClose: () => void; units: 'm' | 'ft' }) {
  const [pos, setPos] = useState(50);
  const project = useEditor((s) => s.project)!;
  const bThumb = b === 'current' ? thumbnail() : b.thumbnail;
  const bScene = b === 'current' ? project.scene : b.scene;
  const sa = sceneStats(a.scene), sb = sceneStats(bScene);
  return (
    <Modal title="Compare versions" onClose={onClose} wide>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-stone-800 select-none">
        {bThumb && <img src={bThumb} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        {a.thumbnail && <img src={a.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />}
        <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">v{a.number} · {a.label}</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{b === 'current' ? 'Current design' : `v${b.number} · ${b.label}`}</span>
        {!a.thumbnail && <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-400">No preview image stored for this version.</p>}
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(+e.target.value)} className="mt-3 w-full accent-amber-500" aria-label="Comparison slider" />
      <table className="mt-3 w-full text-sm text-stone-300">
        <thead><tr className="text-left text-[11px] uppercase text-stone-500"><th>Metric</th><th>v{a.number}</th><th>{b === 'current' ? 'Current' : `v${b.number}`}</th></tr></thead>
        <tbody>
          <tr><td>Floor area</td><td>{fmtArea(sa.floorArea, units)}</td><td>{fmtArea(sb.floorArea, units)}</td></tr>
          <tr><td>Doors / windows</td><td>{sa.doors} / {sa.windows}</td><td>{sb.doors} / {sb.windows}</td></tr>
          <tr><td>Furniture items</td><td>{sa.objects}</td><td>{sb.objects}</td></tr>
          <tr><td>Rooms</td><td>{a.scene.rooms.length}</td><td>{bScene.rooms.length}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}

export default function VersionsPanel() {
  const project = useEditor((s) => s.project)!;
  const { updateProject, mutate, toast } = useEditor.getState();
  const [label, setLabel] = useState('');
  const [cmp, setCmp] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const versions = [...project.versions].reverse();

  const save = (l?: string) => {
    const snap = structuredClone(project.scene);
    const th = thumbnail() ?? undefined;
    updateProject((p) => {
      p.versions = [...p.versions, { id: uid(), number: (p.versions.at(-1)?.number ?? 0) + 1, label: l || label || `Version ${(p.versions.at(-1)?.number ?? 0) + 1}`, createdAt: Date.now(), thumbnail: th, scene: snap }];
      if (th) p.thumbnail = th;
    });
    setLabel('');
    toast('Version saved', 'success');
  };
  const restore = (v: DesignVersion) => {
    if (!confirm(`Restore “${v.label}”? The current design will be saved as a new version first.`)) return;
    save('Auto-save before restore');
    mutate((s) => { Object.assign(s, structuredClone(v.scene)); });
    toast(`Restored v${v.number}`, 'success');
  };
  const a = project.versions.find((v) => v.id === cmp[0]);
  const bId = cmp[1];
  const b = bId === 'current' ? 'current' : project.versions.find((v) => v.id === bId);

  return (
    <>
      <Section title="Save a version">
        <div className="flex gap-2">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Option A – warm palette" onKeyDown={(e) => e.key === 'Enter' && save()} />
          <Btn variant="primary" onClick={() => save()}><Save size={14} /></Btn>
        </div>
        <p className="mt-2 text-[11px] text-stone-500">Every edit is autosaved. Versions are named snapshots you can compare and restore.</p>
      </Section>
      <Section title={`History (${versions.length})`} right={
        <Btn variant="outline" disabled={cmp.length < 1} onClick={() => { if (cmp.length === 1) setCmp([cmp[0], 'current']); setShow(true); }}><GitCompare size={14} /> Compare</Btn>
      }>
        {versions.length === 0 ? <Empty>No saved versions yet.</Empty> : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className={`flex gap-2 rounded-md border p-1.5 ${cmp.includes(v.id) ? 'border-amber-500/70' : 'border-stone-800'}`}>
                <button className="h-12 w-20 shrink-0 overflow-hidden rounded bg-stone-800" onClick={() => setCmp((c) => c.includes(v.id) ? c.filter((x) => x !== v.id) : [...c, v.id].slice(-2))} title="Select for comparison">
                  {v.thumbnail ? <img src={v.thumbnail} alt="" className="h-full w-full object-cover" /> : <History size={16} className="m-auto text-stone-600" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-stone-200">v{v.number} · {v.label}</div>
                  <div className="text-[11px] text-stone-500">{new Date(v.createdAt).toLocaleString()}</div>
                  <div className="mt-1 flex gap-2">
                    <button className="flex items-center gap-1 text-[11px] text-amber-400 hover:underline" onClick={() => restore(v)}><RotateCcw size={11} /> Restore</button>
                    <button className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-red-400" onClick={() => confirm('Delete this version?') && updateProject((p) => { p.versions = p.versions.filter((x) => x.id !== v.id); })}><Trash2 size={11} /> Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cmp.length > 0 && <p className="mt-2 text-[11px] text-stone-500">{cmp.length === 1 ? 'Compare with the current design, or select a second version.' : 'Two versions selected.'}</p>}
      </Section>
      {show && a && b && <CompareModal a={a} b={b} units={project.units} onClose={() => { setShow(false); setCmp([]); }} />}
    </>
  );
}
