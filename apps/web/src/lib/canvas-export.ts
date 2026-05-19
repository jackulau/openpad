// Pure helpers for exporting the whiteboard. SVG generation is a pure string
// transform (testable); PNG export needs a browser canvas + DOM and is
// invoked by the component only.

import { strokeBounds, type Stroke } from './canvas-hit';
import { catmullRomPath } from './canvas-smooth';

const MARGIN = 24;

export interface ExportOptions {
  background?: string;
}

// Serialize the stroke list to a standalone SVG document. The viewBox snaps
// to the strokes' union bbox so the export is tight regardless of viewport.
export function toSVG(strokes: Stroke[], opts: ExportOptions = {}): string {
  if (strokes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"></svg>';
  }
  // union bbox
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const x = minX - MARGIN;
  const y = minY - MARGIN;
  const w = maxX - minX + MARGIN * 2;
  const h = maxY - minY + MARGIN * 2;
  const bg = opts.background
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opts.background}" />`
    : '';
  const arrowDef = `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="currentColor" /></marker></defs>`;
  const body = strokes.map(strokeToSvg).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${arrowDef}${bg}${body}</svg>`;
}

function strokeToSvg(s: Stroke): string {
  if (s.kind === 'pen') {
    const d = catmullRomPath(s.points);
    return `<path d="${d}" stroke="${s.color}" stroke-width="${s.sw}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (s.kind === 'rect') {
    const x = Math.min(s.x, s.x + s.w);
    const y = Math.min(s.y, s.y + s.h);
    return `<rect x="${x}" y="${y}" width="${Math.abs(s.w)}" height="${Math.abs(s.h)}" stroke="${s.color}" stroke-width="${s.sw}" fill="none" rx="4" />`;
  }
  if (s.kind === 'ellipse') {
    return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" stroke="${s.color}" stroke-width="${s.sw}" fill="none" />`;
  }
  if (s.kind === 'arrow') {
    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.color}" stroke-width="${s.sw}" marker-end="url(#arrowhead)" style="color:${s.color}" />`;
  }
  if (s.kind === 'text') {
    return `<text x="${s.x}" y="${s.y}" fill="${s.color}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16">${escapeXml(s.text)}</text>`;
  }
  // note
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  const w = Math.abs(s.w);
  const h = Math.abs(s.h);
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${s.color}" fill-opacity="0.18" stroke="${s.color}" stroke-width="1.5" rx="6" /><text x="${x + 8}" y="${y + 22}" fill="${s.color}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13">${escapeXml(s.text)}</text></g>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return c;
    }
  });
}

// Browser-only: open a download for the given content with mime type.
export function triggerDownload(filename: string, content: string | Blob, mime = 'application/octet-stream'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// PNG export: render the SVG into a canvas at 2× DPR for crispness. Returns
// a promise that resolves when the download starts. Browser-only.
export async function exportPNG(strokes: Stroke[], filename: string, opts: ExportOptions = {}): Promise<void> {
  const svgStr = toSVG(strokes, { background: opts.background ?? '#0a0a0a' });
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg image load failed'));
      img.src = svgUrl;
    });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * dpr;
    canvas.height = img.naturalHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0);
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('png encode failed'));
        triggerDownload(filename, blob, 'image/png');
        resolve();
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function exportSVG(strokes: Stroke[], filename: string, opts: ExportOptions = {}): void {
  const svg = toSVG(strokes, opts);
  triggerDownload(filename, svg, 'image/svg+xml');
}
