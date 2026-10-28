import { lazy, Suspense, useEffect, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, MousePointer2, PenLine, Square, DoorOpen, AppWindow, Hand, Ruler, Magnet, Check, Loader2, AlertCircle,
  SlidersHorizontal, Palette, Sofa, ImagePlus, Sparkles, Sun, History, Share, PanelLeft, PanelRight, Keyboard, FileUp, Grid2x2, Box, Columns2, Footprints,
} from 'lucide-react';
import { useEditor, type RightTab, type Tool, type View } from '../store/editor';
import Plan2D from '../components/Plan2D';
import LeftPanel from '../components/LeftPanel';
import PropertiesPanel from '../components/panels/PropertiesPanel';
import MaterialsPanel from '../components/panels/MaterialsPanel';
import CatalogPanel from '../components/panels/CatalogPanel';
import ProductPanel from '../components/panels/ProductPanel';
import AIPanel from '../components/panels/AIPanel';
import LightingPanel from '../components/panels/LightingPanel';
import VersionsPanel from '../components/panels/VersionsPanel';
import ExportPanel from '../components/panels/ExportPanel';
import { Btn, Modal } from '../components/ui';
import { uid } from '../lib/templates';
import { thumbnail } from '../lib/capture';

const Viewport3D = lazy(() => import('../three/Viewport3D'));

const TOOLS: { id: Tool; icon: typeof PenLine; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select & move', key: 'V' },
  { id: 'wall', icon: PenLine, label: 'Draw walls', key: 'W' },
  { id: 'room', icon: Square, label: 'Outline room', key: 'R' },
  { id: 'door', icon: DoorOpen, label: 'Place door', key: 'D' },
  { id: 'window', icon: AppWindow, label: 'Place window', key: 'N' },
  { id: 'pan', icon: Hand, label: 'Pan', key: 'H' },
];
const VIEWS: { id: View; icon: typeof Grid2x2; label: string }[] = [
  { id: '2d', icon: Grid2x2, label: '2D plan' }, { id: 'split', icon: Columns2, label: 'Split' }, { id: '3d', icon: Box, label: '3D' }, { id: 'walk', icon: Footprints, label: 'Walk' },
];
const TABS: { id: RightTab; icon: typeof Palette; label: string }[] = [
  { id: 'properties', icon: SlidersHorizontal, label: 'Properties' }, { id: 'materials', icon: Palette, label: 'Materials & colour' },
  { id: 'catalog', icon: Sofa, label: 'Catalog' }, { id: 'product', icon: ImagePlus, label: 'Product image' },
  { id: 'ai', icon: Sparkles, label: 'AI assistant' }, { id: 'lighting', icon: Sun, label: 'Lighting' },
  { id: 'versions', icon: History, label: 'Versions' }, { id: 'export', icon: Share, label: 'Render & export' },
];

function SaveIndicator() {
  const st = useEditor((s) => s.saveState);
  const map = {
    saved: [<Check key="i" size={13} />, 'Saved', 'text-emerald-400'],
    saving: [<Loader2 key="i" size={13} className="animate-spin" />, 'Saving…', 'text-stone-400'],
    unsaved: [<Loader2 key="i" size={13} className="animate-spin" />, 'Unsaved', 'text-stone-400'],
    error: [<AlertCircle key="i" size={13} />, 'Save failed', 'text-red-400'],
  } as const;
  const [icon, label, cls] = map[st];
  return <span className={`hidden items-center gap-1 text-xs sm:flex ${cls}`} role="status" aria-live="polite">{icon}{label}</span>;
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows = [
    ['V / W / R / D / N / H', 'Select · Wall · Room · Door · Window · Pan'], ['1 2 3 4', '2D · Split · 3D · Walkthrough'], ['G', 'Toggle snapping'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Delete', 'Delete selection'], ['Ctrl+D', 'Duplicate item'], ['Q / E', 'Rotate item ±15°'],
    ['Arrow keys', 'Nudge item 5 cm (Shift: 50 cm)'], ['Esc', 'Finish drawing / clear selection'], ['Enter / double-click', 'Finish wall chain or close room'],
    ['Alt + drag / middle mouse', 'Pan the plan'], ['Mouse wheel', 'Zoom the plan'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-sm"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-b border-stone-800"><td className="py-1.5 pr-3 font-mono text-xs text-amber-300">{k}</td><td className="text-stone-300">{v}</td></tr>)}</tbody></table>
    </Modal>
  );
}

