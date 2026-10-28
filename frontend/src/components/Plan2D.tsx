import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import type { Pt, Wall } from '../lib/types';
import { bbox, centroid, dist, fmtArea, fmtLen, orthoAssist, polygonArea, projectOnSegment, snapPt, snapToEndpoints, wallAngle, wallLength } from '../lib/geometry';
import { makeRoom, makeWall, uid } from '../lib/templates';

type Drag =
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { type: 'object'; id: string; dx: number; dy: number }
  | { type: 'wallEnd'; id: string; end: 'a' | 'b' }
  | { type: 'wall'; id: string; start: Pt; a: Pt; b: Pt }
  | { type: 'roomVertex'; id: string; index: number }
  | { type: 'room'; id: string; start: Pt; poly: Pt[] }
  | { type: 'opening'; id: string }
  | null;

const deg = (r: number) => (r * 180) / Math.PI;

export default function Plan2D() {
  const project = useEditor((s) => s.project)!;
  const scene = project.scene;
  const units = project.units;
  const { tool, selection, activeFloorId, gridSnap, showBlueprint, settings } = useEditor();
  const { mutate, select, setTool, updateProject, toast } = useEditor.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ zoom: 50, ox: 40, oy: 40 }); // zoom = px per metre
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [calib, setCalib] = useState<Pt[]>([]);
  const drag = useRef<Drag>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const floor = scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0];
  const walls = scene.walls.filter((w) => w.floorId === floor.id);
  const rooms = scene.rooms.filter((r) => r.floorId === floor.id);
  const objects = scene.objects.filter((o) => o.floorId === floor.id);
  const below = scene.floors.find((f) => f.level === floor.level - 1);
  const ghostWalls = below ? scene.walls.filter((w) => w.floorId === below.id) : [];
  const bp = project.blueprint && project.blueprint.floorId === floor.id ? project.blueprint : undefined;
  const bpScale = bp?.pxPerMeter ?? 100;

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts: Pt[] = walls.flatMap((w) => [w.a, w.b]);
    rooms.forEach((r) => pts.push(...r.polygon));
    if (bp && pts.length === 0) {
      pts.push({ x: bp.originX, y: bp.originY }, { x: bp.originX + bp.widthPx / bpScale, y: bp.originY + bp.heightPx / bpScale });
    }
    const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 12, maxY: 9 };
    const w = Math.max(2, b.maxX - b.minX), h = Math.max(2, b.maxY - b.minY);
    const zoom = Math.min((size.w - 80) / w, (size.h - 80) / h);
    setView({ zoom, ox: (size.w - w * zoom) / 2 - b.minX * zoom, oy: (size.h - h * zoom) / 2 - b.minY * zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, floor.id, !!bp]);
  useEffect(() => { fit(); }, [fit]);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('archiform:fit2d', onFit);
    return () => window.removeEventListener('archiform:fit2d', onFit);
  }, [fit]);

  useEffect(() => { setDraft([]); setCalib([]); }, [tool, floor.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'Escape') { finishDraft(); setCalib([]); }
      if (e.key === 'Enter') finishDraft();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.zoom, y: (e.clientY - r.top - view.oy) / view.zoom };
  };
  const snapIt = (p: Pt, from?: Pt) => {
    let q = snapToEndpoints(p, walls, 12 / view.zoom);
    if (q === p) {
      if (from) q = orthoAssist(from, q);
      if (gridSnap) q = snapPt(q, settings.gridStep);
    }
    return q;
  };

  const finishDraft = () => {
    const poly = draft.filter((p, i) => i === 0 || dist(p, draft[i - 1]) > 0.01);
    if (tool === 'room' && poly.length >= 3) {
      mutate((s) => { s.rooms.push(makeRoom(floor.id, `Room ${s.rooms.length + 1}`, 'other', poly)); });
      toast(`Room added · ${fmtArea(polygonArea(poly), units)}`, 'success');
    }
    setDraft([]);
  };

  const nearestWall = (p: Pt, tol: number): { wall: Wall; t: number; along: number } | null => {
    let best: { wall: Wall; t: number; along: number } | null = null, bd = tol;
    for (const w of walls) {
      const pr = projectOnSegment(p, w.a, w.b);
      if (pr.distance < bd) { bd = pr.distance; best = { wall: w, t: pr.t, along: pr.t * wallLength(w) }; }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toPlan(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || tool === 'pan' || e.altKey) {
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'wall') {
      const q = snapIt(p, draft[draft.length - 1]);
      if (draft.length > 0) {
        const a = draft[draft.length - 1];
        if (dist(a, q) > 0.05) {
          mutate((s) => { s.walls.push(makeWall(floor.id, a, q, settings.wallThickness, floor.ceilingHeight || settings.wallHeight)); });
        }
        // closing a loop ends the chain
        if (draft.length > 1 && dist(q, draft[0]) < 0.01) { setDraft([]); return; }
      }
      setDraft([...draft, q]);
      return;
    }
    if (tool === 'room') {
      const q = snapIt(p, draft[draft.length - 1]);
      if (draft.length >= 3 && dist(q, draft[0]) < 14 / view.zoom) { finishDraft(); return; }
      setDraft([...draft, q]);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const nw = nearestWall(p, 0.6);
      if (!nw) { toast('Click on a wall to place the ' + tool, 'info'); return; }
      const width = tool === 'door' ? 0.9 : 1.2;
      mutate((s) => {
        s.openings.push({ id: uid(), wallId: nw.wall.id, type: tool, offset: nw.along, width, height: tool === 'door' ? 2.1 : 1.2, sill: tool === 'door' ? 0 : 0.9, source: 'manual' });
      });
      return;
    }
    if (tool === 'calibrate') {
      const next = [...calib, p];
      if (next.length === 2) {
        const pxDist = dist(next[0], next[1]) * bpScale;
        const v = prompt(`Real length of the line you drew (${units === 'ft' ? 'feet' : 'metres'}):`);
        const real = v ? parseFloat(v) : NaN;
        if (real > 0 && bp) {
          const meters = units === 'ft' ? real / 3.28084 : real;
          updateProject((pr) => { pr.blueprint = { ...pr.blueprint!, pxPerMeter: pxDist / meters }; });
          toast('Blueprint scale calibrated', 'success');
          setTool('select');
        }
        setCalib([]);
      } else setCalib(next);
      return;
    }
    // select tool: background click clears selection
    select(null);
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPlan(e);
    setCursor(tool === 'wall' || tool === 'room' ? snapIt(p, draft[draft.length - 1]) : p);
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pan') { setView((v) => ({ ...v, ox: d.ox + e.clientX - d.sx, oy: d.oy + e.clientY - d.sy })); return; }
    const g = (q: Pt) => (gridSnap ? snapPt(q, settings.gridStep) : q);
    if (d.type === 'object') {
      const q = g({ x: p.x - d.dx, y: p.y - d.dy });
      mutate((s) => { const o = s.objects.find((x) => x.id === d.id); if (o) { o.x = q.x; o.y = q.y; } }, 'drag:' + d.id);
    } else if (d.type === 'wallEnd') {
      const others = walls.filter((w) => w.id !== d.id);
      let q = snapToEndpoints(p, others, 12 / view.zoom);
      if (q === p) q = g(p);
      mutate((s) => { const w = s.walls.find((x) => x.id === d.id); if (w) w[d.end] = q; }, 'drag:' + d.id + d.end);
    } else if (d.type === 'wall') {
      const off = g({ x: p.x - d.start.x, y: p.y - d.start.y });
      mutate((s) => {
        const w = s.walls.find((x) => x.id === d.id);
        if (w) { w.a = { x: d.a.x + off.x, y: d.a.y + off.y }; w.b = { x: d.b.x + off.x, y: d.b.y + off.y }; }
      }, 'drag:' + d.id);
    } else if (d.type === 'roomVertex') {
      const q = g(p);
      mutate((s) => { const r = s.rooms.find((x) => x.id === d.id); if (r) r.polygon[d.index] = q; }, 'drag:' + d.id + d.index);
    } else if (d.type === 'room') {
      const off = g({ x: p.x - d.start.x, y: p.y - d.start.y });
      mutate((s) => { const r = s.rooms.find((x) => x.id === d.id); if (r) r.polygon = d.poly.map((v) => ({ x: v.x + off.x, y: v.y + off.y })); }, 'drag:' + d.id);
    } else if (d.type === 'opening') {
      const o = scene.openings.find((x) => x.id === d.id);
      const w = o && scene.walls.find((x) => x.id === o.wallId);
      if (!o || !w) return;
      const pr = projectOnSegment(p, w.a, w.b);
      const along = gridSnap ? Math.round(pr.t * wallLength(w) / 0.05) * 0.05 : pr.t * wallLength(w);
      mutate((s) => { const x = s.openings.find((q) => q.id === d.id); if (x) x.offset = along; }, 'drag:' + d.id);
    }
  };
  const onPointerUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const zoom = Math.max(5, Math.min(600, v.zoom * f));
      const k = zoom / v.zoom;
      return { zoom, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k };
    });
  };

  const startDrag = (e: React.PointerEvent, d: Drag, sel: typeof selection) => {
    if (tool !== 'select' || e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    select(sel);
    drag.current = d;
  };

  const px = 1 / view.zoom; // one screen pixel in metres
  const grid = useMemo(() => {
    const step = view.zoom > 60 ? 0.5 : view.zoom > 20 ? 1 : 5;
    const x0 = Math.floor(-view.ox / view.zoom / step) * step, x1 = (size.w - view.ox) / view.zoom;
    const y0 = Math.floor(-view.oy / view.zoom / step) * step, y1 = (size.h - view.oy) / view.zoom;
    const lines: React.ReactNode[] = [];
    for (let x = x0; x <= x1; x += step) lines.push(<line key={'x' + x} x1={x} y1={y0} x2={x} y2={y1} stroke={Math.abs(x % (step * 2)) < 1e-6 ? '#3a3633' : '#2a2725'} strokeWidth={px} />);
    for (let y = y0; y <= y1; y += step) lines.push(<line key={'y' + y} x1={x0} y1={y} x2={x1} y2={y} stroke={Math.abs(y % (step * 2)) < 1e-6 ? '#3a3633' : '#2a2725'} strokeWidth={px} />);
    return lines;
  }, [view, size, px]);

  const hoverWall = (tool === 'door' || tool === 'window') && cursor ? nearestWall(cursor, 0.6) : null;
  const fs = 12 * px;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1f1d1b]" style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
      <svg ref={svgRef} width={size.w} height={size.h} className="block touch-none select-none"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
        onDoubleClick={() => finishDraft()} onContextMenu={(e) => { e.preventDefault(); finishDraft(); }}>
        <g transform={`translate(${view.ox} ${view.oy}) scale(${view.zoom})`}>
          {grid}
          {bp && showBlueprint && bp.visible && (
            <image href={bp.dataUrl} x={bp.originX} y={bp.originY} width={bp.widthPx / bpScale} height={bp.heightPx / bpScale} opacity={bp.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />
          )}
          {ghostWalls.map((w) => <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#57534e" strokeDasharray={`${4 * px} ${4 * px}`} strokeWidth={w.thickness} opacity={0.4} />)}

          {rooms.map((r) => {
            const sel = selection?.kind === 'room' && selection.id === r.id;
            const c = centroid(r.polygon);
            return (
              <g key={r.id}>
                <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={sel ? 'rgba(245,158,11,0.18)' : r.source === 'detected' ? 'rgba(251,146,60,0.08)' : 'rgba(168,162,158,0.10)'}
                  stroke={sel ? '#f59e0b' : 'transparent'} strokeWidth={2 * px}
                  onPointerDown={(e) => startDrag(e, { type: 'room', id: r.id, start: toPlan(e), poly: r.polygon }, { kind: 'room', id: r.id })} />
                <text x={c.x} y={c.y} fontSize={fs} fill="#d6d3d1" textAnchor="middle" style={{ pointerEvents: 'none' }}>{r.name}</text>
                <text x={c.x} y={c.y + fs * 1.2} fontSize={fs * 0.85} fill="#a8a29e" textAnchor="middle" style={{ pointerEvents: 'none' }}>{fmtArea(polygonArea(r.polygon), units)}</text>
                {sel && r.polygon.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={5 * px} fill="#f59e0b" stroke="#1c1917" strokeWidth={px}
                    onPointerDown={(e) => startDrag(e, { type: 'roomVertex', id: r.id, index: i }, { kind: 'room', id: r.id })} />
                ))}
              </g>
            );
          })}

          {walls.map((w) => {
            const sel = selection?.kind === 'wall' && selection.id === w.id;
            const low = w.confidence !== undefined && w.confidence < 0.6;
            return (
              <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} strokeWidth={w.thickness} strokeLinecap="square"
                stroke={sel ? '#f59e0b' : low ? '#fb923c' : w.source === 'detected' && w.confidence !== undefined ? '#fdba74' : '#e7e5e4'}
                strokeDasharray={low ? `${6 * px} ${3 * px}` : undefined}
                onPointerDown={(e) => startDrag(e, { type: 'wall', id: w.id, start: toPlan(e), a: w.a, b: w.b }, { kind: 'wall', id: w.id })} />
            );
          })}

          {scene.openings.map((o) => {
            const w = walls.find((x) => x.id === o.wallId);
            if (!w) return null;
            const L = wallLength(w);
            const ang = wallAngle(w);
            const sel = selection?.kind === 'opening' && selection.id === o.id;
            const c = { x: w.a.x + Math.cos(ang) * o.offset, y: w.a.y + Math.sin(ang) * o.offset };
            const hw = Math.min(o.width, L) / 2;
            return (
              <g key={o.id} transform={`translate(${c.x} ${c.y}) rotate(${deg(ang)})`}
                onPointerDown={(e) => startDrag(e, { type: 'opening', id: o.id }, { kind: 'opening', id: o.id })} style={{ cursor: tool === 'select' ? 'ew-resize' : undefined }}>
                <rect x={-hw} y={-w.thickness / 2 - px} width={hw * 2} height={w.thickness + 2 * px} fill="#1f1d1b" />
                {o.type === 'window' ? (
                  <>
                    <rect x={-hw} y={-w.thickness / 2} width={hw * 2} height={w.thickness} fill="none" stroke={sel ? '#f59e0b' : '#7dd3fc'} strokeWidth={1.5 * px} />
                    <line x1={-hw} y1={0} x2={hw} y2={0} stroke={sel ? '#f59e0b' : '#7dd3fc'} strokeWidth={1.5 * px} />
                  </>
                ) : (
                  <>
                    <line x1={-hw} y1={w.thickness / 2} x2={-hw} y2={w.thickness / 2 + hw * 2} stroke={sel ? '#f59e0b' : '#d6d3d1'} strokeWidth={2 * px} />
                    <path d={`M ${-hw} ${w.thickness / 2 + hw * 2} A ${hw * 2} ${hw * 2} 0 0 0 ${hw} ${w.thickness / 2}`} fill="none" stroke={sel ? '#f59e0b' : '#78716c'} strokeWidth={px} strokeDasharray={`${3 * px} ${2 * px}`} />
                  </>
                )}
              </g>
            );
          })}

          {objects.map((o) => {
            const sel = selection?.kind === 'object' && selection.id === o.id;
            return (
              <g key={o.id} transform={`translate(${o.x} ${o.y}) rotate(${-deg(o.rotation)})`}
                onPointerDown={(e) => { const p = toPlan(e); startDrag(e, { type: 'object', id: o.id, dx: p.x - o.x, dy: p.y - o.y }, { kind: 'object', id: o.id }); }}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}>
                <rect x={-o.dims.w / 2} y={-o.dims.d / 2} width={o.dims.w} height={o.dims.d} fill={o.colorHex} fillOpacity={o.elevation > 0.3 ? 0.25 : 0.55}
                  stroke={sel ? '#f59e0b' : o.estimated ? '#f59e0b' : '#0c0a09'} strokeDasharray={o.estimated ? `${4 * px} ${2 * px}` : undefined} strokeWidth={(sel ? 2 : 1) * px} rx={0.02} />
                <line x1={-o.dims.w / 2 + 0.03} y1={o.dims.d / 2 - 0.03} x2={o.dims.w / 2 - 0.03} y2={o.dims.d / 2 - 0.03} stroke="#0c0a09" strokeOpacity={0.5} strokeWidth={px} />
                {view.zoom > 35 && o.dims.w * view.zoom > 40 && (
                  <text x={0} y={fs * 0.35} fontSize={fs * 0.8} textAnchor="middle" fill="#fafaf9" style={{ pointerEvents: 'none', paintOrder: 'stroke' }} stroke="#1c1917" strokeWidth={2 * px}>{o.name}</text>
                )}
              </g>
            );
          })}

          {/* selected wall: endpoints + dimension */}
          {selection?.kind === 'wall' && (() => {
            const w = walls.find((x) => x.id === selection.id);
            if (!w) return null;
            const ang = wallAngle(w);
            const n = { x: -Math.sin(ang), y: Math.cos(ang) };
            const off = w.thickness / 2 + 18 * px;
            const m = { x: (w.a.x + w.b.x) / 2 + n.x * off, y: (w.a.y + w.b.y) / 2 + n.y * off };
            return (
              <g>
                <line x1={w.a.x + n.x * off} y1={w.a.y + n.y * off} x2={w.b.x + n.x * off} y2={w.b.y + n.y * off} stroke="#f59e0b" strokeWidth={px} />
                <text x={m.x} y={m.y - 4 * px} fontSize={fs} fill="#fbbf24" textAnchor="middle" transform={`rotate(${((deg(ang) + 90) % 180) - 90} ${m.x} ${m.y})`}>{fmtLen(wallLength(w), units)}</text>
                {(['a', 'b'] as const).map((end) => (
                  <circle key={end} cx={w[end].x} cy={w[end].y} r={6 * px} fill="#f59e0b" stroke="#1c1917" strokeWidth={1.5 * px}
                    onPointerDown={(e) => startDrag(e, { type: 'wallEnd', id: w.id, end }, { kind: 'wall', id: w.id })} style={{ cursor: 'grab' }} />
                ))}
              </g>
            );
          })()}

          {/* drafting previews */}
          {draft.length > 0 && cursor && (
            <g style={{ pointerEvents: 'none' }}>
              {tool === 'room' ? (
                <polygon points={[...draft, cursor].map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth={1.5 * px} strokeDasharray={`${5 * px} ${3 * px}`} />
              ) : (
                <>
                  <line x1={draft[draft.length - 1].x} y1={draft[draft.length - 1].y} x2={cursor.x} y2={cursor.y} stroke="#f59e0b" strokeOpacity={0.7} strokeWidth={settings.wallThickness} strokeLinecap="square" />
                  <text x={(draft[draft.length - 1].x + cursor.x) / 2} y={(draft[draft.length - 1].y + cursor.y) / 2 - 10 * px} fontSize={fs} fill="#fbbf24" textAnchor="middle">{fmtLen(dist(draft[draft.length - 1], cursor), units)}</text>
                </>
              )}
              {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5 * px} fill="#f59e0b" />)}
            </g>
          )}
          {(tool === 'wall' || tool === 'room') && cursor && <circle cx={cursor.x} cy={cursor.y} r={4 * px} fill="none" stroke="#f59e0b" strokeWidth={1.5 * px} style={{ pointerEvents: 'none' }} />}
          {hoverWall && cursor && (() => {
            const w = hoverWall.wall, ang = wallAngle(w);
            const c = { x: w.a.x + Math.cos(ang) * hoverWall.along, y: w.a.y + Math.sin(ang) * hoverWall.along };
            const hw = (tool === 'door' ? 0.9 : 1.2) / 2;
            return <line x1={c.x - Math.cos(ang) * hw} y1={c.y - Math.sin(ang) * hw} x2={c.x + Math.cos(ang) * hw} y2={c.y + Math.sin(ang) * hw} stroke="#f59e0b" strokeWidth={w.thickness + 4 * px} strokeOpacity={0.6} style={{ pointerEvents: 'none' }} />;
          })()}
          {calib.length > 0 && cursor && (
            <line x1={calib[0].x} y1={calib[0].y} x2={cursor.x} y2={cursor.y} stroke="#22d3ee" strokeWidth={2 * px} style={{ pointerEvents: 'none' }} />
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-stone-300">
        {cursor ? `${fmtLen(cursor.x, units)} , ${fmtLen(cursor.y, units)}` : '—'} · {Math.round(view.zoom)} px/m
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1">
        <button onClick={fit} className="rounded bg-stone-800/90 px-2 py-1 text-xs text-stone-200 hover:bg-stone-700">Fit</button>
      </div>
      {bp && !bp.pxPerMeter && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-stone-950 shadow">
          Blueprint scale is not calibrated — use the ruler tool and enter a known length.
        </div>
      )}
      {(tool === 'wall' || tool === 'room') && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-stone-900/90 px-3 py-1.5 text-xs text-stone-300">
          {tool === 'wall' ? 'Click to place wall points · double-click / Enter / right-click to finish' : 'Click room corners · click the first point or press Enter to close'}
        </div>
      )}
      {tool === 'calibrate' && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-cyan-500/95 px-3 py-1.5 text-xs font-medium text-stone-950">
          Click the two ends of a known dimension on the blueprint
        </div>
      )}
    </div>
  );
}
