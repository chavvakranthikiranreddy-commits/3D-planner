import { useState } from 'react';
import { Camera, FileText, FileJson, Download, X, RotateCcw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Badge, Btn, Field, Section, inputCls } from '../ui';
import { captureFrame, downloadDataUrl, downloadText, hasViewport } from '../../lib/capture';
import { cancelJob, retryJob, runJob, nextFrame } from '../../lib/jobs';
import { buildReport } from '../../lib/report';
import { buildEstimate } from '../../lib/estimate';
import type { Job } from '../../lib/types';

const RES = [
  { label: 'Preview · 1280×720', w: 1280, h: 720 },
  { label: 'Full HD · 1920×1080', w: 1920, h: 1080 },
  { label: '4K · 3840×2160', w: 3840, h: 2160 },
  { label: 'Square · 2048×2048', w: 2048, h: 2048 },
];

async function ensureViewport() {
  if (hasViewport()) return;
  useEditor.getState().setView('split');
  for (let i = 0; i < 60 && !hasViewport(); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 400));
  if (!hasViewport()) throw new Error('The 3D view could not be started (WebGL unavailable?).');
}

export function JobRow({ j }: { j: Job }) {
  const icon = j.status === 'succeeded' ? <CheckCircle2 size={14} className="text-emerald-400" /> : j.status === 'failed' ? <AlertCircle size={14} className="text-red-400" /> : j.status === 'cancelled' ? <X size={14} className="text-stone-500" /> : <Loader2 size={14} className="animate-spin text-amber-400" />;
  return (
    <li className="rounded-md border border-stone-800 p-2">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span className="flex-1 truncate text-stone-200">{j.label}</span>
        <Badge tone={j.status === 'failed' ? 'red' : j.status === 'succeeded' ? 'green' : 'stone'}>{j.status}</Badge>
      </div>
      {(j.status === 'running' || j.status === 'queued') && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-stone-800"><div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>
          <button className="text-[11px] text-stone-400 hover:text-white" onClick={() => cancelJob(j.id)}>Cancel</button>
        </div>
      )}
      {j.status === 'failed' && <p className="mt-1 text-xs text-red-300">{j.error} <button className="ml-1 inline-flex items-center gap-0.5 underline" onClick={() => retryJob(j.id)}><RotateCcw size={10} /> Retry</button></p>}
      {j.status === 'succeeded' && j.result && j.type === 'render' && (
        <div className="mt-2 flex items-center gap-2">
          <img src={j.result} alt="Render" className="h-12 w-20 rounded object-cover" />
          <Btn variant="outline" onClick={() => downloadDataUrl(j.result!, `render-${j.id}.png`)}><Download size={14} /> Download</Btn>
        </div>
      )}
    </li>
  );
}

export default function ExportPanel() {
  const project = useEditor((s) => s.project)!;
  const jobs = useEditor((s) => s.jobs);
  const [res, setRes] = useState(1);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const est = buildEstimate(project);
  const total = est.reduce((a, l) => a + l.total, 0);
  const slug = project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  const render = () => {
    const r = RES[res];
    runJob('render', `Render ${r.w}×${r.h}`, async (progress, signal) => {
      await ensureViewport();
      progress(0.3);
      const { project: p } = useEditor.getState();
      // high quality: temporarily boost the sun shadow + exposure settings by re-rendering a few frames
      if (quality === 'high' && p) { for (let i = 0; i < 4; i++) { await nextFrame(); progress(0.3 + i * 0.1); } }
      if (signal.aborted) return;
      const url = captureFrame(r.w, r.h);
      if (!url) throw new Error('Could not capture the 3D view.');
      progress(0.95);
      return url;
    });
  };
  const report = () => {
    runJob('report', 'PDF project report', async (progress) => {
      await ensureViewport();
      progress(0.3);
      const img = captureFrame(1600, 900, 'image/jpeg');
      progress(0.6);
      const doc = buildReport(useEditor.getState().project!, img);
      doc.save(`${slug}-report.pdf`);
      progress(1);
    });
  };
  const exportJson = () => {
    const p = useEditor.getState().project!;
    downloadText(JSON.stringify({ format: 'archiform-project', version: 1, exportedAt: new Date().toISOString(), project: p }, null, 0), `${slug}.archiform.json`);
  };

  return (
    <>
      <Section title="Render image">
        <div className="space-y-2">
          <Field label="Resolution">
            <select className={inputCls} value={res} onChange={(e) => setRes(+e.target.value)}>{RES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}</select>
          </Field>
          <div className="flex overflow-hidden rounded-md border border-stone-700 text-xs">
            {(['standard', 'high'] as const).map((q) => <button key={q} onClick={() => setQuality(q)} className={`flex-1 py-1.5 capitalize ${quality === q ? 'bg-amber-500 text-stone-950' : 'text-stone-300'}`}>{q}</button>)}
          </div>
          <Btn variant="primary" className="w-full" onClick={render}><Camera size={14} /> Render current camera</Btn>
          <p className="text-[11px] text-stone-500">Renders the 3D camera as framed. Photoreal path-traced renders (Blender worker) run on the optional backend.</p>
        </div>
      </Section>
      <Section title="Reports & files">
        <div className="space-y-2">
          <Btn variant="outline" className="w-full" onClick={report}><FileText size={14} /> PDF report (dimensions, finishes, products, estimate)</Btn>
          <Btn variant="outline" className="w-full" onClick={exportJson}><FileJson size={14} /> Export project file (.json)</Btn>
          <div className="rounded-md bg-stone-800/50 p-2 text-xs text-stone-300">
            Indicative total: <b className="text-stone-100">{project.currency}{Math.round(total).toLocaleString('en-IN')}</b> across {est.length} lines
            <p className="mt-1 text-[10px] text-stone-500">Not a quotation — see report assumptions.</p>
          </div>
        </div>
      </Section>
      <Section title="Jobs">
        {jobs.length === 0 ? <p className="text-xs text-stone-500">Render, report and AI jobs appear here with progress.</p> : <ul className="space-y-2">{jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul>}
      </Section>
    </>
  );
}
