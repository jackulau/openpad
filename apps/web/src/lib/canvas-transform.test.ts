import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitToBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
} from './canvas-transform';

const rect = { left: 0, top: 0 };

describe('clampZoom', () => {
  it('returns input when within range', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(3)).toBe(3);
  });
  it('clamps to MIN_ZOOM / MAX_ZOOM', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(9999)).toBe(MAX_ZOOM);
  });
  it('falls back to 1 on NaN', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(MAX_ZOOM);
  });
});

describe('screenToWorld', () => {
  it('is identity at zoom=1, viewport=0', () => {
    const [wx, wy] = screenToWorld(100, 50, rect, { x: 0, y: 0, zoom: 1 });
    expect(wx).toBe(100);
    expect(wy).toBe(50);
  });

  it('accounts for rect offset', () => {
    const [wx, wy] = screenToWorld(150, 80, { left: 50, top: 30 }, { x: 0, y: 0, zoom: 1 });
    expect(wx).toBe(100);
    expect(wy).toBe(50);
  });

  it('scales by zoom and shifts by viewport', () => {
    // viewport.x=100 means we've scrolled 100 screen-px to the right at zoom=1;
    // at zoom=2 the world is 2× bigger, so a screen point divides by zoom after offset.
    const [wx, wy] = screenToWorld(200, 100, rect, { x: 100, y: 50, zoom: 2 });
    expect(wx).toBe((200 + 100) / 2);
    expect(wy).toBe((100 + 50) / 2);
  });
});

describe('worldToScreen', () => {
  it('is identity at zoom=1, viewport=0, rect=0', () => {
    const [sx, sy] = worldToScreen(100, 50, rect, { x: 0, y: 0, zoom: 1 });
    expect(sx).toBe(100);
    expect(sy).toBe(50);
  });

  it('is the inverse of screenToWorld', () => {
    const vp = { x: 73, y: -41, zoom: 1.7 };
    const r = { left: 12, top: 5 };
    const [wx, wy] = screenToWorld(250, 175, r, vp);
    const [sx, sy] = worldToScreen(wx, wy, r, vp);
    expect(sx).toBeCloseTo(250);
    expect(sy).toBeCloseTo(175);
  });
});

describe('zoomAtPoint (cursor-centered)', () => {
  it('keeps the world point under the cursor fixed', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const anchorX = 300;
    const anchorY = 200;
    const [wxBefore, wyBefore] = screenToWorld(anchorX, anchorY, rect, vp);
    const next = zoomAtPoint(vp, 2.5, anchorX, anchorY, rect);
    const [wxAfter, wyAfter] = screenToWorld(anchorX, anchorY, rect, next);
    expect(wxAfter).toBeCloseTo(wxBefore);
    expect(wyAfter).toBeCloseTo(wyBefore);
  });

  it('clamps to MIN_ZOOM/MAX_ZOOM', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const tooHigh = zoomAtPoint(vp, 9999, 100, 100, rect);
    expect(tooHigh.zoom).toBe(MAX_ZOOM);
    const tooLow = zoomAtPoint(vp, 0.0001, 100, 100, rect);
    expect(tooLow.zoom).toBe(MIN_ZOOM);
  });

  it('returns same viewport when zoom unchanged', () => {
    const vp = { x: 10, y: 20, zoom: 1.5 };
    const next = zoomAtPoint(vp, 1.5, 50, 50, rect);
    expect(next).toBe(vp);
  });

  it('preserves cursor anchor across rect offset', () => {
    const vp = { x: 50, y: 25, zoom: 1.2 };
    const r = { left: 100, top: 60 };
    const anchorX = 400;
    const anchorY = 300;
    const [wxBefore] = screenToWorld(anchorX, anchorY, r, vp);
    const [wyBefore] = [screenToWorld(anchorX, anchorY, r, vp)[1]];
    const next = zoomAtPoint(vp, 0.5, anchorX, anchorY, r);
    const [wxAfter, wyAfter] = screenToWorld(anchorX, anchorY, r, next);
    expect(wxAfter).toBeCloseTo(wxBefore);
    expect(wyAfter).toBeCloseTo(wyBefore);
  });
});

describe('fitToBounds', () => {
  it('returns reset viewport for null bounds', () => {
    expect(fitToBounds(null, 800, 600)).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('centers bounds inside the viewport', () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const vp = fitToBounds(bounds, 800, 600, 40);
    // Bounding box center should land at viewport center
    const cx = 100;
    const cy = 50;
    const [sx, sy] = worldToScreen(cx, cy, { left: 0, top: 0 }, vp);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  it('zooms to fit larger of two axes', () => {
    // Wide bounds should be zoomed by width ratio
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 100 };
    const vp = fitToBounds(bounds, 800, 600, 40);
    const innerW = 800 - 80;
    expect(vp.zoom).toBeCloseTo(innerW / 2000);
  });

  it('clamps zoom when content is tiny relative to viewport', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const vp = fitToBounds(bounds, 800, 600, 40);
    expect(vp.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });
});
