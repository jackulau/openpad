import type { RunRequest, RunResult } from '@opencoder/shared';
import { resolveLanguage } from './languages.js';
import { env } from '../env.js';
import { makeSandbox } from './sandbox.js';
import { isDockerAvailable, runInDocker, runProcess, type ExecResult } from './docker.js';
import { runProcessIn } from './local.js';
import { getPool } from './pool.js';
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

function clampTimeout(ms: number | undefined): number {
  const def = env.EXEC_DEFAULT_TIMEOUT_MS;
  const max = env.EXEC_MAX_TIMEOUT_MS;
  if (typeof ms !== 'number' || Number.isNaN(ms)) return def;
  return Math.min(Math.max(ms, 250), max);
}

// Copy source into the pooled container's /work, then `docker exec` the
// runtime. Output captured the same way as cold runs.
async function runInPooledContainer(
  containerId: string,
  hostDir: string,
  filename: string,
  stdin: string | undefined,
  timeoutMs: number,
  cmd: readonly string[],
): Promise<ExecResult> {
  const cpResult = await runProcess(
    'docker',
    ['cp', path.join(hostDir, filename), `${containerId}:/work/${filename}`],
    undefined,
    10_000,
  );
  if (cpResult.exitCode !== 0) {
    return {
      stdout: '',
      stderr: `docker cp failed: ${cpResult.stderr}`,
      exitCode: 127,
      timedOut: false,
      durationMs: cpResult.durationMs,
    };
  }
  return runProcess('docker', ['exec', '-i', containerId, ...cmd], stdin, timeoutMs);
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
