import type { RunRequest, RunResult } from '@opencoder/shared';
import { LANGUAGES } from './languages.js';
import { env } from '../env.js';
import { makeSandbox } from './sandbox.js';
import { isDockerAvailable, runInDocker } from './docker.js';
import { runProcessIn } from './local.js';

const DEFAULT_FILENAME: Record<string, string> = {
  python: 'main.py',
  javascript: 'main.js',
  typescript: 'main.ts',
  go: 'main.go',
  rust: 'main.rs',
  java: 'Main.java',
  cpp: 'main.cpp',
  c: 'main.c',
  ruby: 'main.rb',
  csharp: 'main.cs',
  kotlin: 'main.kt',
  swift: 'main.swift',
  php: 'main.php',
  bash: 'main.sh',
  lua: 'main.lua',
  elixir: 'main.exs',
  haskell: 'Main.hs',
  scala: 'main.scala',
  perl: 'main.pl',
  r: 'main.r',
  julia: 'main.jl',
  zig: 'main.zig',
  ocaml: 'main.ml',
  clojure: 'main.clj',
  dart: 'main.dart',
  fsharp: 'main.fsx',
  sql: 'main.sql',
};

export async function runCode(req: RunRequest): Promise<RunResult> {
  const lang = LANGUAGES[req.language];
  if (!lang) {
    return badLanguage(req.language);
  }
  const filename = req.filename ?? DEFAULT_FILENAME[lang.id] ?? `main${lang.fileExt}`;
  const timeoutMs = clampTimeout(req.timeoutMs);
  const sandbox = await makeSandbox(filename, req.source);
  try {
    const docker = await isDockerAvailable();
    if (docker && lang.docker) {
      const r = await runInDocker(lang, sandbox.dir, filename, req.stdin, timeoutMs);
      return {
        ...r,
        runner: 'docker',
        language: lang.id,
      };
    }
    if (lang.local) {
      const args = lang.local.runCmd(filename);
      const [cmd, ...rest] = args;
      const r = await runProcessIn(sandbox.dir, cmd, rest, req.stdin, timeoutMs);
      return {
        ...r,
        runner: 'subprocess',
        language: lang.id,
      };
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
