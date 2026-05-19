import { EventEmitter } from 'node:events';
import type { SpawnOptions, ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { prepullImages, uniqueImages } from '../src/exec/prepull.js';

// Minimal stub child process — emits exit with the configured code.
function makeStubChild(exitCode: number): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  setImmediate(() => child.emit('exit', exitCode, null));
  return child;
}

describe('exec/prepull: uniqueImages', () => {
  it('returns deduped sorted image list', () => {
    const imgs = uniqueImages();
    expect(imgs.length).toBeGreaterThan(0);
    expect(new Set(imgs).size).toBe(imgs.length);
    expect([...imgs].sort()).toEqual(imgs);
  });

  it('covers python + node + go images at minimum', () => {
    const imgs = uniqueImages();
    expect(imgs.some((i) => i.startsWith('python:'))).toBe(true);
    expect(imgs.some((i) => i.startsWith('node:'))).toBe(true);
    expect(imgs.some((i) => i.startsWith('golang:'))).toBe(true);
  });
});

describe('exec/prepull: prepullImages', () => {
  it('skips when forceLocal=true', async () => {
    const result = await prepullImages({
      forceLocal: true,
      enabled: true,
      log: () => {},
    });
    expect(result.skipped).toContain('EXEC_FORCE_LOCAL');
    expect(result.pulled).toEqual([]);
  });

  it('skips when enabled=false', async () => {
    const result = await prepullImages({
      forceLocal: false,
      enabled: false,
      log: () => {},
    });
    expect(result.skipped).toContain('EXEC_PREPULL');
  });

  it('skips when docker not available', async () => {
    const result = await prepullImages({
      forceLocal: false,
      enabled: true,
      dockerAvailable: false,
      log: () => {},
    });
    expect(result.skipped).toContain('docker not available');
  });

  it('pulls each unique image with `docker pull --quiet`', async () => {
    const spawned: string[][] = [];
    const stub = ((cmd: string, args: readonly string[], _opts?: SpawnOptions) => {
      spawned.push([cmd, ...args]);
      return makeStubChild(0);
    }) as unknown as typeof import('node:child_process').spawn;

    const result = await prepullImages({
      forceLocal: false,
      enabled: true,
      dockerAvailable: true,
      spawnImpl: stub,
      log: () => {},
      concurrency: 3,
    });

    expect(result.pulled.length).toBe(uniqueImages().length);
    expect(result.failed).toEqual([]);
    // every spawn was `docker pull --quiet <image>`
    for (const [cmd, sub, flag, _img] of spawned) {
      expect(cmd).toBe('docker');
      expect(sub).toBe('pull');
      expect(flag).toBe('--quiet');
    }
    // images pulled covers full set
    const pulledImages = new Set(spawned.map((s) => s[3]));
    expect(pulledImages.size).toBe(uniqueImages().length);
  });

  it('reports failures separately when docker pull exits non-zero', async () => {
    let call = 0;
    const stub = ((_cmd: string, _args: readonly string[]) => {
      // first half fail, rest succeed
      const code = call++ < 5 ? 1 : 0;
      return makeStubChild(code);
    }) as unknown as typeof import('node:child_process').spawn;

    const result = await prepullImages({
      forceLocal: false,
      enabled: true,
      dockerAvailable: true,
      spawnImpl: stub,
      log: () => {},
      concurrency: 1, // sequential so the "first 5" ordering is deterministic
    });

    expect(result.failed.length).toBe(5);
    expect(result.pulled.length).toBe(uniqueImages().length - 5);
  });

  it('runs in parallel up to concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    const stub = ((_cmd: string, _args: readonly string[]) => {
      active++;
      if (active > maxActive) maxActive = active;
      const child = new EventEmitter() as unknown as ChildProcess;
      // delay slightly so multiple in-flight overlap
      setTimeout(() => {
        active--;
        child.emit('exit', 0, null);
      }, 5);
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    await prepullImages({
      forceLocal: false,
      enabled: true,
      dockerAvailable: true,
      spawnImpl: stub,
      log: () => {},
      concurrency: 4,
    });

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
