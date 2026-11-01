import { useState } from 'react';
import { Camera, FileText, FileJson, Download, X, RotateCcw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Badge, Btn, Field, Section, inputCls } from '../ui';
import { captureFrame, downloadDataUrl, downloadText, hasViewport, maxExportSide } from '../../lib/capture';
import { cancelJob, ensureActive, retryJob, runJob, nextFrame } from '../../lib/jobs';
import { buildReport, hasUnsupportedText } from '../../lib/report';
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
          <Btn variant="outline" onClick={() => downloadDataUrl(j.result!, `3d-view-${j.id}.png`)}><Download size={14} /> Download</Btn>
        </div>
      )}
    </li>
  );
}

export default function ExportPanel() {
  const project = useEditor((s) => s.project)!;
  const jobs = useEditor((s) => s.jobs);
  const [res, setRes] = useState(1);
  const [panoRoom, setPanoRoom] = useState(() => useEditor.getState().selection?.kind === 'room' ? useEditor.getState().selection!.id : '');
  const est = buildEstimate(project);
  const total = est.reduce((a, l) => a + l.total, 0);
  const slug = project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  const render = () => {
    const r = RES[res];
    const pid = project.id;
    runJob('render', `3D view ${r.w}×${r.h}`, async (progress, signal) => {
      await ensureViewport();
      ensureActive(signal, pid);
      progress(0.3);
      await nextFrame(); // let textures finish uploading
      ensureActive(signal, pid);
      const url = captureFrame(r.w, r.h);
      if (!url) throw new Error('Could not capture the 3D view.');
      progress(0.95);
      return url;
    });
  };
  const report = () => {
    // capture the project now so a later project switch can't change the report's data
    const snapshot = useEditor.getState().project!;
    runJob('report', 'PDF project report', async (progress, signal) => {
      await ensureViewport();
      ensureActive(signal, snapshot.id);
      progress(0.3);
      const img = captureFrame(1600, 900, 'image/jpeg');
      progress(0.6);
      const doc = buildReport(snapshot, img);
      ensureActive(signal, snapshot.id); // no download after Cancel
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
      <Section title="Export 3D view (PNG)">
        <div className="space-y-2">
          <Field label="Resolution">
            <select className={inputCls} value={res} onChange={(e) => setRes(+e.target.value)}>{RES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}</select>
          </Field>
          <Btn variant="primary" className="w-full" onClick={render}><Camera size={14} /> Export current 3D view</Btn>
          <p className="text-[11px] text-stone-500">Saves exactly what the 3D camera shows, at the chosen size (this device supports up to {hasViewport() ? maxExportSide() : 4096} px). It is the real-time view, not a photorealistic render.</p>
        </div>
      </Section>
      <Section title="360° panorama">
        <div className="space-y-2">
          <select className={inputCls} value={panoRoom} onChange={(e) => setPanoRoom(e.target.value)} aria-label="Room for the panorama">
            {project.scene.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Btn variant="outline" className="w-full" disabled={!project.scene.rooms.length} onClick={async () => {
            try { await ensureViewport(); window.dispatchEvent(new CustomEvent('archiform:pano', { detail: panoRoom || project.scene.rooms[0]?.id })); } catch (e) { useEditor.getState().toast((e as Error).message, 'error'); }
          }}><Camera size={14} /> Capture 360° from this room</Btn>
          <p className="text-[11px] text-stone-500">Stands at eye height (1.5 m) in the middle of the room. In the walkthrough, the 360° button captures from where you stand. Uses the current Day / Evening / Night lighting.</p>
        </div>
      </Section>
      <Section title="Reports & files">
        <div className="space-y-2">
          {hasUnsupportedText([project.name, ...project.scene.rooms.map((r) => r.name), ...project.scene.objects.map((o) => o.name)].join(' ')) && (
            <p className="rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-200">Some names use characters (e.g. Telugu or Hindi script) that the PDF font can't show — they will appear as “?”. Use English names for the report.</p>
          )}
          <Btn variant="outline" className="w-full" onClick={report}><FileText size={14} /> PDF report (dimensions, finishes, products, estimate)</Btn>
          <Btn variant="outline" className="w-full" onClick={exportJson}><FileJson size={14} /> Back up project file (.json)</Btn>
          <p className="text-[11px] text-stone-500">Projects are saved on this device only. Keep a backup file to move to another device or recover after clearing browser data.</p>
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
