// Pure geometry helpers for the whiteboard canvas: stroke bbox, hit-test,
// resize-handle hit detection, move/resize transforms. Kept side-effect-free
// so they can be exercised by unit tests without React + SVG.

export type Stroke =
  | { id: string; kind: 'pen'; color: string; sw: number; points: Array<[number, number]> }
  | { id: string; kind: 'rect'; color: string; sw: number; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'ellipse'; color: string; sw: number; cx: number; cy: number; rx: number; ry: number }
  | { id: string; kind: 'arrow'; color: string; sw: number; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'text'; color: string; x: number; y: number; text: string }
  | { id: string; kind: 'note'; color: string; x: number; y: number; w: number; h: number; text: string };

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type HandleName =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'start'
  | 'end';

export interface Handle {
  name: HandleName;
  x: number;
  y: number;
}

export function strokeBounds(s: Stroke): Bounds {
  if (s.kind === 'pen') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of s.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }
  if (s.kind === 'rect') {
    return {
      minX: Math.min(s.x, s.x + s.w),
      minY: Math.min(s.y, s.y + s.h),
      maxX: Math.max(s.x, s.x + s.w),
      maxY: Math.max(s.y, s.y + s.h),
    };
  }
  if (s.kind === 'ellipse') {
    return {
      minX: s.cx - Math.abs(s.rx),
      minY: s.cy - Math.abs(s.ry),
      maxX: s.cx + Math.abs(s.rx),
      maxY: s.cy + Math.abs(s.ry),
    };
  }
  if (s.kind === 'arrow') {
    return {
      minX: Math.min(s.x1, s.x2),
      minY: Math.min(s.y1, s.y2),
      maxX: Math.max(s.x1, s.x2),
      maxY: Math.max(s.y1, s.y2),
    };
  }
  if (s.kind === 'note') {
    return {
      minX: Math.min(s.x, s.x + s.w),
      minY: Math.min(s.y, s.y + s.h),
      maxX: Math.max(s.x, s.x + s.w),
      maxY: Math.max(s.y, s.y + s.h),
    };
  }
  // text: width ~ length * 9, height ~ 18 - coarse but good enough for select
  const w = s.text.length * 9;
  return { minX: s.x - 4, minY: s.y - 18, maxX: s.x + w, maxY: s.y + 4 };
}

export function unionBounds(items: Bounds[]): Bounds | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of items) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// Returns the 8 bbox handles (or 2 endpoint handles for arrows).
export function handlesFor(s: Stroke): Handle[] {
  if (s.kind === 'arrow') {
    return [
      { name: 'start', x: s.x1, y: s.y1 },
      { name: 'end', x: s.x2, y: s.y2 },
    ];
  }
  const b = strokeBounds(s);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return [
    { name: 'nw', x: b.minX, y: b.minY },
    { name: 'n', x: cx, y: b.minY },
    { name: 'ne', x: b.maxX, y: b.minY },
    { name: 'e', x: b.maxX, y: cy },
    { name: 'se', x: b.maxX, y: b.maxY },
    { name: 's', x: cx, y: b.maxY },
    { name: 'sw', x: b.minX, y: b.maxY },
    { name: 'w', x: b.minX, y: cy },
  ];
}

// Returns the matching handle if the click point falls within `radius` of any
// handle for the given stroke, else null.
export function hitHandle(s: Stroke, px: number, py: number, radius = 8): HandleName | null {
  for (const h of handlesFor(s)) {
    if (Math.hypot(px - h.x, py - h.y) <= radius) return h.name;
  }
  return null;
}

// Returns the index of the topmost stroke whose body (not handle) contains
// the click point, or -1 if none match. `pad` widens the hit area by N px so
// thin lines remain clickable.
export function hitStrokeIdx(strokes: Stroke[], x: number, y: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    const pad = ('sw' in s ? s.sw : 6) + 4;
    if (s.kind === 'pen') {
      for (const [px, py] of s.points) {
        if (Math.hypot(x - px, y - py) < pad) return i;
      }
    } else if (s.kind === 'rect') {
      const b = strokeBounds(s);
      if (x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad) return i;
    } else if (s.kind === 'ellipse') {
      const dx = (x - s.cx) / Math.max(1, s.rx);
      const dy = (y - s.cy) / Math.max(1, s.ry);
      if (dx * dx + dy * dy <= 1.2) return i;
    } else if (s.kind === 'arrow') {
      if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < pad) return i;
    } else if (s.kind === 'text' || s.kind === 'note') {
      const b = strokeBounds(s);
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return i;
    }
  }
  return -1;
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Translate every coordinate in the stroke by (dx, dy). Pure - returns a new
// stroke with the same id.
export function moveStroke(s: Stroke, dx: number, dy: number): Stroke {
  if (s.kind === 'pen') {
    return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
  if (s.kind === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.kind === 'ellipse') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.kind === 'arrow') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (s.kind === 'note') return { ...s, x: s.x + dx, y: s.y + dy };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

// Resize a rect/ellipse/text by dragging one of its 8 handles to (nx, ny).
// `original` is the bbox at drag start (anchor opposite corner stays fixed).
// Arrows use 'start' / 'end' handles to move that endpoint.
export function resizeStroke(s: Stroke, handle: HandleName, nx: number, ny: number): Stroke {
  if (s.kind === 'arrow') {
    if (handle === 'start') return { ...s, x1: nx, y1: ny };
    if (handle === 'end') return { ...s, x2: nx, y2: ny };
    return s;
  }
  const b = strokeBounds(s);
  let minX = b.minX;
  let minY = b.minY;
  let maxX = b.maxX;
  let maxY = b.maxY;
  if (handle.includes('w')) minX = nx;
  if (handle.includes('e')) maxX = nx;
  if (handle.includes('n')) minY = ny;
  if (handle.includes('s')) maxY = ny;
  // normalize if user dragged past opposite edge
  if (minX > maxX) [minX, maxX] = [maxX, minX];
  if (minY > maxY) [minY, maxY] = [maxY, minY];

  if (s.kind === 'rect') return { ...s, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (s.kind === 'ellipse')
    return {
      ...s,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: (maxX - minX) / 2,
      ry: (maxY - minY) / 2,
    };
  if (s.kind === 'pen') {
    // scale pen points proportionally into the new bbox
    const oldW = b.maxX - b.minX || 1;
    const oldH = b.maxY - b.minY || 1;
    const newW = maxX - minX;
    const newH = maxY - minY;
    return {
      ...s,
      points: s.points.map(([x, y]) => [
        minX + ((x - b.minX) / oldW) * newW,
        minY + ((y - b.minY) / oldH) * newH,
      ] as [number, number]),
    };
  }
  if (s.kind === 'note') {
    return { ...s, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  // text: leave size unchanged on resize; just move origin
  return { ...s, x: minX, y: maxY };
}