export default function Editor() {
  const project = useEditor((s) => s.project);
  const { tool, view, rightTab, gridSnap, past, future, selection } = useEditor();
  const { setTool, setView, setRightTab, toggle, undo, redo, navigate, mutate, select, updateProject, flushSave, toast } = useEditor.getState();
  const [showLeft, setShowLeft] = useState(() => window.innerWidth >= 1024);
  const [showRight, setShowRight] = useState(() => window.innerWidth >= 768);
  const [help, setHelp] = useState(false);

  useEffect(() => { if (window.innerWidth < 768) setView('3d'); }, [setView]);

  // keep a dashboard thumbnail fresh
  useEffect(() => {
    const t = setInterval(() => {
      const th = thumbnail();
      if (th) updateProject((p) => { p.thumbnail = th; });
    }, 60000);
    return () => clearInterval(t);
  }, [updateProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const st = useEditor.getState();
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave().then(() => toast('Saved', 'success')); return; }
      if (mod && e.key.toLowerCase() === 'd' && st.selection?.kind === 'object') {
        e.preventDefault();
        const o = st.project!.scene.objects.find((x) => x.id === st.selection!.id);
        if (o) { const nid = uid(); mutate((s) => { s.objects.push({ ...structuredClone(o), id: nid, x: o.x + 0.3, y: o.y + 0.3 }); }); select({ kind: 'object', id: nid }); }
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection) {
        const sel = st.selection;
        mutate((s) => {
          if (sel.kind === 'object') s.objects = s.objects.filter((o) => o.id !== sel.id);
          if (sel.kind === 'room') s.rooms = s.rooms.filter((o) => o.id !== sel.id);
          if (sel.kind === 'opening') s.openings = s.openings.filter((o) => o.id !== sel.id);
          if (sel.kind === 'wall') { s.walls = s.walls.filter((o) => o.id !== sel.id); s.openings = s.openings.filter((o) => o.wallId !== sel.id); }
        });
        select(null);
        return;
      }
      if (st.selection?.kind === 'object') {
        const id = st.selection.id;
        const step = e.shiftKey ? 0.5 : 0.05;
        const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (nudge[e.key] && st.view !== 'walk') {
          e.preventDefault();
          mutate((s) => { const o = s.objects.find((x) => x.id === id); if (o) { o.x += nudge[e.key][0]; o.y += nudge[e.key][1]; } }, 'nudge:' + id);
          return;
        }
        if (e.key === 'q' || e.key === 'e') {
          mutate((s) => { const o = s.objects.find((x) => x.id === id); if (o) o.rotation += (e.key === 'q' ? 1 : -1) * Math.PI / 12; }, 'rot:' + id);
          return;
        }
      }
      if (st.view === 'walk' && ['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) return;
      const k = e.key.toLowerCase();
      const toolKey = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (toolKey) { setTool(toolKey.id); if (st.view === '3d' || st.view === 'walk') setView('split'); return; }
      if (k === 'g') toggle('gridSnap');
      if (k === 'escape') select(null);
      if (k === '?') setHelp(true);
      const vi = ['1', '2', '3', '4'].indexOf(e.key);
      if (vi >= 0) setView(VIEWS[vi].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, mutate, select, setTool, setView, toggle, flushSave, toast]);

  if (!project) return null;
  const hasBp = !!project.blueprint;

  const panel = {
    properties: <PropertiesPanel />, materials: <MaterialsPanel />, catalog: <CatalogPanel />, product: <ProductPanel />,
    ai: <AIPanel />, lighting: <LightingPanel />, versions: <VersionsPanel />, export: <ExportPanel />,
  }[rightTab];

  const show2d = view === '2d' || view === 'split';
  const show3d = view === '3d' || view === 'split' || view === 'walk';

  return (
    <div className="flex h-dvh flex-col bg-stone-950 text-stone-200">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-stone-800 bg-stone-900 px-2">
        <Btn title="Back to projects" onClick={() => navigate({ page: 'dashboard' })}><ArrowLeft size={16} /></Btn>
        <Btn title="Toggle layers panel" onClick={() => setShowLeft(!showLeft)} active={showLeft} className="hidden md:inline-flex"><PanelLeft size={16} /></Btn>
        <div className="mx-1 min-w-0 max-w-[30vw]">
          <div className="truncate text-sm font-semibold text-stone-100">{project.name}</div>
        </div>
        <SaveIndicator />
        <div className="mx-2 h-6 w-px bg-stone-800" />
        <Btn title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 size={16} /></Btn>
        <Btn title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length}><Redo2 size={16} /></Btn>
        <div className="mx-2 hidden h-6 w-px bg-stone-800 sm:block" />
        <div className="hidden items-center gap-0.5 sm:flex">
          {TOOLS.map((t) => (
            <Btn key={t.id} title={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => { setTool(t.id); if (view === '3d' || view === 'walk') setView('split'); }}><t.icon size={16} /></Btn>
          ))}
          {hasBp && <Btn title="Calibrate blueprint scale" active={tool === 'calibrate'} onClick={() => { setTool('calibrate'); if (view !== '2d') setView('split'); }}><Ruler size={16} /></Btn>}
          <Btn title="Snapping (G)" active={gridSnap} onClick={() => toggle('gridSnap')}><Magnet size={16} /></Btn>
        </div>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-stone-700">
          {VIEWS.map((v, i) => (
            <button key={v.id} title={`${v.label} (${i + 1})`} aria-label={v.label} onClick={() => setView(v.id)}
              className={`flex items-center gap-1 px-2 py-1 text-xs ${view === v.id ? 'bg-amber-500 text-stone-950' : 'text-stone-300 hover:bg-stone-800'} ${v.id === 'split' ? 'hidden md:flex' : 'flex'}`}>
              <v.icon size={14} /><span className="hidden xl:inline">{v.label}</span>
            </button>
          ))}
        </div>
        <Btn title="Import blueprint" onClick={() => navigate({ page: 'import', id: project.id })} className="hidden md:inline-flex"><FileUp size={16} /></Btn>
        <Btn title="Keyboard shortcuts (?)" onClick={() => setHelp(true)} className="hidden md:inline-flex"><Keyboard size={16} /></Btn>
        <Btn title="Toggle side panel" onClick={() => setShowRight(!showRight)} active={showRight}><PanelRight size={16} /></Btn>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {showLeft && <aside className="hidden w-60 shrink-0 border-r border-stone-800 bg-stone-900 md:block">{<LeftPanel />}</aside>}
        <main className="flex min-w-0 flex-1">
          {show2d && <div className={`relative min-w-0 ${view === 'split' ? 'w-1/2 border-r border-stone-800' : 'flex-1'}`}><Plan2D /></div>}
          {show3d && (
            <div className="relative min-w-0 flex-1 bg-stone-900">
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-stone-500"><Loader2 className="mr-2 animate-spin" size={16} /> Loading 3D engine…</div>}>
                <Viewport3D key={view === 'walk' ? 'walk' : 'orbit'} walk={view === 'walk'} />
              </Suspense>
            </div>
          )}
        </main>
        {showRight && (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-[92vw] shrink-0 border-l border-stone-800 bg-stone-900 shadow-2xl md:static md:shadow-none">
            <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-stone-800 py-2" aria-label="Panels">
              {TABS.map((t) => (
                <button key={t.id} title={t.label} aria-label={t.label} onClick={() => setRightTab(t.id)}
                  className={`rounded-md p-2 ${rightTab === t.id ? 'bg-amber-500 text-stone-950' : 'text-stone-400 hover:bg-stone-800 hover:text-white'}`}>
                  <t.icon size={17} />
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-stone-800 bg-stone-900 px-4 py-2.5 text-sm font-semibold text-stone-100">{TABS.find((t) => t.id === rightTab)?.label}
                {selection && rightTab === 'properties' && <span className="ml-2 text-xs font-normal capitalize text-stone-500">{selection.kind}</span>}
              </div>
              {panel}
            </div>
          </aside>
        )}
        {/* mobile tool strip */}
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-full bg-stone-900/95 p-1 shadow-lg sm:hidden">
          {TOOLS.slice(0, 5).map((t) => (
            <button key={t.id} aria-label={t.label} onClick={() => { setTool(t.id); setView('2d'); }} className={`rounded-full p-2 ${tool === t.id ? 'bg-amber-500 text-stone-950' : 'text-stone-300'}`}><t.icon size={16} /></button>
          ))}
        </div>
      </div>
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}
