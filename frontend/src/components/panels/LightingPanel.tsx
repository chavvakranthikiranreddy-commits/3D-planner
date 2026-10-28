import { useEditor } from '../../store/editor';
import { Field, Section } from '../ui';
import type { Lighting } from '../../lib/types';

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
  return (
    <>
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
