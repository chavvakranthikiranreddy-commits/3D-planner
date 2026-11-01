import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { ElecKind, Job, Project, Scene, Selection } from '../lib/types';
import { saveProject, loadProject, type Settings, DEFAULT_SETTINGS, saveSettings } from '../lib/db';
import { uid } from '../lib/templates';
import { normalizeSceneOpenings } from '../lib/geometry';
import type { ChatMsg } from '../components/panels/ChatPanel';

setAutoFreeze(false);

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'pan' | 'calibrate' | 'electric';
export type View = '2d' | '3d' | 'split' | 'walk';
export type RightTab = 'chat' | 'properties' | 'materials' | 'style' | 'electrical' | 'catalog' | 'product' | 'ai' | 'lighting' | 'versions' | 'export';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type MaterialTarget = 'floor' | 'room-walls' | 'ceiling';
export type Route = { page: 'dashboard' } | { page: 'editor'; id: string } | { page: 'settings' } | { page: 'import'; id: string } | { page: 'photos'; id: string };

interface Toast { id: string; text: string; tone: 'info' | 'error' | 'success' }

interface State {
  route: Route;
  settings: Settings;
  project: Project | null;
  /** Monotonic edit counter for the open project; `savedRev` is the newest revision known to be on disk. */
  rev: number;
  savedRev: number;
  selection: Selection;
  tool: Tool;
  view: View;
  activeFloorId: string;
  showBlueprint: boolean;
  gridSnap: boolean;
  camPreset: { name: 'perspective' | 'dollhouse' | 'top' | 'front'; n: number };
  rightTab: RightTab;
  materialTarget: MaterialTarget;
  chat: ChatMsg[];
  past: Scene[];
  future: Scene[];
  saveState: SaveState;
  jobs: Job[];
  toasts: Toast[];
  lastCoalesce: { key: string; t: number } | null;
  showGuide: boolean;
  showElectrical: boolean;
  elecKind: ElecKind;
  setElecKind: (k: ElecKind) => void;

