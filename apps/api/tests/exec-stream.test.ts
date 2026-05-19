import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let baseUrl: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  baseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

async function makePadWithToken(): Promise<{ slug: string; token: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `stream-${Date.now()}@example.com`, name: 'S', password: 'password1234' },
  });
  const token = r.json().token as string;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python' },
  });
  return { slug: p.json().pad.slug as string, token };
}

interface StreamMsg {
  kind: string;
  chunk?: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  runId?: string;
  error?: string;
}

async function collectStream(
  url: string,
  token: string,
  payload: object,
): Promise<{ msgs: StreamMsg[]; closeCode: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, [`oc.bearer.${token}`]);
    const msgs: StreamMsg[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('stream test timeout'));
    }, 15_000);
    ws.on('open', () => {
      ws.send(JSON.stringify(payload));
    });
    ws.on('message', (raw) => {
      try {
        msgs.push(JSON.parse(raw.toString()) as StreamMsg);
      } catch {
        /* ignore non-JSON */
      }
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve({ msgs, closeCode: code });
    });
    ws.on('error', () => {
      /* close usually follows */
    });
  });
}

describe('exec-stream (WebSocket)', () => {
  it('rejects with 4001 when no auth subprotocol is offered', async () => {
    const { slug } = await makePadWithToken();
    const ws = new WebSocket(`${baseUrl}/api/pads/${slug}/run-stream`);
    const code = await new Promise<number>((res) => {
      ws.on('close', (c) => res(c));
      ws.on('error', () => res(1006));
    });
    expect([4001, 1006]).toContain(code);
  });

  it('rejects with 4002 on bogus token', async () => {
    const { slug } = await makePadWithToken();
    const ws = new WebSocket(`${baseUrl}/api/pads/${slug}/run-stream`, [
      'oc.bearer.not-a-real-jwt',
    ]);
    const code = await new Promise<number>((res) => {
      ws.on('close', (c) => res(c));
      ws.on('error', () => res(1006));
    });
    expect([4002, 1006]).toContain(code);
  });

  it('streams stdout from a python print and ends with exitCode=0', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'python',
      source: 'print("hello-stream")',
    });
    const start = msgs.find((m) => m.kind === 'start');
    const end = msgs.find((m) => m.kind === 'end');
    const stdout = msgs
      .filter((m) => m.kind === 'stdout')
      .map((m) => m.chunk ?? '')
      .join('');
    expect(start).toBeDefined();
    expect(start?.runId).toMatch(/[0-9a-f]/);
    expect(end).toBeDefined();
    expect(end?.exitCode).toBe(0);
    expect(end?.timedOut).toBe(false);
    expect(stdout).toContain('hello-stream');
  });

  it('emits stderr separately from stdout', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'python',
      source: 'import sys; sys.stderr.write("oops\\n")',
    });
    const stderr = msgs
      .filter((m) => m.kind === 'stderr')
      .map((m) => m.chunk ?? '')
      .join('');
    expect(stderr).toContain('oops');
    const end = msgs.find((m) => m.kind === 'end');
    expect(end?.exitCode).toBe(0);
  });

  it('reports non-zero exitCode on script error', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'python',
      source: 'raise SystemExit(7)',
    });
    const end = msgs.find((m) => m.kind === 'end');
    expect(end?.exitCode).toBe(7);
    expect(end?.timedOut).toBe(false);
  });

  it('rejects unknown language with error then closes', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'not-a-real-language',
      source: 'noop',
    });
    const err = msgs.find((m) => m.kind === 'error');
    expect(err).toBeDefined();
    expect(err?.error).toBe('unknown_language');
  });

  it('enforces timeout and signals timedOut=true', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'python',
      source: 'import time; time.sleep(5)',
      timeoutMs: 500,
    });
    const end = msgs.find((m) => m.kind === 'end');
    expect(end?.timedOut).toBe(true);
  });

  it('accepts stdin and forwards to the process', async () => {
    const { slug, token } = await makePadWithToken();
    const url = `${baseUrl}/api/pads/${slug}/run-stream`;
    const { msgs } = await collectStream(url, token, {
      language: 'python',
      source: 'import sys; print(sys.stdin.read().strip().upper())',
      stdin: 'hello',
    });
    const stdout = msgs
      .filter((m) => m.kind === 'stdout')
      .map((m) => m.chunk ?? '')
      .join('');
    expect(stdout).toContain('HELLO');
  });
});
