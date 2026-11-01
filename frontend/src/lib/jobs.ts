import { useEditor } from '../store/editor';
import type { Job } from './types';

/**
 * Client-side job runner with queued → running → succeeded/failed/cancelled states, progress,
 * cancel and retry. Each job is bound to the project that started it: results are ignored if the
 * user switches project or cancels, and the AbortSignal is passed to all async work (fetch, etc.).
 */
type Work = (progress: (p: number) => void, signal: AbortSignal) => Promise<string | void>;
interface Entry { type: Job['type']; label: string; work: Work; ctrl: AbortController; projectId: string | null; onDone?: (r: string | void) => void }
const registry = new Map<string, Entry>();

const tick = () => new Promise((r) => setTimeout(r, 30));

export class JobCancelled extends Error { constructor() { super('Cancelled'); } }
/** Throw if the job was cancelled or the user moved to another project — call before side effects. */
export function ensureActive(signal: AbortSignal, projectId: string | null) {
  if (signal.aborted) throw new JobCancelled();
  if (projectId && useEditor.getState().project?.id !== projectId) throw new Error('The project was closed before this finished.');
}

export function runJob(type: Job['type'], label: string, work: Work, onDone?: (r: string | void) => void): string {
  const { addJob, project } = useEditor.getState();
  const id = addJob({ type, label });
  start(id, { type, label, work, ctrl: new AbortController(), onDone, projectId: project?.id ?? null });
  return id;
}

function start(id: string, entry: Entry) {
  registry.set(id, entry);
  const { updateJob } = useEditor.getState();
  (async () => {
    await tick();
    if (entry.ctrl.signal.aborted) return;
    updateJob(id, { status: 'running', progress: 0.02, error: undefined });
    try {
      const result = await entry.work((p) => { if (!entry.ctrl.signal.aborted) updateJob(id, { progress: Math.max(0, Math.min(1, p)) }); }, entry.ctrl.signal);
      ensureActive(entry.ctrl.signal, entry.projectId);
      updateJob(id, { status: 'succeeded', progress: 1, result: typeof result === 'string' ? result : undefined });
      entry.onDone?.(result);
      registry.delete(id); // release the closure; successful jobs are not retried
    } catch (e) {
      if (entry.ctrl.signal.aborted || e instanceof JobCancelled || (e as Error)?.name === 'AbortError') return;
      updateJob(id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  })();
}

export function cancelJob(id: string) {
  const e = registry.get(id);
  e?.ctrl.abort();
  registry.delete(id);
  useEditor.getState().updateJob(id, { status: 'cancelled' });
}

export function retryJob(id: string) {
  const e = registry.get(id);
  if (!e) return;
  useEditor.getState().updateJob(id, { status: 'queued', progress: 0, error: undefined });
  start(id, { ...e, ctrl: new AbortController(), projectId: useEditor.getState().project?.id ?? null });
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
