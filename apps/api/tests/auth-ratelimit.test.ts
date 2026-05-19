import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;

beforeAll(async () => {
  server = await buildServer({ test: true, enableRateLimitInTests: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

describe('auth rate limits', () => {
  it('/guest allows 10/minute from a single IP, blocks the 11th', async () => {
    const ip = '203.0.113.42';
    let ok = 0;
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/guest',
        payload: { name: `g${i}` },
        headers: { 'x-forwarded-for': ip },
      });
      if (res.statusCode === 201) ok++;
      else if (res.statusCode === 429) blocked++;
    }
    expect(ok).toBe(10);
    expect(blocked).toBeGreaterThanOrEqual(2);
  });

  it('different IPs have independent counters', async () => {
    const ipA = '203.0.113.50';
    const ipB = '203.0.113.51';
    for (let i = 0; i < 10; i++) {
      const r = await server.inject({
        method: 'POST',
        url: '/api/auth/guest',
        payload: { name: `a${i}` },
        headers: { 'x-forwarded-for': ipA },
      });
      expect(r.statusCode).toBe(201);
    }
    // 11th from A is blocked
    const blockedA = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'overflow-a' },
      headers: { 'x-forwarded-for': ipA },
    });
    expect(blockedA.statusCode).toBe(429);

    // B has its own quota
    const okB = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'first-b' },
      headers: { 'x-forwarded-for': ipB },
    });
    expect(okB.statusCode).toBe(201);
  });
});
