import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import { runCode } from '../src/exec/runner.js';

let server: AppServer;
let token: string;
let slug: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: 'exec@b.com', name: 'E'},
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python' },
  });
  slug = p.json().pad.slug;
});

describe('exec: runCode (unit, local fallback)', () => {
  it('runs python hello-world locally', async () => {
    const res = await runCode({ language: 'python', source: 'print("hi")' });
    expect(res.runner).toBe('subprocess');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('hi');
  });

  it('runs javascript locally', async () => {
    const res = await runCode({
      language: 'javascript',
      source: 'console.log(2 + 3);',
    });
    expect(res.runner).toBe('subprocess');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('5');
  });

  it('captures stderr + nonzero exit on python error', async () => {
    const res = await runCode({
      language: 'python',
      source: 'raise SystemExit(2)\n',
    });
    expect(res.exitCode).toBe(2);
  });

  it('enforces timeout', async () => {
    const res = await runCode({
      language: 'python',
      source: 'import time\nwhile True: time.sleep(1)\n',
      timeoutMs: 500,
    });
    expect(res.timedOut).toBe(true);
  });

  it('rejects unknown language', async () => {
    const res = await runCode({ language: 'cobol', source: 'PROGRAM' });
    expect(res.runner).toBe('disabled');
    expect(res.exitCode).toBe(127);
  });

  it('shouldRefuseHostFallback returns true in production without EXEC_FORCE_LOCAL', async () => {
    const { shouldRefuseHostFallback } = await import('../src/exec/runner.js');
    const origEnv = process.env.NODE_ENV;
    const origForce = process.env.EXEC_FORCE_LOCAL;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.EXEC_FORCE_LOCAL;
      expect(shouldRefuseHostFallback()).toBe(true);
      process.env.EXEC_FORCE_LOCAL = 'false';
      expect(shouldRefuseHostFallback()).toBe(true);
      process.env.EXEC_FORCE_LOCAL = '0';
      expect(shouldRefuseHostFallback()).toBe(true);
      process.env.EXEC_FORCE_LOCAL = 'true';
      expect(shouldRefuseHostFallback()).toBe(false);
      process.env.EXEC_FORCE_LOCAL = '1';
      expect(shouldRefuseHostFallback()).toBe(false);
      process.env.NODE_ENV = 'development';
      delete process.env.EXEC_FORCE_LOCAL;
      expect(shouldRefuseHostFallback()).toBe(false);
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origForce === undefined) delete process.env.EXEC_FORCE_LOCAL;
      else process.env.EXEC_FORCE_LOCAL = origForce;
    }
  });
});

describe('exec: HTTP route', () => {
  it('runs from a pad and persists an EditEvent', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print(1+1)' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stdout.trim()).toBe('2');
    expect(body.exitCode).toBe(0);
    const events = await prisma.editEvent.findMany({ where: { kind: 'run' } });
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown pad', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/nope-nope/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print(1)' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      payload: { source: 'print(1)' },
    });
    expect(res.statusCode).toBe(401);
  });
});