  navigate: (r: Route) => void;
  setSettings: (s: Partial<Settings>) => void;
  openProject: (id: string) => Promise<boolean>;
  setProject: (p: Project | null) => void;
  updateProject: (fn: (p: Project) => void) => void;
  mutate: (fn: (s: Scene) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setView: (v: View) => void;
  setCamPreset: (n: State['camPreset']['name']) => void;
  setRightTab: (t: RightTab, target?: MaterialTarget) => void;
  setActiveFloor: (id: string) => void;
  toggle: (k: 'showBlueprint' | 'gridSnap' | 'showGuide' | 'showElectrical') => void;
  addJob: (j: Omit<Job, 'id' | 'createdAt' | 'status' | 'progress'> & Partial<Job>) => string;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  /** Persist the newest revision. Resolves once the revision current at call time (or newer) is on disk. */
  flushSave: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
const HISTORY_LIMIT = 120;

export const useEditor = create<State>((set, get) => {
  const touched = () => {
    set({ rev: get().rev + 1, saveState: 'unsaved' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flushSave(), 700);
  };

  /** One write at a time; after each write, re-check whether a newer revision appeared meanwhile. */
  const writeLoop = async () => {
    for (;;) {
      const { project, rev, savedRev } = get();
      if (!project || rev === savedRev) { if (get().saveState !== 'error') set({ saveState: 'saved' }); return; }
      const snapshot = project;
      const id = project.id;
      set({ saveState: 'saving' });
      try {
        await saveProject(snapshot);
      } catch (e) {
        console.error(e);
        if (get().project?.id === id) set({ saveState: 'error' });
        get().toast('Saving failed — your browser storage may be full. Use Render & export → Export project file to keep a copy.', 'error');
        return;
      }
      // guard against a project switch during the await
      if (get().project?.id !== id) return;
      set({ savedRev: rev });
    }
  };

  return {
    route: { page: 'dashboard' },
    settings: DEFAULT_SETTINGS,
    project: null,
    rev: 0,
    savedRev: 0,
    selection: null,
    tool: 'select',
    view: 'split',
    activeFloorId: 'f0',
    showBlueprint: true,
    gridSnap: true,
    camPreset: { name: 'dollhouse', n: 0 },
    rightTab: 'chat',
    materialTarget: 'floor',
    chat: [],
    past: [],
    future: [],
    saveState: 'saved',
    jobs: [],
    toasts: [],
    lastCoalesce: null,
    showGuide: true,
    showElectrical: true,
    elecKind: 'switchboard',
    setElecKind: (k) => set({ elecKind: k, tool: 'electric', showElectrical: true }),

    navigate: (route) => {
      void get().flushSave();
      set({ route });
      const hash = route.page === 'dashboard' ? '#/' : route.page === 'settings' ? '#/settings' : `#/${route.page}/${route.id}`;
      if (location.hash !== hash) history.pushState(null, '', hash);
    },
    setSettings: (s) => {
      const settings = { ...get().settings, ...s };
      set({ settings });
      void saveSettings(settings);
    },
    openProject: async (id) => {
      // finish any pending write of the current project before reading from storage
      await get().flushSave();
      const cur = get().project;
      const p = await loadProject(id);
      if (!p) return false;
      // keep in-memory state (and undo history) only if storage has not changed underneath it
      if (cur?.id === id && cur.updatedAt === p.updatedAt) return true;
      set({ project: p, rev: 0, savedRev: 0, past: [], future: [], selection: null, activeFloorId: p.scene.floors[0]?.id ?? 'f0', saveState: 'saved', tool: 'select', chat: [], lastCoalesce: null });
      return true;
    },
    setProject: (p) => set({ project: p, rev: 0, savedRev: 0, past: [], future: [], selection: null, chat: [], saveState: 'saved', activeFloorId: p?.scene.floors[0]?.id ?? 'f0' }),
    updateProject: (fn) => {
      const p = get().project;
      if (!p) return;
      const np = produce(p, (d) => { fn(d as Project); d.updatedAt = Date.now(); });
      set({ project: np });
      touched();
    },
    mutate: (fn, coalesceKey) => {
      const p = get().project;
      if (!p) return;
      const next = produce(p.scene, (d) => { fn(d as Scene); normalizeSceneOpenings(d as Scene); });
      if (next === p.scene) return;
      const now = Date.now();
      const lc = get().lastCoalesce;
      const coalesce = coalesceKey && lc && lc.key === coalesceKey && now - lc.t < 1500;
      const past = coalesce ? get().past : [...get().past, p.scene].slice(-HISTORY_LIMIT);
      set({ project: { ...p, scene: next, updatedAt: now }, past, future: [], lastCoalesce: coalesceKey ? { key: coalesceKey, t: now } : null });
      touched();
    },
    undo: () => {
      const { past, project, future } = get();
      if (!project || past.length === 0) return;
      const prev = past[past.length - 1];
      set({ project: { ...project, scene: prev, updatedAt: Date.now() }, past: past.slice(0, -1), future: [project.scene, ...future], lastCoalesce: null });
      touched();
    },
    redo: () => {
      const { past, project, future } = get();
      if (!project || future.length === 0) return;
      const [nxt, ...rest] = future;
      set({ project: { ...project, scene: nxt, updatedAt: Date.now() }, past: [...past, project.scene], future: rest, lastCoalesce: null });
      touched();
    },
    select: (selection) => {
      set({ selection });
      if (selection && !['materials', 'chat', 'electrical', 'style'].includes(get().rightTab)) set({ rightTab: 'properties' });
    },
    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : null }),
    setView: (view) => set({ view }),
    setCamPreset: (name) => set({ camPreset: { name, n: get().camPreset.n + 1 } }),
    setRightTab: (rightTab, target) => set(target ? { rightTab, materialTarget: target } : { rightTab }),
    setActiveFloor: (activeFloorId) => set({ activeFloorId, selection: null }),
    toggle: (k) => set({ [k]: !get()[k] } as Pick<State, typeof k>),
    addJob: (j) => {
      const id = uid();
      set({ jobs: [{ id, createdAt: Date.now(), status: 'queued', progress: 0, ...j } as Job, ...get().jobs].slice(0, 30) });
      return id;
    },
    updateJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
    removeJob: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
    toast: (text, tone = 'info') => {
      const id = uid();
      set({ toasts: [...get().toasts, { id, text, tone }] });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200);
    },
    flushSave: async () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      // serialise: wait for an in-flight write, then run the loop (which picks up the newest revision)
      while (saving) await saving;
      if (get().rev === get().savedRev) { if (get().saveState === 'unsaved' || get().saveState === 'saving') set({ saveState: 'saved' }); return; }
      saving = writeLoop().finally(() => { saving = null; });
      await saving;
    },
  };
});

/** Convenience selectors */
export const useScene = () => useEditor((s) => s.project?.scene);
export const useUnits = () => useEditor((s) => s.project?.units ?? s.settings.units);
/** Blueprint underlay for a floor, resolved from project assets. */
export function blueprintFor(p: Project | null, floorId: string) {
  const ref = p?.scene.blueprints?.[floorId];
  if (!p || !ref) return undefined;
  const dataUrl = p.assets[ref.assetId];
  return dataUrl ? { ...ref, dataUrl } : undefined;
}
