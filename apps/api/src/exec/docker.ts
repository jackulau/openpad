import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { env } from '../env.js';
import type { LanguageSpec } from './languages.js';

const MAX_OUT = 256 * 1024;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

let dockerAvailableCache: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (env.EXEC_FORCE_LOCAL) return false;
  if (dockerAvailableCache !== null) return dockerAvailableCache;
  return new Promise<boolean>((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
    });
    child.on('error', () => {
      dockerAvailableCache = false;
      resolve(false);
    });
    child.on('exit', (code) => {
      dockerAvailableCache = code === 0;
      resolve(code === 0);
    });
  });
}

export function resetDockerCache(): void {
  dockerAvailableCache = null;
}

// Pure builder so the sandbox flags can be unit-tested without invoking docker.
// Order is significant - keep flags grouped (rm/io → network → fs → caps → resources).
// `name` (optional) tags the container so a timeout can reap it by name - killing
// the `docker run` CLI client alone leaves the container running (moby#3766).
export function buildDockerArgs(
  lang: LanguageSpec,
  sandboxDir: string,
  filename: string,
  opts: { name?: string } = {},
): string[] {
  if (!lang.docker) throw new Error(`language ${lang.id} has no docker image configured`);
  return [
    'run',
    '--rm',
    '-i',
    ...(opts.name ? ['--name', opts.name] : []),
    '--network',
    'none',
    '--ipc',
    'private',
    '--read-only',
    '--security-opt',
    'no-new-privileges',
    // Default seccomp profile is applied implicitly when no --security-opt seccomp=... is
    // passed. Earlier code passed seccomp=runtime/default, which the Docker CLI treats as
    // a filesystem path (not a magic string) and rejects with "no such file or directory".
    '--cap-drop',
    'ALL',
    '--user',
    process.env.EXEC_DOCKER_USER ?? '65534:65534',
    '--tmpfs',
    '/tmp:exec,rw,size=64m,uid=65534,gid=65534',
    // Toolchains (go build, cargo, dotnet, javac) write caches under $HOME; the
    // rootfs is --read-only so point HOME at the writable /tmp tmpfs. Without
    // this, `go run` etc. die with "mkdir /.cache: read-only file system".
    '-e',
    'HOME=/tmp',
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
    '-v',
    `${sandboxDir}:/work:rw`,
    '-w',
    '/work',
    lang.docker.image,
    ...lang.docker.runCmd(filename),
  ];
}

export async function runInDocker(
  lang: LanguageSpec,
  sandboxDir: string,
  filename: string,
  stdin: string | undefined,
  timeoutMs: number,
): Promise<ExecResult> {
  if (!lang.docker) {
    return {
      stdout: '',
      stderr: `language ${lang.id} has no docker image configured`,
      exitCode: 127,
      timedOut: false,
      durationMs: 0,
    };
  }
  // Name the container so a timeout reaps it directly. SIGKILL of the `docker
  // run` client leaves the container alive (and --rm never fires), so a runaway
  // `while True` would keep burning CPU/RAM until manually reaped.
  const name = `oc-exec-${randomUUID()}`;
  return runProcess('docker', buildDockerArgs(lang, sandboxDir, filename, { name }), stdin, timeoutMs, {
    onTimeout: () => reapContainer(name),
  });
}

// Best-effort removal of a still-running container after its `docker run` client
// was killed. Detached and error-swallowing - we never want reaping to throw.
function reapContainer(name: string): void {
  try {
    const killer = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    killer.on('error', () => {
      /* docker gone / already reaped */
    });
  } catch {
    /* ignore */
  }
}

export function runProcess(
  cmd: string,
  args: string[],
  stdin: string | undefined,
  timeoutMs: number,
  opts: { onTimeout?: () => void } = {},
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    // StringDecoder holds back the trailing bytes of a multibyte UTF-8 codepoint
    // that straddles two 'data' chunks, so we never emit replacement chars.
    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      opts.onTimeout?.();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length >= MAX_OUT) return;
      const remaining = MAX_OUT - stdout.length;
      const str = outDec.write(chunk);
      stdout += str.length > remaining ? str.slice(0, remaining) : str;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length >= MAX_OUT) return;
      const remaining = MAX_OUT - stderr.length;
      const str = errDec.write(chunk);
      stderr += str.length > remaining ? str.slice(0, remaining) : str;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: (stdout + outDec.end()).slice(0, MAX_OUT),
        stderr: (stderr + errDec.end()) || String(err.message ?? err),
        exitCode: 127,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: (stdout + outDec.end()).slice(0, MAX_OUT),
        stderr: (stderr + errDec.end()).slice(0, MAX_OUT),
        exitCode: code,
        timedOut: killed,
        durationMs: Date.now() - started,
      });
    });

    // Without an 'error' listener a broken stdin pipe (child exited / was killed
    // before draining) raises EPIPE as an uncaughtException and takes the whole
    // API process down. Swallow it - the run result is captured via stdout/close.
    child.stdin.on('error', () => {
      /* EPIPE / broken pipe - child already gone */
    });
    try {
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    } catch {
      /* stdin already destroyed */
    }
  });
}
