import { create } from 'zustand';
import type { Job, Project, Scene, Selection } from '../lib/types';
import { saveProject, loadProject, type Settings, DEFAULT_SETTINGS, saveSettings } from '../lib/db';
import { uid } from '../lib/templates';

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'pan' | 'calibrate';
export type View = '2d' | '3d' | 'split' | 'walk';
export type RightTab = 'properties' | 'materials' | 'catalog' | 'product' | 'ai' | 'lighting' | 'versions' | 'export';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type Route = { page: 'dashboard' } | { page: 'editor'; id: string } | { page: 'settings' } | { page: 'import'; id: string };

interface Toast { id: string; text: string; tone: 'info' | 'error' | 'success' }

interface State {
  route: Route;
  settings: Settings;
  project: Project | null;
  selection: Selection;
  tool: Tool;
  view: View;
  activeFloorId: string;
  showBlueprint: boolean;
  gridSnap: boolean;
  camPreset: { name: 'perspective' | 'dollhouse' | 'top' | 'front'; n: number };
  rightTab: RightTab;
  past: Scene[];
  future: Scene[];
  saveState: SaveState;
  jobs: Job[];
  toasts: Toast[];
  lastCoalesce: { key: string; t: number } | null;

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
  setRightTab: (t: RightTab) => void;
  setActiveFloor: (id: string) => void;
  toggle: (k: 'showBlueprint' | 'gridSnap') => void;
  addJob: (j: Omit<Job, 'id' | 'createdAt' | 'status' | 'progress'> & Partial<Job>) => string;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  flushSave: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const HISTORY_LIMIT = 120;

export const useEditor = create<State>((set, get) => {
  const scheduleSave = () => {
    set({ saveState: 'unsaved' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flushSave(), 700);
  };

  return {
    route: { page: 'dashboard' },
    settings: DEFAULT_SETTINGS,
    project: null,
    selection: null,
    tool: 'select',
    view: 'split',
    activeFloorId: 'f0',
    showBlueprint: true,
    gridSnap: true,
    camPreset: { name: 'dollhouse', n: 0 },
    rightTab: 'properties',
    past: [],
    future: [],
    saveState: 'saved',
    jobs: [],
    toasts: [],
    lastCoalesce: null,

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
      const cur = get().project;
      if (cur?.id === id) return true;
      const p = await loadProject(id);
      if (!p) return false;
      set({ project: p, past: [], future: [], selection: null, activeFloorId: p.scene.floors[0]?.id ?? 'f0', saveState: 'saved', tool: 'select' });
      return true;
    },
    setProject: (p) => set({ project: p, past: [], future: [], selection: null, activeFloorId: p?.scene.floors[0]?.id ?? 'f0' }),
    updateProject: (fn) => {
      const p = get().project;
      if (!p) return;
      const np = { ...p, versions: [...p.versions] };
      fn(np);
      np.updatedAt = Date.now();
      set({ project: np });
      scheduleSave();
    },
    mutate: (fn, coalesceKey) => {
      const p = get().project;
      if (!p) return;
      const next = structuredClone(p.scene);
      fn(next);
      const now = Date.now();
      const lc = get().lastCoalesce;
      const coalesce = coalesceKey && lc && lc.key === coalesceKey && now - lc.t < 1500;
      const past = coalesce ? get().past : [...get().past, p.scene].slice(-HISTORY_LIMIT);
      set({ project: { ...p, scene: next, updatedAt: now }, past, future: [], lastCoalesce: coalesceKey ? { key: coalesceKey, t: now } : null });
      scheduleSave();
    },
    undo: () => {
      const { past, project, future } = get();
      if (!project || past.length === 0) return;
      const prev = past[past.length - 1];
      set({ project: { ...project, scene: prev }, past: past.slice(0, -1), future: [project.scene, ...future], lastCoalesce: null });
      scheduleSave();
    },
    redo: () => {
      const { past, project, future } = get();
      if (!project || future.length === 0) return;
      const [nxt, ...rest] = future;
      set({ project: { ...project, scene: nxt }, past: [...past, project.scene], future: rest, lastCoalesce: null });
      scheduleSave();
    },
    select: (selection) => {
      set({ selection });
      if (selection && get().rightTab !== 'materials') set({ rightTab: 'properties' });
    },
    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : null }),
    setView: (view) => set({ view }),
    setCamPreset: (name) => set({ camPreset: { name, n: get().camPreset.n + 1 } }),
    setRightTab: (rightTab) => set({ rightTab }),
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
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3800);
    },
    flushSave: async () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      const p = get().project;
      if (!p || get().saveState === 'saved') return;
      set({ saveState: 'saving' });
      try {
        await saveProject(p);
        set({ saveState: 'saved' });
      } catch (e) {
        console.error(e);
        set({ saveState: 'error' });
        get().toast('Autosave failed — your browser storage may be full. Export the project to keep a copy.', 'error');
      }
    },
  };
});

/** Convenience selectors */
export const useScene = () => useEditor((s) => s.project?.scene);
export const useUnits = () => useEditor((s) => s.project?.units ?? s.settings.units);
