import { describe, expect, it } from 'vitest';
import {
  rdpSimplify,
  catmullRomPath,
  inViewport,
  type Point,
} from './canvas-smooth';

describe('canvas-smooth: rdpSimplify', () => {
  it('returns input when length < 3', () => {
    expect(rdpSimplify([], 1)).toEqual([]);
    expect(rdpSimplify([[0, 0]], 1)).toEqual([[0, 0]]);
    expect(rdpSimplify([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
  });

  it('drops collinear middle points', () => {
    const pts: Point[] = [[0, 0], [5, 5], [10, 10]];
    const out = rdpSimplify(pts, 0.1);
    expect(out).toEqual([[0, 0], [10, 10]]);
  });

  it('keeps points beyond epsilon', () => {
    const pts: Point[] = [[0, 0], [5, 5], [5, 0], [10, 0]];
    const out = rdpSimplify(pts, 1);
    // (5,5) is far from the line (0,0)-(10,0); keep it.
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
  });

  it('always preserves first and last points', () => {
    const pts: Point[] = [];
    for (let i = 0; i < 100; i++) pts.push([i, Math.sin(i * 0.1) * 0.01]);
    const out = rdpSimplify(pts, 5);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('reduces point count for noisy near-line input', () => {
    const pts: Point[] = [];
    for (let i = 0; i < 200; i++) pts.push([i, (Math.random() - 0.5) * 0.5]);
    const out = rdpSimplify(pts, 1);
    expect(out.length).toBeLessThan(pts.length);
  });
});

describe('canvas-smooth: catmullRomPath', () => {
  it('returns empty for 0 points', () => {
    expect(catmullRomPath([])).toBe('');
  });
  it('returns Move for 1 point', () => {
    expect(catmullRomPath([[5, 7]])).toBe('M 5 7');
  });
  it('returns Move+Line for 2 points', () => {
    expect(catmullRomPath([[0, 0], [10, 10]])).toBe('M 0 0 L 10 10');
  });
  it('emits cubic Bezier curves for 3+ points', () => {
    const path = catmullRomPath([[0, 0], [5, 5], [10, 0]]);
    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path).toMatch(/C /);
  });
});

describe('canvas-smooth: inViewport', () => {
  const vp = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  it('matches fully-contained bbox', () => {
    expect(inViewport({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, vp)).toBe(true);
  });
  it('matches partial overlap', () => {
    expect(inViewport({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, vp)).toBe(true);
  });
  it('rejects fully-outside bbox', () => {
    expect(inViewport({ minX: 200, minY: 0, maxX: 300, maxY: 100 }, vp)).toBe(false);
  });
  it('honors margin', () => {
    const b = { minX: 150, minY: 0, maxX: 160, maxY: 10 };
    expect(inViewport(b, vp, 0)).toBe(false);
    expect(inViewport(b, vp, 100)).toBe(true);
  });
});
