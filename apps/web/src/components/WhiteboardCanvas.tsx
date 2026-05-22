import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useQuery } from '@tanstack/react-query';
import { CollabClient, type PresenceUser } from '../lib/collab';
import { api } from '../lib/api';
import {
  type Viewport,
  fitToBounds,
  screenToWorld,
  zoomAtPoint,
} from '../lib/canvas-transform';
import {
  strokeBounds,
  handlesFor,
  hitHandle,
  hitStrokeIdx as libHitStrokeIdx,
  moveStroke as libMoveStroke,
  resizeStroke as libResizeStroke,
} from '../lib/canvas-hit';
import { catmullRomPath, inViewport } from '../lib/canvas-smooth';
import { exportPNG, exportSVG } from '../lib/canvas-export';

type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'note' | 'erase';

type Stroke =
  | { id: string; kind: 'pen'; color: string; sw: number; points: Array<[number, number]> }
  | { id: string; kind: 'rect'; color: string; sw: number; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'ellipse'; color: string; sw: number; cx: number; cy: number; rx: number; ry: number }
  | { id: string; kind: 'arrow'; color: string; sw: number; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'text'; color: string; x: number; y: number; text: string }
  | { id: string; kind: 'note'; color: string; x: number; y: number; w: number; h: number; text: string };

const COLORS = [
  '#ffffff', // white
  '#d4d4d8', // light gray
  '#9ca3af', // gray
  '#000000', // black
  '#ef4444', // red
  '#f97316', // orange
  '#fbbf24', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
];
const DEFAULT_COLOR = '#9ca3af';

