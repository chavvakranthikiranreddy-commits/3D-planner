import { useState } from 'react';
import { ArrowLeft, Trash2, Server, ShieldCheck } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Btn, Confirm, Field, NumField, TextInput, inputCls } from '../components/ui';
import { wipeAll } from '../lib/db';

export default function Settings() {
  const settings = useEditor((s) => s.settings);
  const { setSettings, navigate, toast, setProject } = useEditor.getState();
  const [wipe, setWipe] = useState(false);
  const [health, setHealth] = useState<string | null>(null);

  const test = async () => {
    setHealth('Checking…');
    try {
      const r = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/health`, { headers: settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {} });
      const j = await r.json();
      setHealth(r.ok ? `Connected · API v${j.version} · AI provider: ${j.ai_provider ?? 'none'}` : `Error ${r.status}`);
    } catch { setHealth('Could not reach the server (check the URL and CORS settings).'); }
  };

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800 bg-stone-900/60">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <Btn onClick={() => navigate({ page: 'dashboard' })} title="Back"><ArrowLeft size={16} /></Btn>
          <h1 className="font-semibold text-stone-50">Settings</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-5 py-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-400">Defaults for new projects</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Units"><select className={inputCls} value={settings.units} onChange={(e) => setSettings({ units: e.target.value as 'm' | 'ft' })}><option value="m">Metric (m)</option><option value="ft">Imperial (ft-in)</option></select></Field>
            <Field label="Currency symbol"><TextInput defaultValue={settings.currency} maxLength={4} onBlur={(e) => setSettings({ currency: e.target.value || '₹' })} /></Field>
            <Field label="Default wall height (m)"><NumField value={settings.wallHeight} min={2.2} max={8} step={0.05} onCommit={(v) => setSettings({ wallHeight: v })} /></Field>
            <Field label="Default wall thickness (m)"><NumField value={settings.wallThickness} min={0.05} max={0.6} step={0.01} onCommit={(v) => setSettings({ wallThickness: v })} /></Field>
            <Field label="Snap grid (m)" hint="Used by the 2D editor when snapping is on"><NumField value={settings.gridStep} min={0.01} max={1} step={0.01} onCommit={(v) => setSettings({ gridStep: v })} /></Field>
          </div>
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-stone-400"><Server size={14} /> Optional processing server</h2>
          <p className="mb-3 text-sm text-stone-400">Archiform works fully in the browser. Connect the FastAPI backend from this repository for OpenCV blueprint detection, server-side AI providers (API keys stay on the server) and cloud project storage.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Backend URL"><TextInput defaultValue={settings.backendUrl} placeholder="http://localhost:8000" onBlur={(e) => setSettings({ backendUrl: e.target.value.trim() })} /></Field>
            <Field label="API token"><TextInput type="password" defaultValue={settings.apiToken} placeholder="matches API_TOKEN on the server" onBlur={(e) => setSettings({ apiToken: e.target.value.trim() })} /></Field>
          </div>
          <div className="mt-3 flex items-center gap-3"><Btn variant="outline" onClick={() => void test()} disabled={!settings.backendUrl}>Test connection</Btn>{health && <span className="text-xs text-stone-400">{health}</span>}</div>
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-stone-400"><ShieldCheck size={14} /> Privacy & storage</h2>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-stone-400">
            <li>Projects, blueprints and product photos are stored only in this browser's IndexedDB.</li>
            <li>Nothing is uploaded unless you enable the server engine or server AI provider above.</li>
            <li>AI-derived geometry, product approximations and cost estimates are always labelled.</li>
          </ul>
          <Btn variant="danger" onClick={() => setWipe(true)}><Trash2 size={14} /> Delete all local data</Btn>
        </section>
      </main>
      {wipe && <Confirm title="Delete all local data?" body="This permanently removes every project, version, blueprint and setting stored by Archiform in this browser." confirmLabel="Delete everything"
        onConfirm={() => void wipeAll().then(() => { setProject(null); toast('All local data deleted', 'success'); navigate({ page: 'dashboard' }); })} onClose={() => setWipe(false)} />}
    </div>
  );
}
