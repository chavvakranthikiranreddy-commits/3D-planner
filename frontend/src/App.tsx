import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useEditor, type Route } from './store/editor';
import { loadSettings } from './lib/db';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import ImportWizard from './pages/ImportWizard';
import Settings from './pages/Settings';
import { Btn } from './components/ui';

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('/');
  if ((page === 'editor' || page === 'import') && id) return { page, id };
  if (page === 'settings') return { page: 'settings' };
  return { page: 'dashboard' };
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-xl ${t.tone === 'error' ? 'bg-red-600 text-white' : t.tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-stone-100'}`}>{t.text}</div>
      ))}
    </div>
  );
}

export default function App() {
  const route = useEditor((s) => s.route);
  const project = useEditor((s) => s.project);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => { useEditor.setState({ settings: s }); setReady(true); });
    const sync = () => useEditor.setState({ route: parseHash() });
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().saveState !== 'saved') { void useEditor.getState().flushSave(); e.preventDefault(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);

  useEffect(() => {
    if (route.page !== 'editor' && route.page !== 'import') return;
    setMissing(false);
    void useEditor.getState().openProject(route.id).then((ok) => setMissing(!ok));
  }, [route]);

  let body: React.ReactNode;
  if (!ready) body = null;
  else if (route.page === 'dashboard') body = <Dashboard />;
  else if (route.page === 'settings') body = <Settings />;
  else if (missing) body = (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-stone-950 text-stone-300">
      <p>This project was not found in this browser.</p>
      <Btn variant="primary" onClick={() => useEditor.getState().navigate({ page: 'dashboard' })}>Back to projects</Btn>
    </div>
  );
  else if (!project || project.id !== route.id) body = <div className="flex h-dvh items-center justify-center bg-stone-950 text-stone-500"><Loader2 className="animate-spin" /></div>;
  else body = route.page === 'import' ? <ImportWizard /> : <Editor />;

  return <>{body}<Toasts /></>;
}
