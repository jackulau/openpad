// Wrapper module so we can spawn a child process in a specific cwd
// without leaking env vars from the parent process.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ExecResult } from './docker.js';

const MAX_OUT = 256 * 1024;

export function runProcessIn(
  cwd: string,
  cmd: string,
  args: string[],
  stdin: string | undefined,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/tmp' },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
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

    // See docker.ts: unhandled stdin EPIPE would crash the whole process.
    child.stdin.on('error', () => {
      /* broken pipe - child already gone */
    });
    try {
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    } catch {
      /* stdin already destroyed */
    }
  });
}
