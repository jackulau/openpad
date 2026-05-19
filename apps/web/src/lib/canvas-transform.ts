export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(z: number): number {
  if (Number.isNaN(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function screenToWorld(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  viewport: Viewport,
): [number, number] {
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return [(sx + viewport.x) / viewport.zoom, (sy + viewport.y) / viewport.zoom];
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  rect: { left: number; top: number },
  viewport: Viewport,
): [number, number] {
  return [worldX * viewport.zoom - viewport.x + rect.left, worldY * viewport.zoom - viewport.y + rect.top];
}

// Compute a new viewport that zooms to `nextZoom` while keeping the world point
// currently under (anchorScreenX, anchorScreenY) fixed at that screen position.
export function zoomAtPoint(
  viewport: Viewport,
  nextZoom: number,
  anchorScreenX: number,
  anchorScreenY: number,
  rect: { left: number; top: number },
): Viewport {
  const z = clampZoom(nextZoom);
  if (z === viewport.zoom) return viewport;
  const [wx, wy] = screenToWorld(anchorScreenX, anchorScreenY, rect, viewport);
  const sx = anchorScreenX - rect.left;
  const sy = anchorScreenY - rect.top;
  return { x: wx * z - sx, y: wy * z - sy, zoom: z };
}

export function fitToBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  width: number,
  height: number,
  padding = 40,
): Viewport {
  if (!bounds || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const zoom = clampZoom(Math.min(innerW / bw, innerH / bh));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx * zoom - width / 2, y: cy * zoom - height / 2, zoom };
}
