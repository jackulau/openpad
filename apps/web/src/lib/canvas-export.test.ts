import { describe, expect, it } from 'vitest';
import { toSVG } from './canvas-export';
import type { Stroke } from './canvas-hit';

const rect = (overrides: Partial<Extract<Stroke, { kind: 'rect' }>> = {}): Stroke => ({
  id: 'r',
  kind: 'rect',
  color: '#f87171',
  sw: 2,
  x: 10,
  y: 20,
  w: 30,
  h: 40,
  ...overrides,
});

describe('canvas-export: toSVG', () => {
  it('emits empty 100x100 svg for empty strokes', () => {
    const out = toSVG([]);
    expect(out).toContain('<svg');
    expect(out).toContain('viewBox="0 0 100 100"');
  });

  it('emits a single shape and wraps with viewBox at union bbox', () => {
    const out = toSVG([rect()]);
    expect(out).toContain('<rect');
    expect(out).toMatch(/viewBox="-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?"/);
    // viewBox should include the stroke + 24px margin
    expect(out).toContain('viewBox="-14 -4 78 88"');
  });

  it('escapes special characters in text strokes', () => {
    const text: Stroke = { id: 't', kind: 'text', color: '#fff', x: 0, y: 0, text: '<script>x' };
    const out = toSVG([text]);
    expect(out).toContain('&lt;script&gt;x');
    expect(out).not.toContain('<script>x');
  });

  it('renders all stroke kinds without throwing', () => {
    const all: Stroke[] = [
      { id: 'p', kind: 'pen', color: '#fff', sw: 2, points: [[0, 0], [10, 10], [20, 0]] },
      { id: 'r', kind: 'rect', color: '#fff', sw: 2, x: 0, y: 0, w: 50, h: 50 },
      { id: 'e', kind: 'ellipse', color: '#fff', sw: 2, cx: 100, cy: 50, rx: 20, ry: 10 },
      { id: 'a', kind: 'arrow', color: '#fff', sw: 2, x1: 0, y1: 0, x2: 50, y2: 50 },
      { id: 't', kind: 'text', color: '#fff', x: 0, y: 0, text: 'hello' },
      { id: 'n', kind: 'note', color: '#fbbf24', x: 0, y: 100, w: 80, h: 40, text: 'note text' },
    ];
    const out = toSVG(all);
    expect(out).toContain('<path');
    expect(out).toContain('<rect');
    expect(out).toContain('<ellipse');
    expect(out).toContain('<line');
    expect(out).toContain('hello');
    expect(out).toContain('note text');
  });

  it('honors background option', () => {
    const out = toSVG([rect()], { background: '#0a0a0a' });
    expect(out).toContain('fill="#0a0a0a"');
  });
});
