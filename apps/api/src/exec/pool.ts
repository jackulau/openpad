import { spawn, type SpawnOptions } from 'node:child_process';
import { LANGUAGES, type LanguageSpec } from '@opencoder/shared';
import { env } from '../env.js';

// Warm container pool. For each language in EXEC_POOL_LANGS we keep
// EXEC_POOL_SIZE long-lived `docker run -d ... sleep infinity` containers
// ready. /run handlers acquire one, `docker cp` source in, `docker exec` the
// runtime, then release the slot (which kills the container and respawns a
// fresh one in the background). Skips the ~500-2000ms cold `docker run --rm`
// path for the hot languages.
//
// Security model: each container starts with the same flags as cold runs
// (--read-only, --network=none, --cap-drop=ALL, --pids-limit=256, memory cap,
// non-root UID). Containers are killed + recreated on release, NOT reused, so
// filesystem mutations and lingering processes can't leak between runs.

export interface PooledContainer {
  id: string;
  langId: string;
  image: string;
  state: 'starting' | 'ready' | 'busy';
  startedAt: number;
}

export interface PoolDeps {
  spawnImpl?: typeof spawn;
  log?: (msg: string) => void;
  size?: number;
  langIds?: string[];
}

export interface PoolStats {
  totalSlots: number;
  ready: number;
  busy: number;
  starting: number;
  byLang: Record<string, { ready: number; busy: number; starting: number }>;
}

const STARTUP_GRACE_MS = 30_000;

export class ContainerPool {
  private slots = new Map<string, PooledContainer[]>();
  private spawnFn: typeof spawn;
  private log: (m: string) => void;
  private size: number;
  private langIds: string[];
  private stopped = false;

  constructor(deps: PoolDeps = {}) {
    this.spawnFn = deps.spawnImpl ?? spawn;
    this.log = deps.log ?? ((m) => console.log(`[exec/pool] ${m}`));
    // EXEC_FORCE_LOCAL only zero-overrides the env-driven size; tests can pass
    // an explicit `size` and `langIds` to drive the pool without touching env.
    this.size = deps.size ?? (env.EXEC_FORCE_LOCAL ? 0 : env.EXEC_POOL_SIZE);
    this.langIds =
      deps.langIds ??
      env.EXEC_POOL_LANGS.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  }

  // Pool is active when size > 0 and at least one lang is configured.
  enabled(): boolean {
    return this.size > 0 && this.langIds.length > 0;
  }

  configuredLangs(): string[] {
    return [...this.langIds];
  }

  // Spawn `size` containers per lang. Caller should NOT await - runs in
  // background while server.listen() returns. Acquire calls return null until
  // containers are 'ready'; runner falls back to cold runs in the meantime.
  async start(): Promise<void> {
    if (!this.enabled()) {
      this.log(`disabled (size=${this.size}, langs=${this.langIds.length})`);
      return;
    }
    this.log(`starting ${this.size} containers/lang × ${this.langIds.length} langs`);
    await Promise.all(
      this.langIds.flatMap((langId) =>
        Array.from({ length: this.size }, () => this.spawnSlot(langId)),
      ),
    );
    this.log(`ready: ${this.totalReady()} containers across ${this.langIds.length} langs`);
  }

  // Mark one ready container busy and return it. Returns null if none ready.
  acquire(langId: string): PooledContainer | null {
    if (this.stopped || !this.enabled()) return null;
    const slots = this.slots.get(langId);
    if (!slots) return null;
    const ready = slots.find((c) => c.state === 'ready');
    if (!ready) return null;
    ready.state = 'busy';
    return ready;
  }

