import { useEditor } from '../store/editor';
import type { Job } from './types';

/**
 * Client-side job runner with queued → running → succeeded/failed/cancelled states,
 * progress, cancel and retry. Long work (render, detection, AI) never blocks editing.
 */
type Work = (progress: (p: number) => void, signal: AbortSignal) => Promise<string | void>;
const registry = new Map<string, { type: Job['type']; label: string; work: Work; ctrl: AbortController; onDone?: (r: string | void) => void }>();

const tick = () => new Promise((r) => setTimeout(r, 30));

export function runJob(type: Job['type'], label: string, work: Work, onDone?: (r: string | void) => void): string {
  const { addJob } = useEditor.getState();
  const id = addJob({ type, label });
  start(id, { type, label, work, ctrl: new AbortController(), onDone });
  return id;
}

function start(id: string, entry: { type: Job['type']; label: string; work: Work; ctrl: AbortController; onDone?: (r: string | void) => void }) {
  registry.set(id, entry);
  const { updateJob } = useEditor.getState();
  (async () => {
    await tick();
    if (entry.ctrl.signal.aborted) return;
    updateJob(id, { status: 'running', progress: 0.02, error: undefined });
    try {
      const result = await entry.work((p) => updateJob(id, { progress: Math.max(0, Math.min(1, p)) }), entry.ctrl.signal);
      if (entry.ctrl.signal.aborted) return;
      updateJob(id, { status: 'succeeded', progress: 1, result: typeof result === 'string' ? result : undefined });
      entry.onDone?.(result);
    } catch (e) {
      if (entry.ctrl.signal.aborted) return;
      updateJob(id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  })();
}

export function cancelJob(id: string) {
  const e = registry.get(id);
  e?.ctrl.abort();
  useEditor.getState().updateJob(id, { status: 'cancelled' });
}

export function retryJob(id: string) {
  const e = registry.get(id);
  if (!e) return;
  start(id, { ...e, ctrl: new AbortController() });
  useEditor.getState().updateJob(id, { status: 'queued', progress: 0, error: undefined });
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
