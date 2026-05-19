import type { RunRequest, RunResult } from '@opencoder/shared';
import { resolveLanguage } from './languages.js';
import { env } from '../env.js';
import { makeSandbox } from './sandbox.js';
import { isDockerAvailable, runInDocker } from './docker.js';
import { runProcessIn } from './local.js';

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