const TOOLS: Array<{ id: Tool; label: string; hint: string; key: string; icon: React.ReactNode; cursor: string }> = [
  { id: 'select', label: 'Select', hint: 'Click to select, drag to move', key: 'V', icon: <SelectIcon />, cursor: 'default' },
  { id: 'pen', label: 'Pen', hint: 'Freehand draw', key: 'P', icon: <PenIcon />, cursor: 'crosshair' },
  { id: 'rect', label: 'Rectangle', hint: 'Draw box', key: 'R', icon: <RectIcon />, cursor: 'crosshair' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Draw oval', key: 'E', icon: <EllipseIcon />, cursor: 'crosshair' },
  { id: 'arrow', label: 'Arrow', hint: 'Connect things', key: 'A', icon: <ArrowIcon />, cursor: 'crosshair' },
  { id: 'text', label: 'Text', hint: 'Add a label', key: 'T', icon: <TextIcon />, cursor: 'text' },
  { id: 'note', label: 'Note', hint: 'Sticky note', key: 'N', icon: <NoteIcon />, cursor: 'crosshair' },
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
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<PresenceUser[]>([]);
  const lastCanvasCursorSendRef = useRef(0);
  // Convenience: when exactly one is selected, treat as single-select for handles.
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const dragRef = useRef<
    | null
    | { kind: 'move'; startX: number; startY: number; baseStrokes: Stroke[] }
    | { kind: 'resize'; handle: import('../lib/canvas-hit').HandleName; baseStroke: Stroke }
    | { kind: 'marquee'; startX: number; startY: number }
  >(null);

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

  // Subscribe to peer presence - pick out users hovering the canvas. Each
  // remote cursor renders as a small dot + name label at the broadcast world
  // coord. Clears when they leave (canvasCursor === null) or disconnect.
  useEffect(() => {
    if (!active) return;
    const unsub = client.onPresence((users) => {
      const list = Object.values(users).filter((u) => u.canvasCursor != null);
      setRemoteCursors(list);
    });
    return () => {
      unsub();
      setRemoteCursors([]);
    };
  }, [client, active]);

  // Clear our cursor broadcast when we leave the canvas pane.
  useEffect(() => {
    if (!active) {
      client.setSelfPresence({ canvasCursor: null });
    }
    return () => {
      client.setSelfPresence({ canvasCursor: null });
    };
  }, [client, active]);

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
    // Sticky notes prompt for text once their drag is done. Skip the commit if
    // the user cancels the prompt or draws a tiny note (< 20×20).
    if (draft.kind === 'note') {
      const minW = 20;
      const minH = 20;
      // normalize drag so w/h positive
      const nx = draft.w < 0 ? draft.x + draft.w : draft.x;
      const ny = draft.h < 0 ? draft.y + draft.h : draft.y;
      const nw = Math.max(minW, Math.abs(draft.w));
      const nh = Math.max(minH, Math.abs(draft.h));
      const text = prompt('Note text:');
      if (text && text.trim()) {
        yArrayRef.current?.push([{ ...draft, x: nx, y: ny, w: nw, h: nh, text: text.trim() }]);
      }
      setDraft(null);
      return;
    }
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
        setSelectedIds(new Set());
        return;
      }
      // Cmd/Ctrl+A - select all
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(strokes.map((s) => s.id)));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        const arr = yArrayRef.current;
        if (!arr) return;
        e.preventDefault();
        arr.doc?.transact(() => {
          // Delete in descending order so indices remain valid mid-transaction.
          const toRemove: number[] = [];
          arr.toArray().forEach((s, i) => {
            if (selectedIds.has(s.id)) toRemove.push(i);
          });
          for (let i = toRemove.length - 1; i >= 0; i--) arr.delete(toRemove[i]!, 1);
        });
        setSelectedIds(new Set());
        return;
      }
      if (selectedIds.size > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const arr = yArrayRef.current;
        if (!arr) return;
        arr.doc?.transact(() => {
          const cur = arr.toArray();
          for (let i = 0; i < cur.length; i++) {
            const s = cur[i]!;
            if (!selectedIds.has(s.id)) continue;
            const next = libMoveStroke(s, dx, dy) as Stroke;
            arr.delete(i, 1);
            arr.insert(i, [next]);
          }
        });
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
  }, [active, selectedIds, strokes]);

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
        // Cap per-event delta - browsers report ±100 for mouse wheel clicks,
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
    if (tool === 'select') {
      // Single-selection resize: handle hit on the lone selected stroke
      if (selectedId) {
        const sel = strokes.find((s) => s.id === selectedId);
        if (sel) {
          const handle = hitHandle(sel, x, y, 8 / Math.max(0.5, viewportRef.current.zoom));
          if (handle) {
            dragRef.current = { kind: 'resize', handle, baseStroke: sel };
            return;
          }
        }
      }
      const idx = libHitStrokeIdx(strokes, x, y);
      if (idx >= 0) {
        const hit = strokes[idx];
        let nextSet: Set<string>;
        if (e.shiftKey) {
          // shift-click: toggle hit in/out of selection
          nextSet = new Set(selectedIds);
          if (nextSet.has(hit.id)) nextSet.delete(hit.id);
          else nextSet.add(hit.id);
        } else if (selectedIds.has(hit.id)) {
          // clicked already-selected stroke → keep selection, prepare to move whole group
          nextSet = new Set(selectedIds);
        } else {
          nextSet = new Set([hit.id]);
        }
        setSelectedIds(nextSet);
        const baseStrokes = strokes.filter((s) => nextSet.has(s.id));
        dragRef.current = { kind: 'move', startX: x, startY: y, baseStrokes };
      } else if (e.shiftKey) {
        // shift-click empty: don't deselect, don't start marquee
      } else {
        // empty click: start marquee
        setSelectedIds(new Set());
        setMarquee({ x, y, w: 0, h: 0 });
        dragRef.current = { kind: 'marquee', startX: x, startY: y };
      }
      return;
    }
    if (tool === 'pen') {
      setDraft({ id: rid(), kind: 'pen', color, sw: strokeWidth, points: [[x, y]] });
    } else if (tool === 'rect') {
      setDraft({ id: rid(), kind: 'rect', color, sw: strokeWidth, x, y, w: 0, h: 0 });
    } else if (tool === 'ellipse') {
      setDraft({ id: rid(), kind: 'ellipse', color, sw: strokeWidth, cx: x, cy: y, rx: 0, ry: 0 });
    } else if (tool === 'arrow') {
      setDraft({ id: rid(), kind: 'arrow', color, sw: strokeWidth, x1: x, y1: y, x2: x, y2: y });
    } else if (tool === 'note') {
      setDraft({ id: rid(), kind: 'note', color, x, y, w: 0, h: 0, text: '' });
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
    // Broadcast our canvas-cursor at ~50ms throttle so peers can see us
    // hovering even when we're not drawing. canvasCursor in PresenceUser
    // doubles as our liveness indicator on the whiteboard.
    const now = Date.now();
    if (now - lastCanvasCursorSendRef.current > 50) {
      lastCanvasCursorSendRef.current = now;
      const [wx, wy] = pos(e);
      client.setSelfPresence({ canvasCursor: { x: wx, y: wy } });
    }
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      panRef.current.lastX = e.clientX;
      panRef.current.lastY = e.clientY;
      setViewport((vp) => ({ ...vp, x: vp.x - dx, y: vp.y - dy }));
      return;
    }
    // Select-tool drag: live-update the selected stroke(s) in Yjs (single tx
    // per pointer move; UndoManager bundles via captureTimeout=250).
    if (tool === 'select' && dragRef.current) {
      const drag = dragRef.current;
      const [x, y] = pos(e);
      const arr = yArrayRef.current;
      if (!arr) return;
      if (drag.kind === 'marquee') {
        setMarquee({
          x: Math.min(drag.startX, x),
          y: Math.min(drag.startY, y),
          w: Math.abs(x - drag.startX),
          h: Math.abs(y - drag.startY),
        });
        return;
      }
      if (drag.kind === 'resize') {
        const idx = arr.toArray().findIndex((s) => s.id === drag.baseStroke.id);
        if (idx < 0) return;
        const next = libResizeStroke(drag.baseStroke, drag.handle, x, y) as Stroke;
        arr.doc?.transact(() => {
          arr.delete(idx, 1);
          arr.insert(idx, [next]);
        });
        return;
      }
      // move (one or many): single Yjs transaction for the whole group
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      arr.doc?.transact(() => {
        const cur = arr.toArray();
        for (const base of drag.baseStrokes) {
          const idx = cur.findIndex((s) => s.id === base.id);
          if (idx < 0) continue;
          const next = libMoveStroke(base, dx, dy) as Stroke;
          arr.delete(idx, 1);
          arr.insert(idx, [next]);
        }
      });
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
    } else if (draft.kind === 'note') {
      setDraft({ ...draft, w: x - draft.x, h: y - draft.y });
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
    if (dragRef.current) {
      // Marquee finalizes selection: every stroke whose bbox intersects the
      // rubber-band is added to the selection set.
      if (dragRef.current.kind === 'marquee' && marquee && (marquee.w > 2 || marquee.h > 2)) {
        const mx1 = marquee.x;
        const my1 = marquee.y;
        const mx2 = marquee.x + marquee.w;
        const my2 = marquee.y + marquee.h;
        const next = new Set<string>();
        for (const s of strokes) {
          const b = strokeBounds(s);
          // bbox intersection test
          if (b.maxX < mx1 || b.minX > mx2 || b.maxY < my1 || b.minY > my2) continue;
          next.add(s.id);
        }
        setSelectedIds(next);
      }
      setMarquee(null);
      dragRef.current = null;
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
        <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`size-5 rounded-full ring-1 ${
                color === c ? 'ring-primary scale-110' : 'ring-line'
              } transition-transform`}
              style={{ backgroundColor: c }}
              aria-label={`color ${c}`}
              title={c}
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
            title="Undo (CmdZ)"
            aria-label="Undo"
          >
            <UndoIcon />
          </button>
          <button
            onClick={() => undoMgrRef.current?.redo()}
            className="btn-ghost !px-2 !py-1 text-secondary"
            title="Redo (⇧CmdZ)"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
          <div className="mx-1 h-5 w-px bg-line" />
          <button
            onClick={() => {
              const filename = `pad-${effectiveSlug || 'canvas'}-${new Date().toISOString().slice(0, 10)}.svg`;
              exportSVG(strokes as Stroke[], filename);
            }}
            className="btn-ghost !px-2 !py-1 text-subtle hover:text-primary"
            title="Export SVG"
          >
            SVG
          </button>
          <button
            onClick={() => {
              const filename = `pad-${effectiveSlug || 'canvas'}-${new Date().toISOString().slice(0, 10)}.png`;
              void exportPNG(strokes as Stroke[], filename);
            }}
            className="btn-ghost !px-2 !py-1 text-subtle hover:text-primary"
            title="Export PNG"
          >
            PNG
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
              {(() => {
                // Viewport culling - skip strokes whose bbox is fully off-screen.
                // World-coord visible bounds = viewport.x..(viewport.x+w/z) etc.
                // Use clientWidth/Height so we don't recompute layout on every
                // render; svgRef may be null pre-mount (return full list).
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) {
                  return strokes.map((s) => <StrokeShape key={s.id} stroke={s} />);
                }
                const z = Math.max(0.1, viewport.zoom);
                const visible = {
                  minX: viewport.x / z,
                  minY: viewport.y / z,
                  maxX: (viewport.x + rect.width) / z,
                  maxY: (viewport.y + rect.height) / z,
                };
                const margin = 200 / z;
                return strokes
                  .filter((s) => inViewport(strokeBounds(s), visible, margin))
                  .map((s) => <StrokeShape key={s.id} stroke={s} />);
              })()}
              {draft && <StrokeShape stroke={draft} />}
              {selectedIds.size > 0 && tool === 'select' && (() => {
                const selectedStrokes = strokes.filter((s) => selectedIds.has(s.id));
                if (selectedStrokes.length === 0) return null;
                const handleSize = Math.max(6, 8 / Math.max(0.5, viewport.zoom));
                if (selectedStrokes.length === 1) {
                  const sel = selectedStrokes[0]!;
                  const b = strokeBounds(sel);
                  const handles = handlesFor(sel);
                  return (
                    <g pointerEvents="none">
                      <rect
                        x={b.minX}
                        y={b.minY}
                        width={b.maxX - b.minX}
                        height={b.maxY - b.minY}
                        fill="none"
                        stroke="#60a5fa"
                        strokeWidth={1.5 / Math.max(0.5, viewport.zoom)}
                        strokeDasharray={`${4 / Math.max(0.5, viewport.zoom)} ${3 / Math.max(0.5, viewport.zoom)}`}
                      />
                      {handles.map((h) => (
                        <rect
                          key={h.name}
                          x={h.x - handleSize / 2}
                          y={h.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          fill="#60a5fa"
                          stroke="#ffffff"
                          strokeWidth={1 / Math.max(0.5, viewport.zoom)}
                        />
                      ))}
                    </g>
                  );
                }
                // Multi-selection: union bbox, no per-stroke handles
                const u = selectedStrokes.map(strokeBounds).reduce<typeof selectedStrokes[number] extends never ? null : { minX: number; minY: number; maxX: number; maxY: number } | null>((acc, b) => {
                  if (!acc) return b;
                  return {
                    minX: Math.min(acc.minX, b.minX),
                    minY: Math.min(acc.minY, b.minY),
                    maxX: Math.max(acc.maxX, b.maxX),
                    maxY: Math.max(acc.maxY, b.maxY),
                  };
                }, null);
                if (!u) return null;
                return (
                  <g pointerEvents="none">
                    {/* per-stroke faint outlines */}
                    {selectedStrokes.map((s) => {
                      const b = strokeBounds(s);
                      return (
                        <rect
                          key={s.id}
                          x={b.minX}
                          y={b.minY}
                          width={b.maxX - b.minX}
                          height={b.maxY - b.minY}
                          fill="#60a5fa18"
                          stroke="#60a5fa"
                          strokeWidth={1 / Math.max(0.5, viewport.zoom)}
                          strokeDasharray={`${2 / Math.max(0.5, viewport.zoom)} ${2 / Math.max(0.5, viewport.zoom)}`}
                        />
                      );
                    })}
                    {/* union outline */}
                    <rect
                      x={u.minX}
                      y={u.minY}
                      width={u.maxX - u.minX}
                      height={u.maxY - u.minY}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={1.5 / Math.max(0.5, viewport.zoom)}
                    />
                  </g>
                );
              })()}
              {remoteCursors.map((u) => {
                if (!u.canvasCursor) return null;
                return (
                  <g key={u.userId} pointerEvents="none">
                    <circle
                      cx={u.canvasCursor.x}
                      cy={u.canvasCursor.y}
                      r={6 / Math.max(0.5, viewport.zoom)}
                      fill={u.color}
                      stroke="#ffffff"
                      strokeWidth={1.5 / Math.max(0.5, viewport.zoom)}
                    />
                    <rect
                      x={u.canvasCursor.x + 10 / Math.max(0.5, viewport.zoom)}
                      y={u.canvasCursor.y - 8 / Math.max(0.5, viewport.zoom)}
                      width={u.name.length * 7 / Math.max(0.5, viewport.zoom) + 8 / Math.max(0.5, viewport.zoom)}
                      height={16 / Math.max(0.5, viewport.zoom)}
                      rx={3 / Math.max(0.5, viewport.zoom)}
                      fill={u.color}
                      opacity={0.92}
                    />
                    <text
                      x={u.canvasCursor.x + 14 / Math.max(0.5, viewport.zoom)}
                      y={u.canvasCursor.y + 3 / Math.max(0.5, viewport.zoom)}
                      fill="#ffffff"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                      fontSize={11 / Math.max(0.5, viewport.zoom)}
                      fontWeight={600}
                    >
                      {u.name}
                    </text>
                  </g>
                );
              })}
              {marquee && tool === 'select' && (
                <rect
                  pointerEvents="none"
                  x={marquee.x}
                  y={marquee.y}
                  width={marquee.w}
                  height={marquee.h}
                  fill="#60a5fa20"
                  stroke="#60a5fa"
                  strokeWidth={1 / Math.max(0.5, viewport.zoom)}
                  strokeDasharray={`${3 / Math.max(0.5, viewport.zoom)} ${2 / Math.max(0.5, viewport.zoom)}`}
                />
              )}
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
                <span className="kbd">CmdZ</span> undo
              </p>
              <p className="text-xs mt-1">
                Navigate: <span className="kbd">space</span>+drag or middle-click pan ·{' '}
                <span className="kbd">Cmd</span>+scroll zoom
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
      // Catmull-Rom spline → smoother than the old line-list for hand-drawn paths.
      const d = catmullRomPath(s.points);
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
    case 'note': {
      const x = Math.min(s.x, s.x + s.w);
      const y = Math.min(s.y, s.y + s.h);
      const w = Math.abs(s.w);
      const h = Math.abs(s.h);
      const pad = 8;
      const lines = wrapNoteText(s.text, w - pad * 2, 14);
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={s.color}
            fillOpacity={0.18}
            stroke={s.color}
            strokeWidth={1.5}
            rx={6}
          />
          {lines.map((line, i) => (
            <text
              key={i}
              x={x + pad}
              y={y + pad + 14 + i * 16}
              fill={s.color}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize={13}
              style={{ pointerEvents: 'none' }}
            >
              {line}
            </text>
          ))}
        </g>
      );
    }
  }
}

