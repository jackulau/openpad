import { spawn } from 'node:child_process';
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
  const args = [
    'run',
    '--rm',
    '-i',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:exec,rw,size=64m',
    '--memory',
    `${env.EXEC_MEMORY_MB}m`,
    '--memory-swap',
    `${env.EXEC_MEMORY_MB}m`,
    '--cpus',
    env.EXEC_CPU,
    '--pids-limit',
    '256',
    '-v',
    `${sandboxDir}:/work:rw`,
    '-w',
    '/work',
    lang.docker.image,
    ...lang.docker.runCmd(filename),
  ];
  return runProcess('docker', args, stdin, timeoutMs);
}

export function runProcess(
  cmd: string,
  args: string[],
  stdin: string | undefined,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUT) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUT) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || String(err.message ?? err),
        exitCode: 127,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, MAX_OUT),
        stderr: stderr.slice(0, MAX_OUT),
        exitCode: code,
        timedOut: killed,
        durationMs: Date.now() - started,
      });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