  // Kill the container and replace it with a fresh one (background). The
  // returned promise resolves after the kill; the respawn fires-and-forgets so
  // the /run handler isn't held up.
  async release(c: PooledContainer): Promise<void> {
    if (this.stopped) return;
    const slots = this.slots.get(c.langId);
    if (!slots) return;
    const idx = slots.indexOf(c);
    if (idx >= 0) slots.splice(idx, 1);
    await this.kill(c.id);
    if (!this.stopped) {
      void this.spawnSlot(c.langId).catch((err: unknown) => {
        this.log(`respawn ${c.langId} failed: ${String(err)}`);
      });
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const all: PooledContainer[] = [];
    for (const list of this.slots.values()) all.push(...list);
    this.slots.clear();
    if (all.length === 0) return;
    this.log(`shutdown: killing ${all.length} pooled containers`);
    await Promise.all(all.map((c) => this.kill(c.id)));
  }

  stats(): PoolStats {
    const byLang: Record<string, { ready: number; busy: number; starting: number }> = {};
    let totalReady = 0;
    let totalBusy = 0;
    let totalStarting = 0;
    for (const langId of this.langIds) {
      const slots = this.slots.get(langId) ?? [];
      const r = slots.filter((s) => s.state === 'ready').length;
      const b = slots.filter((s) => s.state === 'busy').length;
      const s = slots.filter((s) => s.state === 'starting').length;
      byLang[langId] = { ready: r, busy: b, starting: s };
      totalReady += r;
      totalBusy += b;
      totalStarting += s;
    }
    return {
      totalSlots: totalReady + totalBusy + totalStarting,
      ready: totalReady,
      busy: totalBusy,
      starting: totalStarting,
      byLang,
    };
  }

  private totalReady(): number {
    let n = 0;
    for (const list of this.slots.values()) for (const c of list) if (c.state === 'ready') n++;
    return n;
  }

  private async spawnSlot(langId: string): Promise<void> {
    const lang = LANGUAGES[langId];
    if (!lang?.docker) {
      this.log(`lang ${langId} has no docker config - skipping pool slot`);
      return;
    }
    const placeholder: PooledContainer = {
      id: '',
      langId,
      image: lang.docker.image,
      state: 'starting',
      startedAt: Date.now(),
    };
    const slots = this.slots.get(langId) ?? [];
    slots.push(placeholder);
    this.slots.set(langId, slots);

    const args = buildPoolContainerArgs(lang);
    try {
      const id = await this.runDockerGetStdout('docker', args);
      placeholder.id = id.trim();
      placeholder.state = 'ready';
    } catch (err) {
      // remove placeholder on failure
      const i = slots.indexOf(placeholder);
      if (i >= 0) slots.splice(i, 1);
      this.log(`spawn ${langId} failed: ${String(err)}`);
    }
  }

  private async kill(containerId: string): Promise<void> {
    if (!containerId) return;
    try {
      await this.runDockerGetStdout('docker', ['rm', '-f', containerId]);
    } catch {
      // best effort - container may already be gone
    }
  }

  private runDockerGetStdout(cmd: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] } as SpawnOptions);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        reject(new Error(`docker ${args[0]} timed out after ${STARTUP_GRACE_MS}ms`));
      }, STARTUP_GRACE_MS);
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`docker ${args[0]} exited ${code}: ${stderr.trim()}`));
      });
    });
  }
}

// Pure builder - exported for unit tests.
export function buildPoolContainerArgs(lang: LanguageSpec): string[] {
  if (!lang.docker) throw new Error(`language ${lang.id} has no docker image`);
  return [
    'run',
    '-d',
    '--init',
    '--network',
    'none',
    '--ipc',
    'private',
    '--read-only',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    'seccomp=runtime/default',
    '--cap-drop',
    'ALL',
    '--user',
    process.env.EXEC_DOCKER_USER ?? '65534:65534',
    '--tmpfs',
    '/tmp:exec,rw,size=64m,uid=65534,gid=65534',
    '--tmpfs',
    '/work:exec,rw,size=64m,uid=65534,gid=65534',
    '--memory',
    `${env.EXEC_MEMORY_MB}m`,
    '--memory-swap',
    `${env.EXEC_MEMORY_MB}m`,
    '--cpus',
    env.EXEC_CPU,
    '--pids-limit',
    '256',
    '--ulimit',
    'nofile=64:64',
    '-w',
    '/work',
    lang.docker.image,
    'sleep',
    'infinity',
  ];
}

// Module-level singleton. buildServer() calls start() once at boot and
// shutdown() in onClose. Routes call acquire/release via runner.
let _pool: ContainerPool | null = null;

export function getPool(): ContainerPool {
  if (!_pool) _pool = new ContainerPool();
  return _pool;
}

// Test-only: replace the singleton with a custom-configured pool.
export function _setPoolForTest(p: ContainerPool | null): void {
  _pool = p;
}
