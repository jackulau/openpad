import type { RunRequest, RunResult } from '@opencoder/shared';
import { resolveLanguage } from './languages.js';
import { env } from '../env.js';
import { makeSandbox } from './sandbox.js';
import { isDockerAvailable, runInDocker, runProcess, type ExecResult } from './docker.js';
import { runProcessIn } from './local.js';
import { getPool } from './pool.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Per-group canonical filename. The runner picks `main{ext}` for any unknown id;
// these overrides keep Java's `Main.java`, Haskell's `Main.hs`, etc.
const FILENAME_OVERRIDES: Record<string, string> = {
  java: 'Main.java',
  haskell: 'Main.hs',
};

export async function runCode(req: RunRequest): Promise<RunResult> {
  const lang = resolveLanguage(req.language);
  if (!lang) {
    return badLanguage(req.language);
  }
  const groupOverride = lang.group ? FILENAME_OVERRIDES[lang.group] : undefined;
  const filename = req.filename ?? groupOverride ?? `main${lang.fileExt}`;
  const timeoutMs = clampTimeout(req.timeoutMs);
  const sandbox = await makeSandbox(filename, req.source);
  try {
    const docker = await isDockerAvailable();
    if (docker && lang.docker) {
      // Try the warm pool first for hot languages - saves ~500-2000ms cold
      // start. Falls through to cold `docker run --rm` if no pooled slot is
      // ready (pool not started, exhausted, lang not pooled).
      const pool = getPool();
      const pooled = pool.acquire(lang.id);
      if (pooled) {
        try {
          const r = await runInPooledContainer(
            pooled.id,
            sandbox.dir,
            filename,
            req.stdin,
            timeoutMs,
            lang.docker.runCmd(filename),
          );
          return { ...r, runner: 'docker-pool', language: lang.id };
        } finally {
          void pool.release(pooled);
        }
      }
      const r = await runInDocker(lang, sandbox.dir, filename, req.stdin, timeoutMs);
      return { ...r, runner: 'docker', language: lang.id };
    }
    if (lang.local) {
      // Production must not silently execute untrusted user code on the host
      // when Docker disappears. Operators that genuinely want host execution
      // (e.g. trusted-LAN deployments) set EXEC_FORCE_LOCAL=true explicitly.
      if (shouldRefuseHostFallback()) {
        return {
          stdout: '',
          stderr:
            'docker unavailable in production: refusing host fallback for safety. ' +
            'Set EXEC_FORCE_LOCAL=true to override (untrusted users only on trusted LAN).',
          exitCode: 127,
          timedOut: false,
          durationMs: 0,
          runner: 'disabled',
          language: lang.id,
        };
      }
      const args = lang.local.runCmd(filename);
      const [cmd, ...rest] = args;
      const r = await runProcessIn(sandbox.dir, cmd, rest, req.stdin, timeoutMs);
      return { ...r, runner: 'subprocess', language: lang.id };
    }
    return {
      stdout: '',
      stderr: `no runner available for ${lang.id}`,
      exitCode: 127,
      timedOut: false,
      durationMs: 0,
      runner: 'disabled',
      language: lang.id,
    };
  } finally {
    await sandbox.cleanup();
  }
}

// Reads process.env at call time so tests can flip NODE_ENV / EXEC_FORCE_LOCAL
// without re-importing the env module. EXEC_FORCE_LOCAL parsed via the same
// allow-list as env.ts:strictBool (1|true|yes|on, case-insensitive).
export function shouldRefuseHostFallback(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  const raw = process.env.EXEC_FORCE_LOCAL?.trim() ?? '';
  const forceLocal = /^(1|true|yes|on)$/i.test(raw);
  return !forceLocal;
}

function clampTimeout(ms: number | undefined): number {
  const def = env.EXEC_DEFAULT_TIMEOUT_MS;
  const max = env.EXEC_MAX_TIMEOUT_MS;
  if (typeof ms !== 'number' || Number.isNaN(ms)) return def;
  return Math.min(Math.max(ms, 250), max);
}

// Inject source into the pooled container's /work via a stdin-fed `cat >`,
// then `docker exec` the runtime. We can't use `docker cp` because pooled
// containers run with --read-only rootfs, which the docker daemon refuses
// even when the target path is on a writable tmpfs mount (moby#38181).
//
// The injection step is its own docker exec call so user-supplied stdin
// (req.stdin) stays separate from the file contents.
async function runInPooledContainer(
  containerId: string,
  hostDir: string,
  filename: string,
  stdin: string | undefined,
  timeoutMs: number,
  cmd: readonly string[],
): Promise<ExecResult> {
  const source = await readFile(path.join(hostDir, filename), 'utf8');
  const injectResult = await runProcess(
    'docker',
    ['exec', '-i', containerId, 'sh', '-c', `cat > /work/${shellQuote(filename)}`],
    source,
    10_000,
  );
  if (injectResult.exitCode !== 0) {
    return {
      stdout: '',
      stderr: `source injection failed: ${injectResult.stderr}`,
      exitCode: 127,
      timedOut: false,
      durationMs: injectResult.durationMs,
    };
  }
  return runProcess('docker', ['exec', '-i', containerId, ...cmd], stdin, timeoutMs);
}

// Single-quote a path for safe use inside `sh -c "..."`. Filenames come from
// language overrides and a canonical extension table, never from user input,
// so quoting is belt-and-suspenders — still, do it.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function badLanguage(id: string): RunResult {
  return {
    stdout: '',
    stderr: `unknown language: ${id}`,
    exitCode: 127,
    timedOut: false,
    durationMs: 0,
    runner: 'disabled',
    language: id,
  };
}
