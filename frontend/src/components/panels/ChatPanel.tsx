import { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, X, Undo2, Loader2, ImageIcon } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { HELP, runCommand, type ChatImage, type ChatOutcome } from '../../lib/chat';
import { extractPalette, loadImage, MAX_UPLOAD_BYTES, readAsDataUrl, removeBackground, sniffType, toCanvas, trimTransparent } from '../../lib/image';
import { uid } from '../../lib/templates';

export interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string; image?: string; ok?: boolean; suggestions?: string[];
  /** Undo-history depth right after this message's edit; its Undo is only offered while it is still the latest change. */
  undoAt?: number;
}

/** Prepare an attached photo: downscale, try background removal, sample a palette. */
async function prepareImage(file: File): Promise<ChatImage> {
  const t = await sniffType(file);
  if (!t || t === 'pdf') throw new Error('Please attach a PNG, JPG or WebP image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Images must be under 25 MB.');
  const img = await loadImage(await readAsDataUrl(file));
  const base = toCanvas(img, 900);
  const cut = removeBackground(base, 36);
  // keep the cut-out only if it removed a sensible amount (plain-background product shots)
  const d = cut.getContext('2d')!.getImageData(0, 0, cut.width, cut.height).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 10) clear++;
  const frac = clear / (cut.width * cut.height);
  const bgRemoved = frac > 0.08 && frac < 0.85;
  let out = bgRemoved ? trimTransparent(cut) : base;
  if (Math.max(out.width, out.height) > 768) out = toCanvas(out, 768);
  if (bgRemoved) {
    // toCanvas paints white; redraw to keep transparency
    const c = document.createElement('canvas');
    const src = trimTransparent(cut);
    const k = Math.min(1, 768 / Math.max(src.width, src.height));
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    out = c;
  }
  return {
    dataUrl: out.toDataURL(bgRemoved ? 'image/png' : 'image/jpeg', 0.88),
    aspect: out.height / out.width,
    palette: extractPalette(out, 6),
    bgRemoved,
    name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 30),
  };
}

