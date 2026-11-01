import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Units } from '../lib/types';
import { fmtLen, fromMeters, parseFeetInches, toMeters } from '../lib/geometry';

export function Btn({ children, onClick, variant = 'ghost', className = '', disabled, title, type = 'button', active }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'outline' | 'danger'; className?: string; disabled?: boolean; title?: string; type?: 'button' | 'submit'; active?: boolean;
}) {
  // responsive "hidden md:inline-flex" must not be overridden by the default display class
  const display = /(^|\s)hidden(\s|$)/.test(className) ? '' : 'inline-flex';
  const base = `${display} items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:opacity-40`;
  const v = {
    primary: 'bg-amber-500 px-3 py-1.5 text-stone-950 hover:bg-amber-400',
    ghost: `px-2 py-1.5 ${active ? 'bg-stone-700 text-white' : 'text-stone-300 hover:bg-stone-800 hover:text-white'}`,
    outline: 'border border-stone-700 px-3 py-1.5 text-stone-200 hover:border-stone-500 hover:bg-stone-800',
    danger: 'bg-red-600/90 px-3 py-1.5 text-white hover:bg-red-500',
  }[variant];
  return <button type={type} title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`${base} ${v} ${className}`}>{children}</button>;
}

/** Labelled field. Use `group` when the field contains several controls (e.g. picker + text box). */
export function Field({ label, children, hint, group }: { label: string; children: ReactNode; hint?: string; group?: boolean }) {
  const id = useId();
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className="block">
        <span id={id} className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</span>
        {children}
        {hint && <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:outline-none';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

/** Number field that commits on blur/Enter, so typing doesn't spam history. */
export function NumField({ value, onCommit, step = 0.01, min, max, suffix, className = '' }: {
  value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; className?: string;
}) {
  const [txt, setTxt] = useState(String(+value.toFixed(3)));
  useEffect(() => setTxt(String(+value.toFixed(3))), [value]);
  const commit = () => {
    let v = parseFloat(txt);
    if (isNaN(v)) { setTxt(String(+value.toFixed(3))); return; }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    setTxt(String(+v.toFixed(3)));
  };
  return (
    <div className={`relative ${className}`}>
      <input type="number" step={step} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} className={`${inputCls} pr-8`} />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-stone-500">{suffix}</span>}
    </div>
  );
}

/**
 * Length field. Values and bounds are always in METRES; display is in project units.
 * Imperial projects accept feet-and-inches text such as 10' 6", 10 6 or 10.5.
 */
export function LenField({ meters, units, onCommit, min = 0, max }: { meters: number; units: Units; onCommit: (m: number) => void; min?: number; max?: number }) {
  if (units === 'm') {
    return <NumField value={+meters.toFixed(3)} step={0.01} min={min} max={max} suffix="m" onCommit={onCommit} />;
  }
  return <FeetField meters={meters} onCommit={onCommit} min={min} max={max} />;
}

function FeetField({ meters, onCommit, min, max }: { meters: number; onCommit: (m: number) => void; min: number; max?: number }) {
  const [txt, setTxt] = useState(fmtLen(meters, 'ft'));
  const [bad, setBad] = useState(false);
  useEffect(() => { setTxt(fmtLen(meters, 'ft')); setBad(false); }, [meters]);
  const commit = () => {
    const ft = parseFeetInches(txt);
    if (ft === null) { setBad(true); return; }
    let m = toMeters(ft, 'ft');
    m = Math.max(min, max !== undefined ? Math.min(max, m) : m);
    setBad(false);
    if (Math.abs(m - meters) > 1e-6) onCommit(m);
    setTxt(fmtLen(m, 'ft'));
  };
  return (
    <input value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      aria-invalid={bad} title={`Feet and inches, e.g. 10' 6". Range ${fmtLen(min, 'ft')}${max !== undefined ? ` – ${fmtLen(max, 'ft')}` : ''}`}
      className={`${inputCls} ${bad ? 'border-red-500' : ''}`} />
  );
}
export { fromMeters };

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => [...(box.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => !el.hasAttribute('disabled'));
    // focus the first field (or the dialog) when opened
    requestAnimationFrame(() => { const f = focusables(); (f.find((el) => el.tagName !== 'BUTTON') ?? f[0] ?? box.current)?.focus(); });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => { window.removeEventListener('keydown', k); root?.removeAttribute('inert'); opener?.focus?.(); };
  }, [onClose]);
  // rendered outside #root so the app behind it can be made inert
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full overflow-auto rounded-xl border border-stone-700 bg-stone-900 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-3">
          <h2 className="font-semibold text-stone-100">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ title, body, confirmLabel = 'Delete', onConfirm, onClose }: { title: string; body: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-stone-300">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-stone-800 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'amber' | 'green' | 'red' | 'sky' }) {
  const t = { stone: 'bg-stone-800 text-stone-300', amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30', green: 'bg-emerald-500/15 text-emerald-300', red: 'bg-red-500/15 text-red-300', sky: 'bg-sky-500/15 text-sky-300' }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-700 p-3 text-center text-xs text-stone-500">{children}</p>;
}
