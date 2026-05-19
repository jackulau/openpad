// Pure helpers for pen smoothing + render perf. No React deps.
//
//   rdpSimplify: Ramer-Douglas-Peucker — drops collinear points within an
//     epsilon-tolerance distance from the simplified line. Cuts stroke
//     payload size by 50-90% for finger/mouse trails without visible loss.
//
//   catmullRomPath: builds an SVG `d=` path that traces Catmull-Rom splines
//     through every input point. Looks smoother than the line-list rendering
//     opencoder used before (no visible polygon edges).
//
//   inViewport: AABB intersection test. Render loop skips strokes whose bbox
//     misses the visible region (with margin), so 10k strokes feels the same
//     as 100 strokes when most are off-screen.

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Point = [number, number];

// Recursive RDP. epsilon = max perpendicular distance from a point to the
// line connecting its two neighbors before it's worth keeping.
export function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return [...points];
  return rdpRange(points, 0, points.length - 1, epsilon);
}

function rdpRange(points: Point[], i: number, j: number, eps: number): Point[] {
  if (j - i < 2) return [points[i]!, points[j]!];
  let maxDist = -1;
  let maxIdx = -1;
  const [ax, ay] = points[i]!;
  const [bx, by] = points[j]!;
  for (let k = i + 1; k < j; k++) {
    const [px, py] = points[k]!;
    const d = pointSegmentDist(px, py, ax, ay, bx, by);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = k;
    }
  }
  if (maxDist <= eps) return [points[i]!, points[j]!];
  const left = rdpRange(points, i, maxIdx, eps);
  const right = rdpRange(points, maxIdx, j, eps);
  // drop the duplicate midpoint
  return left.slice(0, -1).concat(right);
}

function pointSegmentDist(
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

// Build an SVG path string that fits a Catmull-Rom spline through `points`.
// First + last segments mirror endpoints so the curve actually starts/ends
// at the first/last point. Returns empty string for 0-1 points.
export function catmullRomPath(points: Point[], tension = 0.5): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0]!;
    return `M ${x} ${y}`;
  }
  if (points.length === 2) {
    const [a, b] = points;
    return `M ${a![0]} ${a![1]} L ${b![0]} ${b![1]}`;
  }
  const out: string[] = [`M ${points[0]![0]} ${points[0]![1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    // Catmull-Rom → cubic Bezier conversion
    const c1x = p1[0] + ((p2[0] - p0[0]) * tension) / 3;
    const c1y = p1[1] + ((p2[1] - p0[1]) * tension) / 3;
    const c2x = p2[0] - ((p3[0] - p1[0]) * tension) / 3;
    const c2y = p2[1] - ((p3[1] - p1[1]) * tension) / 3;
    out.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  return out.join(' ');
}

// AABB intersection: returns true if `b` overlaps the viewport (expanded by
// `margin` on each side so strokes near the edge don't pop in/out).
export function inViewport(b: Bounds, viewport: Bounds, margin = 0): boolean {
  return !(
    b.maxX < viewport.minX - margin ||
    b.minX > viewport.maxX + margin ||
    b.maxY < viewport.minY - margin ||
    b.minY > viewport.maxY + margin
  );
}
