import { describe, expect, it } from 'vitest';
import {
  type Stroke,
  strokeBounds,
  unionBounds,
  handlesFor,
  hitHandle,
  hitStrokeIdx,
  moveStroke,
  resizeStroke,
} from './canvas-hit';

const rect = (overrides: Partial<Extract<Stroke, { kind: 'rect' }>> = {}): Stroke => ({
  id: 'r1',
  kind: 'rect',
  color: '#fff',
  sw: 2,
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  ...overrides,
});
const ellipse = (o: Partial<Extract<Stroke, { kind: 'ellipse' }>> = {}): Stroke => ({
  id: 'e1',
  kind: 'ellipse',
  color: '#fff',
  sw: 2,
  cx: 50,
  cy: 50,
  rx: 30,
  ry: 20,
  ...o,
});
const arrow = (o: Partial<Extract<Stroke, { kind: 'arrow' }>> = {}): Stroke => ({
  id: 'a1',
  kind: 'arrow',
  color: '#fff',
  sw: 2,
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 100,
  ...o,
});
const pen = (points: Array<[number, number]>): Stroke => ({
  id: 'p1',
  kind: 'pen',
  color: '#fff',
  sw: 2,
  points,
});

describe('canvas-hit: strokeBounds', () => {
  it('rect bounds normalize when w/h negative', () => {
    const b = strokeBounds(rect({ x: 100, y: 100, w: -50, h: -50 }));
    expect(b).toEqual({ minX: 50, minY: 50, maxX: 100, maxY: 100 });
  });
  it('ellipse bounds use cx±rx', () => {
    const b = strokeBounds(ellipse({ cx: 100, cy: 50, rx: 20, ry: 10 }));
    expect(b).toEqual({ minX: 80, minY: 40, maxX: 120, maxY: 60 });
  });
  it('arrow bounds span min/max of endpoints', () => {
    const b = strokeBounds(arrow({ x1: 100, y1: 50, x2: 20, y2: 70 }));
    expect(b).toEqual({ minX: 20, minY: 50, maxX: 100, maxY: 70 });
  });
  it('pen bounds tight around point set', () => {
    const b = strokeBounds(pen([[10, 10], [30, 20], [20, 5]]));
    expect(b).toEqual({ minX: 10, minY: 5, maxX: 30, maxY: 20 });
  });
});

describe('canvas-hit: unionBounds', () => {
  it('returns null for empty input', () => {
    expect(unionBounds([])).toBeNull();
  });
  it('grows to cover all', () => {
    const u = unionBounds([
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 5, minY: -5, maxX: 20, maxY: 15 },
    ]);
    expect(u).toEqual({ minX: 0, minY: -5, maxX: 20, maxY: 15 });
  });
});

describe('canvas-hit: handlesFor', () => {
  it('rect has 8 bbox handles', () => {
    const h = handlesFor(rect());
    expect(h).toHaveLength(8);
    expect(h.map((p) => p.name).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });
  it('arrow has 2 endpoint handles at (x1,y1) and (x2,y2)', () => {
    const h = handlesFor(arrow({ x1: 5, y1: 7, x2: 15, y2: 17 }));
    expect(h).toEqual([
      { name: 'start', x: 5, y: 7 },
      { name: 'end', x: 15, y: 17 },
    ]);
  });
});

describe('canvas-hit: hitHandle', () => {
  it('returns matching handle when point near it', () => {
    expect(hitHandle(rect(), 12, 22)).toBe('nw'); // near (10, 20)
    expect(hitHandle(rect(), 110, 70)).toBe('se');
  });
  it('returns null when not near any handle', () => {
    expect(hitHandle(rect(), 50, 40)).toBeNull(); // body, not handle
  });
});

describe('canvas-hit: hitStrokeIdx', () => {
  it('returns topmost stroke under point', () => {
    const strokes = [rect({ id: 'a' }), rect({ id: 'b' })];
    // top of stack is index 1; both rects overlap at (50,40) → returns 1
    expect(hitStrokeIdx(strokes, 50, 40)).toBe(1);
  });
  it('returns -1 when point misses all strokes', () => {
    expect(hitStrokeIdx([rect()], -500, -500)).toBe(-1);
  });
  it('hits ellipse only inside its radius', () => {
    expect(hitStrokeIdx([ellipse({ cx: 0, cy: 0, rx: 10, ry: 10 })], 5, 5)).toBe(0);
    expect(hitStrokeIdx([ellipse({ cx: 0, cy: 0, rx: 10, ry: 10 })], 20, 0)).toBe(-1);
  });
});

describe('canvas-hit: moveStroke', () => {
  it('translates rect by delta', () => {
    const m = moveStroke(rect({ x: 10, y: 20 }), 5, -3) as Extract<Stroke, { kind: 'rect' }>;
    expect(m.x).toBe(15);
    expect(m.y).toBe(17);
  });
  it('translates every pen point', () => {
    const m = moveStroke(pen([[0, 0], [10, 10]]), 100, 200) as Extract<Stroke, { kind: 'pen' }>;
    expect(m.points).toEqual([
      [100, 200],
      [110, 210],
    ]);
  });
  it('translates arrow endpoints together', () => {
    const m = moveStroke(arrow({ x1: 0, y1: 0, x2: 10, y2: 10 }), 5, 5) as Extract<Stroke, { kind: 'arrow' }>;
    expect(m.x1).toBe(5);
    expect(m.y2).toBe(15);
  });
});

describe('canvas-hit: resizeStroke', () => {
  it('rect se handle keeps origin fixed and moves opposite corner', () => {
    const r = resizeStroke(rect({ x: 10, y: 20, w: 100, h: 50 }), 'se', 200, 100) as Extract<
      Stroke,
      { kind: 'rect' }
    >;
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.w).toBe(190);
    expect(r.h).toBe(80);
  });
  it('rect nw handle moves origin', () => {
    const r = resizeStroke(rect({ x: 10, y: 20, w: 100, h: 50 }), 'nw', 0, 0) as Extract<
      Stroke,
      { kind: 'rect' }
    >;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(110);
    expect(r.h).toBe(70);
  });
  it('arrow start handle moves only the start point', () => {
    const a = resizeStroke(arrow({ x1: 0, y1: 0, x2: 100, y2: 100 }), 'start', 50, 50) as Extract<
      Stroke,
      { kind: 'arrow' }
    >;
    expect(a.x1).toBe(50);
    expect(a.y1).toBe(50);
    expect(a.x2).toBe(100);
    expect(a.y2).toBe(100);
  });
  it('ellipse resize updates cx/cy/rx/ry', () => {
    const e = resizeStroke(ellipse({ cx: 50, cy: 50, rx: 30, ry: 20 }), 'se', 100, 80) as Extract<
      Stroke,
      { kind: 'ellipse' }
    >;
    // new bbox = (20..100, 30..80) → cx=60, cy=55, rx=40, ry=25
    expect(e.cx).toBe(60);
    expect(e.cy).toBe(55);
    expect(e.rx).toBe(40);
    expect(e.ry).toBe(25);
  });
});
