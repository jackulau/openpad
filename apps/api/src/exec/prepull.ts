import { spawn } from 'node:child_process';
import { LANGUAGES } from '@opencoder/shared';
import { env } from '../env.js';
import { isDockerAvailable } from './docker.js';

const CONCURRENCY = 5;

export interface PrepullResult {
  pulled: string[];
  failed: string[];
  skipped: string | null;
  durationMs: number;
}

export interface PrepullDeps {
  spawnImpl?: typeof spawn;
  log?: (msg: string) => void;
  forceLocal?: boolean;
  enabled?: boolean;
  dockerAvailable?: boolean | (() => Promise<boolean>);
  concurrency?: number;
}

export function uniqueImages(): string[] {
  const seen = new Set<string>();
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.docker?.image) seen.add(lang.docker.image);
  }
  return [...seen].sort();
}

export async function prepullImages(deps: PrepullDeps = {}): Promise<PrepullResult> {
  const spawnFn = deps.spawnImpl ?? spawn;
  const log = deps.log ?? ((m: string) => console.log(`[exec/prepull] ${m}`));
  const forceLocal = deps.forceLocal ?? env.EXEC_FORCE_LOCAL;
  const enabled = deps.enabled ?? env.EXEC_PREPULL;
  const concurrency = Math.max(1, deps.concurrency ?? CONCURRENCY);

  if (forceLocal) return skip(log, 'EXEC_FORCE_LOCAL=true');
  if (!enabled) return skip(log, 'EXEC_PREPULL=false');

  const available =
    typeof deps.dockerAvailable === 'function'
      ? await deps.dockerAvailable()
      : deps.dockerAvailable ?? (await isDockerAvailable());
  if (!available) return skip(log, 'docker not available');

  const images = uniqueImages();
  if (images.length === 0) return skip(log, 'no images configured');

  log(`pulling ${images.length} images (concurrency=${concurrency})`);
  const started = Date.now();
  const pulled: string[] = [];
  const failed: string[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= images.length) return;
      const image = images[idx]!;
      const t0 = Date.now();
      const ok = await pullOne(spawnFn, image);
      const dt = Date.now() - t0;
      if (ok) {
        pulled.push(image);
        log(`✓ ${image} (${dt}ms)`);
      } else {
        failed.push(image);
        log(`✗ ${image} (${dt}ms)`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
  const durationMs = Date.now() - started;
  log(`ready: ${pulled.length} pulled, ${failed.length} failed in ${durationMs}ms`);
  return { pulled, failed, skipped: null, durationMs };
}

function skip(log: (m: string) => void, reason: string): PrepullResult {
  log(`skipped: ${reason}`);
  return { pulled: [], failed: [], skipped: reason, durationMs: 0 };
}

function pullOne(spawnFn: typeof spawn, image: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawnFn('docker', ['pull', '--quiet', image], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
