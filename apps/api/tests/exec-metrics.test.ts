import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import { _resetMetricsForTest } from '../src/exec/metrics.js';

let server: AppServer;
let token: string;
let slug: string;
let otherToken: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  _resetMetricsForTest();
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: 'metrics@b.com', name: 'M'},
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python' },
  });
  slug = p.json().pad.slug;
  const o = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: 'other@b.com', name: 'O'},
  });
  otherToken = o.json().token;
});

describe('exec-metrics: counters increment on /run', () => {
  it('totalRuns increments and error path increments totalErrors', async () => {
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print("ok")' },
    });
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'raise SystemExit(2)' },
    });
    const m = await server.inject({
      method: 'GET',
      url: '/api/admin/exec-metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(m.statusCode).toBe(200);
    const body = m.json();
    expect(body.counters.totalRuns).toBe(2);
    expect(body.counters.totalErrors).toBe(1);
  });
});

describe('exec-metrics: /api/admin/exec-metrics access gate', () => {
  it('owner of any pad can read metrics', async () => {
    const r = await server.inject({
      method: 'GET',
      url: '/api/admin/exec-metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.counters).toBeDefined();
    expect(body.pool).toBeDefined();
  });

  it('non-owner is forbidden', async () => {
    const r = await server.inject({
      method: 'GET',
      url: '/api/admin/exec-metrics',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('unauthenticated is rejected', async () => {
    const r = await server.inject({
      method: 'GET',
      url: '/api/admin/exec-metrics',
    });
    expect([401, 403]).toContain(r.statusCode);
  });
});

describe('exec-metrics: per-pad concurrency cap', () => {
  it('rejects the 6th in-flight run with 429 too_many_runs', async () => {
    // Fire 6 sleep(0.6) python runs at once; first 5 admitted, 6th gets 429.
    // We need them in-flight simultaneously - kick off 6 inject promises and
    // race their responses.
    const payload = {
      source: 'import time; time.sleep(0.6); print("done")',
      timeoutMs: 3000,
    };
    const inflight = Array.from({ length: 6 }, () =>
      server.inject({
        method: 'POST',
        url: `/api/pads/${slug}/run`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      }),
    );
    const responses = await Promise.all(inflight);
    const codes = responses.map((r) => r.statusCode).sort();
    const ok = codes.filter((c) => c === 200).length;
    const tooMany = codes.filter((c) => c === 429).length;
    expect(ok).toBe(5);
    expect(tooMany).toBe(1);
    const m = await server.inject({
      method: 'GET',
      url: '/api/admin/exec-metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(m.json().counters.rejected429).toBe(1);
  });

  it('counter resets after runs finish (later requests succeed)', async () => {
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print("done")' },
    });
    const r = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print("again")' },
    });
    expect(r.statusCode).toBe(200);
  });
});
