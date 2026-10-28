import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Copy, Pencil, Archive, Trash2, FileUp, Home, Settings as Cog, Upload, ArchiveRestore, Building2, Lock } from 'lucide-react';
import { useEditor } from '../store/editor';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from '../lib/db';
import { newProject, sampleProject, uid } from '../lib/templates';
import { parseProjectFile } from '../lib/migrate';
import { Btn, Confirm, Field, Modal, TextInput, inputCls } from '../components/ui';
import type { Project } from '../lib/types';

function NewProjectModal({ onClose, onCreate, mode }: { onClose: () => void; onCreate: (p: Project, thenImport: boolean) => void; mode: 'blank' | 'import' }) {
  const settings = useEditor((s) => s.settings);
  const [name, setName] = useState(mode === 'import' ? 'My home from blueprint' : 'New design');
  const [type, setType] = useState<Project['projectType']>('apartment');
  const [units, setUnits] = useState(settings.units);
  const [floors, setFloors] = useState(1);
  const [ceiling, setCeiling] = useState(settings.wallHeight);
  return (
    <Modal title={mode === 'import' ? 'New project from blueprint' : 'New project'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onCreate(newProject(name.trim() || 'Untitled', { projectType: type, units, floors, ceilingHeight: ceiling, currency: settings.currency }), mode === 'import'); }}>
        <Field label="Project name"><TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as Project['projectType'])}>
              <option value="apartment">Apartment</option><option value="independent-house">Independent house</option><option value="villa">Villa</option>
              <option value="office">Office</option><option value="retail">Retail</option><option value="other">Other</option>
            </select>
          </Field>
          <Field label="Units">
            <select className={inputCls} value={units} onChange={(e) => setUnits(e.target.value as 'm' | 'ft')}>
              <option value="m">Metric (m)</option><option value="ft">Imperial (ft-in)</option>
            </select>
          </Field>
          <Field label="Floors"><input type="number" min={1} max={5} value={floors} onChange={(e) => setFloors(Math.max(1, Math.min(5, +e.target.value)))} className={inputCls} /></Field>
          <Field label="Ceiling height (m)"><input type="number" min={2.2} max={6} step={0.05} value={ceiling} onChange={(e) => setCeiling(+e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit">{mode === 'import' ? 'Continue to upload' : 'Create'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

export default function Dashboard() {
  const { navigate, setProject, toast } = useEditor.getState();
  const [items, setItems] = useState<ProjectMeta[] | null>(null);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<null | 'blank' | 'import'>(null);
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setItems(await listProjects());
  useEffect(() => { void refresh(); }, []);

  const create = async (p: Project, thenImport = false) => {
    await saveProject(p);
    setProject(p);
    navigate(thenImport ? { page: 'import', id: p.id } : { page: 'editor', id: p.id });
  };
  const mutateStored = async (id: string, fn: (p: Project) => void) => {
    const p = await loadProject(id);
    if (!p) return;
    fn(p);
    p.updatedAt = Date.now();
    await saveProject(p);
    await refresh();
  };
  const duplicate = async (id: string) => {
    const p = await loadProject(id);
    if (!p) return;
    const c: Project = { ...structuredClone(p), id: uid(), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(c);
    await refresh();
    toast('Project duplicated', 'success');
  };
  const importFile = async (f: File) => {
    try {
      if (f.size > 60 * 1024 * 1024) throw new Error('Project file is too large.');
      const p = parseProjectFile(await f.text());
      p.id = uid();
      p.updatedAt = Date.now();
      await saveProject(p);
      await refresh();
      toast(`Imported “${p.name}”`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const shown = (items ?? []).filter((p) => (showArchived ? p.status === 'archived' : p.status !== 'archived') && p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800 bg-stone-900/60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-stone-950"><Building2 size={18} /></div>
            <div>
              <div className="font-semibold tracking-tight text-stone-50">Archiform</div>
              <div className="text-[11px] text-stone-500">Blueprint → 3D interior studio</div>
            </div>
          </div>
          <div className="flex-1" />
          <Btn variant="ghost" onClick={() => navigate({ page: 'settings' })}><Cog size={16} /> <span className="hidden sm:inline">Settings</span></Btn>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <section className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => setModal('import')} className="group rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-transparent p-5 text-left hover:border-amber-400">
            <FileUp className="mb-3 text-amber-400" />
            <div className="font-semibold text-stone-50">Start from a blueprint</div>
            <p className="mt-1 text-sm text-stone-400">Upload a PDF, PNG or JPG floor plan, set the scale and review detected walls, doors and rooms.</p>
          </button>
          <button onClick={() => setModal('blank')} className="rounded-xl border border-stone-800 bg-stone-900 p-5 text-left hover:border-stone-600">
            <Plus className="mb-3 text-stone-300" />
            <div className="font-semibold text-stone-50">Blank project</div>
            <p className="mt-1 text-sm text-stone-400">Draw walls and rooms yourself with snapping, ortho assist and exact dimensions.</p>
          </button>
          <button onClick={() => void create(sampleProject())} className="rounded-xl border border-stone-800 bg-stone-900 p-5 text-left hover:border-stone-600">
            <Home className="mb-3 text-stone-300" />
            <div className="font-semibold text-stone-50">Sample 2BHK</div>
            <p className="mt-1 text-sm text-stone-400">A furnished apartment to explore materials, the AI assistant, walkthrough and reports.</p>
          </button>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-semibold text-stone-50">{showArchived ? 'Archived projects' : 'Recent projects'}</h2>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" className={`${inputCls} w-48 pl-7`} />
            </div>
            <Btn variant="outline" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show active' : 'Archived'}</Btn>
            <Btn variant="outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import file</Btn>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { if (e.target.files?.[0]) void importFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {items === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-stone-900" />)}</div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-800 p-10 text-center text-sm text-stone-500">
              {q ? 'No projects match your search.' : showArchived ? 'No archived projects.' : 'No projects yet — start from a blueprint, a blank canvas or the sample above.'}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <article key={p.id} className="group overflow-hidden rounded-xl border border-stone-800 bg-stone-900 hover:border-stone-600">
                  <button className="block aspect-[16/10] w-full bg-stone-800" onClick={() => navigate({ page: 'editor', id: p.id })} aria-label={`Open ${p.name}`}>
                    {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-stone-600"><Building2 size={32} /></div>}
                  </button>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-medium text-stone-100">{p.name}</h3>
                        <p className="text-[11px] text-stone-500">{p.rooms} rooms · {p.walls} walls · {p.versions} versions · {new Date(p.updatedAt).toLocaleDateString()}</p>
                      </div>
                      <span title="Stored privately in this browser" className="text-stone-600"><Lock size={13} /></span>
                    </div>
                    <div className="mt-2 flex gap-0.5 opacity-70 group-hover:opacity-100">
                      <Btn title="Rename" onClick={() => setRenaming(p)}><Pencil size={14} /></Btn>
                      <Btn title="Duplicate" onClick={() => void duplicate(p.id)}><Copy size={14} /></Btn>
                      <Btn title={p.status === 'archived' ? 'Unarchive' : 'Archive'} onClick={() => void mutateStored(p.id, (x) => { x.status = x.status === 'archived' ? 'active' : 'archived'; })}>{p.status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}</Btn>
                      <Btn title="Delete" onClick={() => setDeleting(p)}><Trash2 size={14} /></Btn>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <p className="mt-10 text-center text-xs text-stone-600">Projects are stored privately in this browser (IndexedDB). Export a project file to back it up or move it to another device.</p>
      </main>

      {modal && <NewProjectModal mode={modal} onClose={() => setModal(null)} onCreate={(p, imp) => void create(p, imp)} />}
      {renaming && (
        <Modal title="Rename project" onClose={() => setRenaming(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('n') as string).trim(); if (v) void mutateStored(renaming.id, (x) => { x.name = v; }); setRenaming(null); }}>
            <TextInput name="n" autoFocus defaultValue={renaming.name} />
            <div className="mt-4 flex justify-end gap-2"><Btn variant="outline" onClick={() => setRenaming(null)}>Cancel</Btn><Btn variant="primary" type="submit">Rename</Btn></div>
          </form>
        </Modal>
      )}
      {deleting && <Confirm title="Delete project?" body={`“${deleting.name}” and all of its versions will be permanently deleted from this browser. Export it first if you want a backup.`} onConfirm={() => void deleteProject(deleting.id).then(refresh)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