export default function ChatPanel() {
  const project = useEditor((s) => s.project)!;
  const msgs = useEditor((s) => s.chat);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<ChatImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ChatOutcome | null>(null);
  const historyDepth = useEditor((s) => s.past.length);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const push = (m: Omit<ChatMsg, 'id'>) => useEditor.setState((s) => ({ chat: [...s.chat, { ...m, id: uid() }].slice(-80) }));

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length]);
  useEffect(() => {
    if (msgs.length === 0) push({ role: 'assistant', text: `Hi! Tell me what to change and I'll do it in the plan and 3D view. You can attach a photo too.\n\nYour rooms: ${project.scene.rooms.map((r, i) => `${i + 1}. ${r.name}`).join(', ') || 'none yet'}`, suggestions: HELP.slice(0, 4) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attach = async (f: File) => {
    try { setBusy(true); setPending(await prepareImage(f)); }
    catch (e) { push({ role: 'assistant', text: (e as Error).message, ok: false }); }
    finally { setBusy(false); }
  };

  const apply = (out: ChatOutcome) => {
    const st = useEditor.getState();
    if (out.confirm) setPendingConfirm(out.confirm);
    if (out.edit) st.mutate(out.edit);
    if (out.select) useEditor.setState({ selection: out.select });
    if (out.view) st.setView(out.view);
    if (out.camera) st.setCamPreset(out.camera);
    push({ role: 'assistant', text: out.reply, ok: out.ok, undoAt: out.edit ? useEditor.getState().past.length : undefined, suggestions: out.suggestions });
  };

  const send = async (raw?: string) => {
    const msg = (raw ?? text).trim();
    if (!msg && !pending) return;
    const img = pending;
    push({ role: 'user', text: msg, image: img?.dataUrl });
    setText('');
    if (pendingConfirm) {
      const c = pendingConfirm;
      setPendingConfirm(null);
      if (/^(y|yes|yeah|yep|ok|okay|confirm|sure|do it|go ahead)\b/i.test(msg)) { apply(c); return; }
      if (/^(n|no|nope|cancel|stop|don'?t)\b/i.test(msg)) { push({ role: 'assistant', text: 'Cancelled — nothing was changed.' }); return; }
    }
    const st = useEditor.getState();
    const out = runCommand(msg, { scene: st.project!.scene, selection: st.selection, floorId: st.activeFloorId, image: img, units: st.project!.units });
    if (out.usedImage) setPending(null);
    if (out.async) {
      setBusy(true);
      push({ role: 'assistant', text: out.reply });
      try { apply(await out.async()); } catch (e) { push({ role: 'assistant', text: (e as Error).message, ok: false }); }
      finally { setBusy(false); }
      return;
    }
    apply(out);
  };

  return (
    <div className={`flex h-[calc(100dvh-7rem)] flex-col ${drag ? 'ring-2 ring-inset ring-amber-500' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void attach(f); }}>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${m.role === 'user' ? 'rounded-br-sm bg-amber-500 text-stone-950' : m.ok === false ? 'rounded-bl-sm border border-amber-500/40 bg-stone-800 text-stone-200' : 'rounded-bl-sm bg-stone-800 text-stone-200'}`}>
              {m.image && <img src={m.image} alt="Attached" className="mb-1.5 max-h-32 rounded-lg bg-white/90 object-contain" />}
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
              {m.undoAt !== undefined && (m.undoAt === historyDepth ? (
                <button className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-300 hover:underline" onClick={() => { useEditor.getState().undo(); push({ role: 'assistant', text: 'Undone.' }); }}>
                  <Undo2 size={11} /> Undo this change
                </button>
              ) : m.undoAt < historyDepth ? (
                <span className="mt-1.5 block text-[10px] text-stone-500">Newer changes were made since — use the main Undo (Ctrl+Z) to step back.</span>
              ) : null)}
              {m.suggestions && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.suggestions.map((s) => <button key={s} onClick={() => setText(s)} className="rounded-full border border-stone-600 px-2 py-0.5 text-[11px] text-stone-300 hover:border-amber-500 hover:text-amber-200">{s}</button>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-stone-500"><Loader2 size={12} className="animate-spin" /> Working…</div>}
      </div>

      <div className="border-t border-stone-800 p-2">
        {pending && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-stone-800 p-1.5">
            <img src={pending.dataUrl} alt="" className="h-10 w-10 rounded bg-white object-contain" />
            <div className="min-w-0 flex-1 text-[11px] text-stone-400">
              <div className="truncate text-stone-200">{pending.name}</div>
              {pending.bgRemoved ? 'Background removed' : 'Background kept'} · <span className="inline-flex gap-0.5 align-middle">{pending.palette.slice(0, 5).map((h) => <i key={h} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: h }} />)}</span>
            </div>
            <button aria-label="Remove image" onClick={() => setPending(null)} className="p-1 text-stone-400 hover:text-white"><X size={14} /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button aria-label="Attach image" title="Attach an image (or paste / drop one)" onClick={() => fileRef.current?.click()} className="rounded-md p-2 text-stone-400 hover:bg-stone-800 hover:text-white">
            {pending ? <ImageIcon size={17} className="text-amber-400" /> : <Paperclip size={17} />}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
          <textarea value={text} rows={2} placeholder={pending ? 'e.g. place this image in the first bedroom' : 'e.g. use #C46A4A for the hall'}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); void attach(f); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            className="min-h-[40px] flex-1 resize-none rounded-lg border border-stone-700 bg-stone-900 px-2.5 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:outline-none" />
          <button aria-label="Send" onClick={() => void send()} disabled={busy || (!text.trim() && !pending)} className="rounded-lg bg-amber-500 p-2.5 text-stone-950 hover:bg-amber-400 disabled:opacity-40"><Send size={16} /></button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-stone-600">Enter to send · Shift+Enter for a new line · paste or drop images · works offline</p>
      </div>
    </div>
  );
}