// Crude word-wrap for sticky-note text. Pure char-width estimate; close enough
// for short notes. Strips overflow lines so tall notes don't bleed past bbox.
function wrapNoteText(text: string, maxWidth: number, charPx: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  const maxChars = Math.max(1, Math.floor(maxWidth / Math.max(1, charPx * 0.55)));
  for (const w of words) {
    const test = current ? current + ' ' + w : w;
    if (test.length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
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
    } else if (s.kind === 'note') {
      const minX = Math.min(s.x, s.x + s.w);
      const minY = Math.min(s.y, s.y + s.h);
      const maxX = Math.max(s.x, s.x + s.w);
      const maxY = Math.max(s.y, s.y + s.h);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
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
    } else if (s.kind === 'note') {
      grow(Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h));
      grow(Math.max(s.x, s.x + s.w), Math.max(s.y, s.y + s.h));
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
        title="Zoom out (Cmd−)"
        aria-label="Zoom out"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        onClick={onReset}
        className="px-1.5 py-0.5 rounded text-secondary hover:bg-hover hover:text-primary tabular-nums min-w-[3.5rem]"
        title="Reset zoom (Cmd0)"
        aria-label="Reset zoom"
      >
        {pct}%
      </button>
      <button
        onClick={onZoomIn}
        className="inline-flex items-center justify-center size-7 rounded text-secondary hover:bg-hover hover:text-primary"
        title="Zoom in (Cmd+)"
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

// Icons - kept inline so the bundle doesn't grow for one component.
function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="14" y2="12" />
      <line x1="8" y1="16" x2="12" y2="16" />
    </svg>
  );
}

function SelectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l7 18 2-8 8-2z" />
    </svg>
  );
}

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
