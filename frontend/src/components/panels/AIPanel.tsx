import { useState } from 'react';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Badge, Btn, Empty, Field, NumField, Section, inputCls } from '../ui';
import { STYLES, type AssetStyle } from '../../lib/catalog';
import { applyChanges, localProvider, remoteProvider, type Proposal } from '../../lib/ai';
import { runJob } from '../../lib/jobs';
import { thumbnail } from '../../lib/capture';
import { uid } from '../../lib/templates';

export default function AIPanel() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const settings = useEditor((s) => s.settings);
  const jobs = useEditor((s) => s.jobs);
  const { mutate, updateProject, toast } = useEditor.getState();
  const s = project.scene;
  const [roomId, setRoomId] = useState<string>(selection?.kind === 'room' ? selection.id : s.rooms[0]?.id ?? '');
  const [style, setStyle] = useState<AssetStyle>('scandinavian');
  const [prompt, setPrompt] = useState('');
  const [budget, setBudget] = useState(0);
  const [replace, setReplace] = useState(false);
  const [provider, setProvider] = useState<'local' | 'remote'>('local');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === jobId);
  const busy = job && (job.status === 'queued' || job.status === 'running');

  if (s.rooms.length === 0) return <Section title="AI design assistant"><Empty>Add or detect at least one room first — the assistant designs one room at a time.</Empty></Section>;

  const generate = () => {
    const prov = provider === 'remote' && settings.backendUrl ? remoteProvider(settings.backendUrl, settings.apiToken) : localProvider;
    setProposal(null);
    const id = runJob('ai', `AI proposal · ${s.rooms.find((r) => r.id === roomId)?.name}`, async (progress) => {
      progress(0.2);
      const p = await prov.propose(useEditor.getState().project!.scene, { roomId, style, prompt, budget: budget || undefined, replaceFurniture: replace });
      progress(0.9);
      setProposal(p);
      setChecked(new Set(p.changes.map((c) => c.id)));
    });
    setJobId(id);
  };

  const accept = () => {
    if (!proposal) return;
    const chosen = proposal.changes.filter((c) => checked.has(c.id));
    // snapshot first so the change can be rolled back from Versions as well as Undo
    const snap = structuredClone(project.scene);
    updateProject((p) => {
      p.versions = [...p.versions, { id: uid(), number: (p.versions.at(-1)?.number ?? 0) + 1, label: `Before AI: ${proposal.summary}`, createdAt: Date.now(), thumbnail: thumbnail() ?? undefined, scene: snap }];
    });
    mutate((sc) => applyChanges(sc, chosen));
    toast(`Applied ${chosen.length} change(s). Undo (Ctrl+Z) or restore the saved version to roll back.`, 'success');
    setProposal(null);
  };

  return (
    <>
      <Section title="AI design assistant">
        <div className="space-y-2">
          <Field label="Room">
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={inputCls}>
              {s.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.roomType})</option>)}
            </select>
          </Field>
          <Field label="Style">
            <div className="flex flex-wrap gap-1">
              {STYLES.map((st) => <button key={st.id} onClick={() => setStyle(st.id)} className={`rounded-full px-2 py-0.5 text-[11px] ${style === st.id ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}>{st.label}</button>)}
            </div>
          </Field>
          <Field label="Prompt" hint="Mention colours (e.g. sage, navy, #C46A4A), materials (oak, marble), mood (warm, bright, minimal).">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={inputCls} placeholder="Warm and cosy living room with sage green walls and oak flooring" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Furniture budget (${project.currency})`}><NumField value={budget} min={0} step={5000} onCommit={setBudget} /></Field>
            <Field label="Provider">
              <select value={provider} onChange={(e) => setProvider(e.target.value as 'local' | 'remote')} className={inputCls}>
                <option value="local">Built-in rules (offline)</option>
                <option value="remote" disabled={!settings.backendUrl}>Server AI {settings.backendUrl ? '' : '(set backend in Settings)'}</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-300"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-amber-500" /> Replace existing furniture in this room</label>
          <Btn variant="primary" className="w-full" onClick={generate} disabled={!!busy || !roomId}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate proposal
          </Btn>
          {job?.status === 'failed' && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
              {job.error} <button className="ml-1 underline" onClick={generate}>Retry</button>
              {provider === 'remote' && <button className="ml-2 underline" onClick={() => { setProvider('local'); }}>Use built-in rules</button>}
            </div>
          )}
        </div>
      </Section>
      {proposal && (
        <Section title="Review proposal" right={<Badge tone="sky">{proposal.provider}</Badge>}>
          <p className="mb-2 text-sm font-medium capitalize text-stone-100">{proposal.summary}</p>
          <ul className="space-y-1">
            {proposal.changes.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-stone-300 hover:bg-stone-800">
                  <input type="checkbox" className="accent-amber-500" checked={checked.has(c.id)} onChange={(e) => {
                    const n = new Set(checked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setChecked(n);
                  }} />
                  {c.kind === 'paint-walls' && <span className="h-3 w-3 rounded-sm" style={{ background: c.material.colorHex }} />}
                  <span className="flex-1">{c.label}</span>
                  <span className="text-[10px] uppercase text-stone-500">{c.kind}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-400">Furniture cost (indicative): {project.currency}{proposal.estimatedCost.toLocaleString('en-IN')}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-stone-500">{proposal.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <div className="mt-3 flex gap-2">
            <Btn variant="primary" onClick={accept} disabled={checked.size === 0}><Check size={14} /> Accept {checked.size}</Btn>
            <Btn variant="outline" onClick={() => setProposal(null)}><X size={14} /> Reject</Btn>
          </div>
        </Section>
      )}
    </>
  );
}
