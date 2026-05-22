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

describe('pad unlock brute-force throttle', () => {
  it('blocks the 6th wrong /unlock attempt per (IP, slug) within 60s', async () => {
    // Owner creates a pad with a password
    const ownerRes = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'owner', email: 'owner-unlock@example.com' },
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(ownerRes.statusCode).toBe(201);
    const ownerToken = ownerRes.json().token as string;

    const padRes = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { language: 'python' },
    });
    const slug = padRes.json().pad.slug as string;

    const setPwd = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { password: 'correct-horse-battery-staple', role: 'collaborator' },
    });
    expect(setPwd.statusCode).toBe(200);

    // Attacker (different user) tries to brute-force
    const attackerRes = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'mallory', email: 'mallory-unlock@example.com' },
      headers: { 'x-forwarded-for': '198.51.100.99' },
    });
    const attackerToken = attackerRes.json().token as string;
    const attackerIp = '198.51.100.99';

    let blocked = 0;
    let wrong = 0;
    for (let i = 0; i < 8; i++) {
      const r = await server.inject({
        method: 'POST',
        url: `/api/pads/${slug}/unlock`,
        headers: {
          authorization: `Bearer ${attackerToken}`,
          'x-forwarded-for': attackerIp,
        },
        payload: { password: `wrong-${i}` },
      });
      if (r.statusCode === 401) wrong++;
      else if (r.statusCode === 429) blocked++;
    }
    expect(wrong).toBe(5);
    expect(blocked).toBeGreaterThanOrEqual(3);
  });

  it('different slug has independent counter', async () => {
    // Two pads with passwords, attempt across both — should not cross-block
    const ownerRes = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'owner2', email: 'owner2-unlock@example.com' },
      headers: { 'x-forwarded-for': '198.51.100.10' },
    });
    const ownerToken = ownerRes.json().token as string;

    async function makePadWithPwd(): Promise<string> {
      const p = await server.inject({
        method: 'POST',
        url: '/api/pads',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { language: 'python' },
      });
      const slug = p.json().pad.slug as string;
      await server.inject({
        method: 'PATCH',
        url: `/api/pads/${slug}/password`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { password: 'pad-secret', role: 'collaborator' },
      });
      return slug;
    }

    const slugA = await makePadWithPwd();
    const slugB = await makePadWithPwd();

    const attackerRes = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'mallory2', email: 'mallory2-unlock@example.com' },
      headers: { 'x-forwarded-for': '198.51.100.20' },
    });
    const attackerToken = attackerRes.json().token as string;
    const attackerIp = '198.51.100.20';

    // 5 wrong attempts on slugA → exhaust quota
    for (let i = 0; i < 5; i++) {
      await server.inject({
        method: 'POST',
        url: `/api/pads/${slugA}/unlock`,
        headers: {
          authorization: `Bearer ${attackerToken}`,
          'x-forwarded-for': attackerIp,
        },
        payload: { password: `wrong-a-${i}` },
      });
    }

    // 6th on slugA → 429
    const blockedA = await server.inject({
      method: 'POST',
      url: `/api/pads/${slugA}/unlock`,
      headers: {
        authorization: `Bearer ${attackerToken}`,
        'x-forwarded-for': attackerIp,
      },
      payload: { password: 'still-wrong' },
    });
    expect(blockedA.statusCode).toBe(429);

    // 1st on slugB → 401 (wrong, but quota intact)
    const okB = await server.inject({
      method: 'POST',
      url: `/api/pads/${slugB}/unlock`,
      headers: {
        authorization: `Bearer ${attackerToken}`,
        'x-forwarded-for': attackerIp,
      },
      payload: { password: 'wrong-b' },
    });
    expect(okB.statusCode).toBe(401);
  });
});
