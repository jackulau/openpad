import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ContainerPool, buildPoolContainerArgs } from '../src/exec/pool.js';
import { LANGUAGES } from '@opencoder/shared';

// Stub child that emits exit(0) with optional stdout payload.
function stubChild(stdout: string, exitCode: number): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  setImmediate(() => {
    (child as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
    child.emit('exit', exitCode, null);
  });
  return child;
}

let containerCounter = 0;

function makeStubSpawn(): {
  spawn: typeof import('node:child_process').spawn;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = ((cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args: [...args] });
    if (args[0] === 'run' && args[1] === '-d') {
      return stubChild(`stubcontainer${++containerCounter}\n`, 0);
    }
    if (args[0] === 'rm') {
      return stubChild('', 0);
    }
    return stubChild('', 0);
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawn: fn, calls };
}

describe('exec/pool: buildPoolContainerArgs', () => {
  it('produces same security flags as cold runs and sleeps forever', () => {
    const lang = LANGUAGES.python312!;
    const args = buildPoolContainerArgs(lang);
    expect(args).toContain('-d');
    expect(args).toContain('--init');
    expect(args).toContain('--network');
    expect(args[args.indexOf('--network') + 1]).toBe('none');
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop');
    expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(args).toContain('sleep');
    expect(args[args.length - 2]).toBe('sleep');
    expect(args[args.length - 1]).toBe('infinity');
  });

  it('uses the language image as the run image', () => {
    const lang = LANGUAGES.node20!;
    const args = buildPoolContainerArgs(lang);
    expect(args).toContain(lang.docker!.image);
  });
});

describe('exec/pool: ContainerPool', () => {
  it('start() respects size=0 (disabled)', async () => {
    const { spawn, calls } = makeStubSpawn();
    const pool = new ContainerPool({ spawnImpl: spawn, log: () => {}, size: 0, langIds: ['python312'] });
    expect(pool.enabled()).toBe(false);
    await pool.start();
    expect(calls).toHaveLength(0);
  });

  it('start() launches size × langs containers', async () => {
    const { spawn, calls } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 2,
      langIds: ['python312', 'node20'],
    });
    await pool.start();
    const runCalls = calls.filter((c) => c.args[0] === 'run' && c.args[1] === '-d');
    expect(runCalls).toHaveLength(4); // 2 size × 2 langs
    const stats = pool.stats();
    expect(stats.ready).toBe(4);
    expect(stats.busy).toBe(0);
    await pool.shutdown();
  });

  it('acquire() returns null for un-pooled language', async () => {
    const { spawn } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 1,
      langIds: ['python312'],
    });
    await pool.start();
    expect(pool.acquire('node20')).toBeNull();
    await pool.shutdown();
  });

  it('acquire() returns a ready container and marks it busy', async () => {
    const { spawn } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 2,
      langIds: ['python312'],
    });
    await pool.start();
    const c1 = pool.acquire('python312');
    expect(c1).not.toBeNull();
    expect(c1!.state).toBe('busy');
    expect(c1!.id).toMatch(/^stubcontainer/);
    const c2 = pool.acquire('python312');
    expect(c2).not.toBeNull();
    expect(c2!.id).not.toBe(c1!.id);
    // pool exhausted
    expect(pool.acquire('python312')).toBeNull();
    await pool.shutdown();
  });

  it('release() kills and respawns the slot', async () => {
    const { spawn, calls } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 1,
      langIds: ['python312'],
    });
    await pool.start();
    const c = pool.acquire('python312')!;
    const before = calls.filter((c) => c.args[0] === 'run' && c.args[1] === '-d').length;
    await pool.release(c);
    // give the background respawn a microtask to run
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const rmCalls = calls.filter((c) => c.args[0] === 'rm' && c.args[1] === '-f');
    const afterRunCalls = calls.filter((c) => c.args[0] === 'run' && c.args[1] === '-d').length;
    expect(rmCalls.length).toBe(1);
    expect(afterRunCalls).toBe(before + 1); // respawned
    await pool.shutdown();
  });

  it('shutdown() kills all pooled containers and disables future acquires', async () => {
    const { spawn, calls } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 2,
      langIds: ['python312', 'node20'],
    });
    await pool.start();
    await pool.shutdown();
    const rmCalls = calls.filter((c) => c.args[0] === 'rm' && c.args[1] === '-f');
    expect(rmCalls).toHaveLength(4);
    expect(pool.acquire('python312')).toBeNull();
    expect(pool.acquire('node20')).toBeNull();
  });

  it('stats() reports per-lang state breakdown', async () => {
    const { spawn } = makeStubSpawn();
    const pool = new ContainerPool({
      spawnImpl: spawn,
      log: () => {},
      size: 2,
      langIds: ['python312', 'node20'],
    });
    await pool.start();
    pool.acquire('python312');
    const stats = pool.stats();
    expect(stats.byLang.python312.busy).toBe(1);
    expect(stats.byLang.python312.ready).toBe(1);
    expect(stats.byLang.node20.busy).toBe(0);
    expect(stats.byLang.node20.ready).toBe(2);
    await pool.shutdown();
  });

  it('handles docker run failure gracefully (no slot added)', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const failingSpawn = ((cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args: [...args] });
      // every `run -d` exits 1
      if (args[0] === 'run' && args[1] === '-d') return stubChild('', 1);
      return stubChild('', 0);
    }) as unknown as typeof import('node:child_process').spawn;
    const pool = new ContainerPool({
      spawnImpl: failingSpawn,
      log: () => {},
      size: 2,
      langIds: ['python312'],
    });
    await pool.start();
    expect(pool.stats().ready).toBe(0);
    expect(pool.acquire('python312')).toBeNull();
    await pool.shutdown();
  });
});
