import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useQuery } from '@tanstack/react-query';
import { CollabClient } from '../lib/collab';
import { api } from '../lib/api';
import {
  type Viewport,
  fitToBounds,
  screenToWorld,
  zoomAtPoint,
} from '../lib/canvas-transform';

type Tool = 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'erase';

type Stroke =
  | { id: string; kind: 'pen'; color: string; sw: number; points: Array<[number, number]> }
  | { id: string; kind: 'rect'; color: string; sw: number; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'ellipse'; color: string; sw: number; cx: number; cy: number; rx: number; ry: number }
  | { id: string; kind: 'arrow'; color: string; sw: number; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'text'; color: string; x: number; y: number; text: string };

const COLORS = ['#f4f4f5', '#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb7185'];

const TOOLS: Array<{ id: Tool; label: string; hint: string; key: string; icon: React.ReactNode; cursor: string }> = [
  { id: 'pen', label: 'Pen', hint: 'Freehand draw', key: 'P', icon: <PenIcon />, cursor: 'crosshair' },
  { id: 'rect', label: 'Rectangle', hint: 'Draw box', key: 'R', icon: <RectIcon />, cursor: 'crosshair' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Draw oval', key: 'E', icon: <EllipseIcon />, cursor: 'crosshair' },
  { id: 'arrow', label: 'Arrow', hint: 'Connect things', key: 'A', icon: <ArrowIcon />, cursor: 'crosshair' },
  { id: 'text', label: 'Text', hint: 'Add a label', key: 'T', icon: <TextIcon />, cursor: 'text' },
  { id: 'erase', label: 'Erase', hint: 'Click to remove', key: 'X', icon: <EraseIcon />, cursor: 'cell' },
];

interface Props {
  client: CollabClient;
  active: boolean;
  // Used by Interview view to force the slug context. If absent we look up from URL.
  slug?: string;
}

// Collaborative whiteboard backed by a Y.Array("strokes") inside the pad's
// dedicated whiteboard Y.Doc. The hub + WS layer handles persistence + fanout
// the same as a code file. We render SVG (simpler than canvas, scales cleanly,
// and lets us hit-test by toolkit). UndoManager scopes to local-origin Y.Array
// edits so users only ever undo their own strokes.
export function WhiteboardCanvas({ client, active, slug }: Props) {
  const effectiveSlug = slug ?? window.location.pathname.split('/p/')[1]?.split('/')[0] ?? '';
  const wb = useQuery({
    queryKey: ['whiteboard', effectiveSlug],
    queryFn: () => api.get<{ fileId: string }>(`/api/pads/${effectiveSlug}/whiteboard`),
    enabled: !!effectiveSlug,
  });

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const yArrayRef = useRef<Y.Array<Stroke> | null>(null);
  const undoMgrRef = useRef<Y.UndoManager | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number; pointerId: number | null }>({
    active: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
  });
  const spacePressedRef = useRef(false);
  spacePressedRef.current = spacePressed;

  const currentTool = useMemo(() => TOOLS.find((t) => t.id === tool) ?? TOOLS[0], [tool]);

  useEffect(() => {
    if (!wb.data?.fileId) return;
    const doc = client.getDoc(wb.data.fileId);
    const arr = doc.getArray<Stroke>('strokes');
    yArrayRef.current = arr;
    // Track only edits from this client. Remote edits stay in history so we
    // can fall back to them, but our undo button never undoes someone else's
    // strokes.
    const undo = new Y.UndoManager(arr, { captureTimeout: 250 });
    undoMgrRef.current = undo;
    const sync = () => setStrokes(arr.toArray());
    sync();
    arr.observe(sync);
    return () => {
      arr.unobserve(sync);
      undo.destroy();
      undoMgrRef.current = null;
    };
  }, [client, wb.data?.fileId]);

  const pos = useCallback((e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, rect, viewportRef.current);
    return [Math.round(wx), Math.round(wy)];
  }, []);

  const commitDraft = () => {
    if (!draft) return;
    yArrayRef.current?.push([draft]);
    setDraft(null);
  };

  const clearAll = useCallback(() => {
    const arr = yArrayRef.current;
    if (!arr || arr.length === 0) return;
    if (!confirm(`Clear all ${arr.length} marks?`)) return;
    arr.delete(0, arr.length);
  }, []);

  // Keyboard shortcuts: tool letters, [/] for stroke width, Ctrl/Cmd+Z/Y, Esc to cancel draft,
  // Space to pan, +/- to zoom, 0 to reset.
  useEffect(() => {
    if (!active) return;
    const isTypingTarget = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) undoMgrRef.current?.redo();
        else undoMgrRef.current?.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undoMgrRef.current?.redo();
        return;
      }
      if (e.key === 'Escape') {
        setDraft(null);
        return;
      }
      if (e.key === ' ') {
        if (!spacePressedRef.current) setSpacePressed(true);
        e.preventDefault();
        return;
      }
      if (e.key === '[') {
        setStrokeWidth((w) => Math.max(1, w - 1));
        return;
      }
      if (e.key === ']') {
        setStrokeWidth((w) => Math.min(12, w + 1));
        return;
      }
      if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomBy(1.25);
        return;
      }
      if (meta && e.key === '-') {
        e.preventDefault();
        zoomBy(1 / 1.25);
        return;
      }
      if (meta && e.key === '0') {
        e.preventDefault();
        setViewport({ x: 0, y: 0, zoom: 1 });
        return;
      }
      // tool-letter shortcuts: P/R/E/A/T/X
      const t = TOOLS.find((tt) => tt.key.toLowerCase() === e.key.toLowerCase());
      if (t) {
        setTool(t.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active]);

  const zoomBy = useCallback((factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setViewport((vp) => zoomAtPoint(vp, vp.zoom * factor, cx, cy, rect));
  }, []);

  // Wheel: ctrl/meta (or trackpad pinch) = cursor-centered zoom; plain = pan; shift = horizontal pan.
  // Attached via useEffect for { passive: false } so preventDefault works for trackpad pinch.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !active) return;
    const onWheel = (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Cap per-event delta — browsers report ±100 for mouse wheel clicks,
        // ~±5 for trackpad pinches. Clamp keeps both reasonable.
        const clamped = Math.max(-50, Math.min(50, e.deltaY));
        const factor = Math.exp(-clamped * 0.01);
        setViewport((vp) => zoomAtPoint(vp, vp.zoom * factor, e.clientX, e.clientY, rect));
        return;
      }
      e.preventDefault();
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      setViewport((vp) => ({ ...vp, x: vp.x + dx, y: vp.y + dy }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [active]);

  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
    setIsPanning(true);
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* lost pointer */ }
    setDraft(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!yArrayRef.current) return;
    // Pan triggers: middle mouse, OR space+primary
    if (e.button === 1 || (e.button === 0 && spacePressedRef.current)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = pos(e);
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* lost pointer */ }
    if (tool === 'pen') {
      setDraft({ id: rid(), kind: 'pen', color, sw: strokeWidth, points: [[x, y]] });
    } else if (tool === 'rect') {
      setDraft({ id: rid(), kind: 'rect', color, sw: strokeWidth, x, y, w: 0, h: 0 });
    } else if (tool === 'ellipse') {
      setDraft({ id: rid(), kind: 'ellipse', color, sw: strokeWidth, cx: x, cy: y, rx: 0, ry: 0 });
    } else if (tool === 'arrow') {
      setDraft({ id: rid(), kind: 'arrow', color, sw: strokeWidth, x1: x, y1: y, x2: x, y2: y });
    } else if (tool === 'text') {
      const text = prompt('Label:');
      if (text && text.trim()) {
        yArrayRef.current.push([{ id: rid(), kind: 'text', color, x, y, text: text.trim() }]);
      }
    } else if (tool === 'erase') {
      const idx = hitTest(strokes, x, y);
      if (idx >= 0) yArrayRef.current.delete(idx, 1);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      panRef.current.lastX = e.clientX;
      panRef.current.lastY = e.clientY;
      setViewport((vp) => ({ ...vp, x: vp.x - dx, y: vp.y - dy }));
      return;
    }
    if (!draft) return;
    const [x, y] = pos(e);
    if (draft.kind === 'pen') {
      setDraft({ ...draft, points: [...draft.points, [x, y]] });
    } else if (draft.kind === 'rect') {
      setDraft({ ...draft, w: x - draft.x, h: y - draft.y });
    } else if (draft.kind === 'ellipse') {
      setDraft({ ...draft, rx: Math.abs(x - draft.cx), ry: Math.abs(y - draft.cy) });
    } else if (draft.kind === 'arrow') {
      setDraft({ ...draft, x2: x, y2: y });
    }
  };

  const onPointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current.active) {
      const pid = panRef.current.pointerId;
      if (e && pid != null) {
        try { (e.target as Element).releasePointerCapture?.(pid); } catch { /* already released */ }
      }
      panRef.current = { active: false, lastX: 0, lastY: 0, pointerId: null };
      setIsPanning(false);
      return;
    }
    if (draft) commitDraft();
  };

  if (!wb.isLoading && !wb.data) {
    return <div className="p-4 text-xs text-subtle">Whiteboard unavailable.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line text-xs">
        <div className="flex items-center gap-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`group relative inline-flex items-center justify-center size-8 rounded transition-colors ${
                tool === t.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
            >
              {t.icon}
              <span className="sr-only">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="mx-2 h-5 w-px bg-line" />
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`size-5 rounded-full ring-1 ${
                color === c ? 'ring-primary scale-110' : 'ring-line'
              } transition-transform`}
              style={{ backgroundColor: c }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
        <label className="ml-2 flex items-center gap-1 text-subtle" title="Stroke width ([ / ])">
          <span className="text-[10px] uppercase tracking-wide">w</span>
          <input
            type="range"
            min={1}
            max={12}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-16 accent-accent"
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => undoMgrRef.current?.undo()}
            className="btn-ghost !px-2 !py-1 text-secondary"
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <UndoIcon />
          </button>
          <button
            onClick={() => undoMgrRef.current?.redo()}
            className="btn-ghost !px-2 !py-1 text-secondary"
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
          <div className="mx-1 h-5 w-px bg-line" />
          <button
            onClick={clearAll}
            className="btn-ghost !px-2 !py-1 text-subtle hover:text-danger"
            title="Clear all"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 surface overflow-hidden relative">
        {!active ? null : (
          <svg
            ref={svgRef}
            className="w-full h-full touch-none select-none"
            style={{
              cursor: isPanning ? 'grabbing' : spacePressed ? 'grab' : currentTool.cursor,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onContextMenu={(e) => {
              if (spacePressed) e.preventDefault();
            }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
              </marker>
            </defs>
            <g transform={`translate(${-viewport.x} ${-viewport.y}) scale(${viewport.zoom})`}>
              {strokes.map((s) => (
                <StrokeShape key={s.id} stroke={s} />
              ))}
              {draft && <StrokeShape stroke={draft} />}
            </g>
          </svg>
        )}
        {strokes.length === 0 && !draft && active && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-subtle text-sm space-y-3 text-center px-4">
            <div>
              <p className="font-medium text-secondary mb-1">
                Sketch out a system design
              </p>
              <p className="text-xs">
                Tools: <span className="kbd">P</span> pen ·{' '}
                <span className="kbd">R</span> rect ·{' '}
                <span className="kbd">A</span> arrow ·{' '}
                <span className="kbd">T</span> text ·{' '}
                <span className="kbd">⌘Z</span> undo
              </p>
              <p className="text-xs mt-1">
                Navigate: <span className="kbd">space</span>+drag or middle-click pan ·{' '}
                <span className="kbd">⌘</span>+scroll zoom
              </p>
            </div>
          </div>
        )}
        {active && (
          <ZoomControls
            zoom={viewport.zoom}
            onZoomIn={() => zoomBy(1.25)}
            onZoomOut={() => zoomBy(1 / 1.25)}
            onReset={() => setViewport({ x: 0, y: 0, zoom: 1 })}
            onFit={() => {
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect) return;
              const bounds = computeStrokeBounds(strokes);
              setViewport(fitToBounds(bounds, rect.width, rect.height));
            }}
          />
        )}
      </div>
    </div>
  );
}

