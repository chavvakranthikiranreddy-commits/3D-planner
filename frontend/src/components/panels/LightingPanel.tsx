import { useState } from 'react';
import { Columns2, Moon, Sun, Sunset } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { Btn, Field, Section } from '../ui';
import type { LightMode, Lighting } from '../../lib/types';
import { captureFrame, downloadDataUrl, hasViewport } from '../../lib/capture';
import { nextFrames } from '../../lib/panorama';
import { ELEC } from '../../lib/electrical';

/** Render the current view in two lighting modes and put them side by side with labels. */
async function dayNightPair(): Promise<string> {
  const st = useEditor.getState();
  const before = st.project!.scene.lighting.mode ?? 'day';
  const shots: string[] = [];
  try {
    for (const m of ['day', 'night'] as LightMode[]) {
      useEditor.setState((s) => ({ project: s.project && { ...s.project, scene: { ...s.project.scene, lighting: { ...s.project.scene.lighting, mode: m } } } }));
      await nextFrames(4);
      const u = captureFrame(1600, 1000, 'image/jpeg'); if (!u) throw new Error('Open the 3D view first.');
      shots.push(u);
    }
  } finally {
    useEditor.setState((s) => ({ project: s.project && { ...s.project, scene: { ...s.project.scene, lighting: { ...s.project.scene.lighting, mode: before } } } }));
  }
  const imgs = await Promise.all(shots.map((u) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; })));
  const c = document.createElement('canvas'); c.width = 3200; c.height = 1000;
  const ctx = c.getContext('2d')!;
  imgs.forEach((im, i) => ctx.drawImage(im, i * 1600, 0, 1600, 1000));
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(24, 24, 170, 56); ctx.fillRect(1624, 24, 190, 56);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.fillText('Day', 44, 64); ctx.fillText('Night', 1644, 64);
  return c.toDataURL('image/jpeg', 0.92);
}

const PRESETS: { name: string; l: Partial<Lighting> }[] = [
  { name: 'Morning', l: { sunAzimuth: 90, sunElevation: 25, sunIntensity: 2.0, warmth: 0.6, ambient: 0.5 } },
  { name: 'Noon', l: { sunAzimuth: 180, sunElevation: 70, sunIntensity: 2.6, warmth: 0.35, ambient: 0.6 } },
  { name: 'Golden hour', l: { sunAzimuth: 260, sunElevation: 12, sunIntensity: 1.8, warmth: 0.9, ambient: 0.4 } },
  { name: 'Evening', l: { sunAzimuth: 280, sunElevation: 4, sunIntensity: 0.4, warmth: 0.8, ambient: 0.25, roomLights: true } },
];

export default function LightingPanel() {
  const L = useEditor((s) => s.project!.scene.lighting);
  const mutate = useEditor((s) => s.mutate);
  const set = (k: keyof Lighting, v: number | boolean) => mutate((s) => { (s.lighting as unknown as Record<string, unknown>)[k] = v; }, 'light:' + k);
  const slider = (k: keyof Lighting, label: string, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => (
    <Field label={`${label} · ${fmt(L[k] as number)}`}>
      <input type="range" min={min} max={max} step={step} value={L[k] as number} onChange={(e) => set(k, +e.target.value)} className="w-full accent-amber-500" />
    </Field>
  );
  const mode = L.mode ?? 'day';
  const fixtures = useEditor((s) => (s.project?.scene.electrical ?? []).filter((e) => ELEC[e.kind].light).length);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Section title="Day & night views">
        <div className="grid grid-cols-3 gap-1.5">
          {([['day', Sun, 'Daylight'], ['evening', Sunset, 'Evening'], ['night', Moon, 'Night']] as const).map(([m, I, label]) => (
            <button key={m} onClick={() => mutate((s) => { s.lighting = { ...s.lighting, mode: m }; }, 'light:mode')}
              className={`flex flex-col items-center gap-1 rounded-md border py-2 text-xs ${mode === m ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-stone-700 text-stone-300 hover:border-stone-500'}`}><I size={16} />{label}</button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-stone-400">{mode === 'day' ? 'Sunlight from the sliders below.' : mode === 'evening' ? 'Low warm sun plus your room lights.' : 'Artificial light only — ceiling lights, cove LEDs, spotlights and planned fixtures.'} {mode !== 'day' && (fixtures ? `${fixtures} planned light fitting(s) set room brightness.` : 'Plan light points in “Electrical & lighting” to control brightness per room.')}</p>
        <Btn variant="outline" className="mt-2 w-full" disabled={busy} onClick={async () => {
          if (!hasViewport()) { useEditor.getState().toast('Open the 3D or walk view first.', 'info'); return; }
          setBusy(true);
          try { downloadDataUrl(await dayNightPair(), 'day-vs-night.jpg'); } catch (e) { useEditor.getState().toast((e as Error).message, 'error'); } finally { setBusy(false); }
        }}><Columns2 size={14} /> {busy ? 'Rendering…' : 'Download day vs night image'}</Btn>
      </Section>
      <Section title="Time of day">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => <button key={p.name} onClick={() => mutate((s) => { s.lighting = { ...s.lighting, ...p.l }; })} className="rounded-md border border-stone-700 py-1.5 text-xs text-stone-200 hover:border-amber-500">{p.name}</button>)}
        </div>
      </Section>
      <Section title="Real-time lighting">
        <div className="space-y-3">
          {slider('sunIntensity', 'Sun intensity', 0, 5, 0.05)}
          {slider('sunAzimuth', 'Sun direction', 0, 360, 1, (v) => `${v.toFixed(0)}°`)}
          {slider('sunElevation', 'Sun height', 1, 89, 1, (v) => `${v.toFixed(0)}°`)}
          {slider('ambient', 'Ambient fill', 0, 1.5, 0.05)}
          {slider('warmth', 'Colour temperature (cool → warm)', 0, 1, 0.05)}
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="checkbox" checked={L.roomLights} onChange={(e) => set('roomLights', e.target.checked)} className="accent-amber-500" />
            Ceiling lights (walkthrough & low sun)
          </label>
        </div>
      </Section>
    </>
  );
}