function StrokeShape({ stroke: s }: { stroke: Stroke }) {
  switch (s.kind) {
    case 'pen': {
      const d = s.points.length === 0 ? '' : `M ${s.points.map(([x, y]) => `${x} ${y}`).join(' L ')}`;
      return <path d={d} stroke={s.color} strokeWidth={s.sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    case 'rect': {
      const x = Math.min(s.x, s.x + s.w);
      const y = Math.min(s.y, s.y + s.h);
      return (
        <rect
          x={x}
          y={y}
          width={Math.abs(s.w)}
          height={Math.abs(s.h)}
          stroke={s.color}
          strokeWidth={s.sw}
          fill="none"
          rx={4}
        />
      );
    }
    case 'ellipse':
      return (
        <ellipse
          cx={s.cx}
          cy={s.cy}
          rx={s.rx}
          ry={s.ry}
          stroke={s.color}
          strokeWidth={s.sw}
          fill="none"
        />
      );
    case 'arrow':
      return (
        <line
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={s.color}
          strokeWidth={s.sw}
          markerEnd="url(#arrowhead)"
          style={{ color: s.color }}
        />
      );
    case 'text':
      return (
        <text
          x={s.x}
          y={s.y}
          fill={s.color}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={16}
        >
          {s.text}
        </text>
      );
  }
}

function hitTest(strokes: Stroke[], x: number, y: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    const pad = ('sw' in s ? s.sw : 6) + 4;
    if (s.kind === 'pen') {
      for (const [px, py] of s.points) {
        if (dist(x, y, px, py) < pad) return i;
      }
    } else if (s.kind === 'rect') {
      const minX = Math.min(s.x, s.x + s.w) - pad;
      const minY = Math.min(s.y, s.y + s.h) - pad;
      const maxX = Math.max(s.x, s.x + s.w) + pad;
      const maxY = Math.max(s.y, s.y + s.h) + pad;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
    } else if (s.kind === 'ellipse') {
      const dx = (x - s.cx) / Math.max(1, s.rx);
      const dy = (y - s.cy) / Math.max(1, s.ry);
      if (dx * dx + dy * dy <= 1.2) return i;
    } else if (s.kind === 'arrow') {
      if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < pad) return i;
    } else if (s.kind === 'text') {
      const w = s.text.length * 9;
      if (x >= s.x - 4 && x <= s.x + w && y >= s.y - 18 && y <= s.y + 4) return i;
    }
  }
  return -1;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return dist(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function computeStrokeBounds(
  strokes: Stroke[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (strokes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of strokes) {
    if (s.kind === 'pen') {
      for (const [px, py] of s.points) grow(px, py);
    } else if (s.kind === 'rect') {
      grow(s.x, s.y);
      grow(s.x + s.w, s.y + s.h);
    } else if (s.kind === 'ellipse') {
      grow(s.cx - s.rx, s.cy - s.ry);
      grow(s.cx + s.rx, s.cy + s.ry);
    } else if (s.kind === 'arrow') {
      grow(s.x1, s.y1);
      grow(s.x2, s.y2);
    } else if (s.kind === 'text') {
      grow(s.x, s.y - 18);
      grow(s.x + s.text.length * 9, s.y + 4);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const pct = Math.round(zoom * 100);
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-md border border-line bg-surface/95 backdrop-blur px-1 py-1 text-xs shadow-sm">
      <button
        onClick={onZoomOut}
        className="inline-flex items-center justify-center size-7 rounded text-secondary hover:bg-hover hover:text-primary"
        title="Zoom out (⌘−)"
        aria-label="Zoom out"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        onClick={onReset}
        className="px-1.5 py-0.5 rounded text-secondary hover:bg-hover hover:text-primary tabular-nums min-w-[3.5rem]"
        title="Reset zoom (⌘0)"
        aria-label="Reset zoom"
      >
        {pct}%
      </button>
      <button
        onClick={onZoomIn}
        className="inline-flex items-center justify-center size-7 rounded text-secondary hover:bg-hover hover:text-primary"
        title="Zoom in (⌘+)"
        aria-label="Zoom in"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <line x1="12" y1="5" x2="12" y2="19" />
        </svg>
      </button>
      <div className="mx-0.5 h-4 w-px bg-line" />
      <button
        onClick={onFit}
        className="inline-flex items-center justify-center size-7 rounded text-secondary hover:bg-hover hover:text-primary"
        title="Fit to content"
        aria-label="Fit to content"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" />
        </svg>
      </button>
    </div>
  );
}

// Icons — kept inline so the bundle doesn't grow for one component.
function PenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}
function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}
function EllipseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="12" rx="9" ry="6" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="11 5 19 5 19 13" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}
function EraseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6 6 12-12L15 5 3 17z" />
      <path d="M9 23l4-4" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}
