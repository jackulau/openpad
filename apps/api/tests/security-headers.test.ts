import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';

let server: AppServer;

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('security headers', () => {
  it('sets X-Frame-Options: DENY on responses', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Referrer-Policy: no-referrer', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets a Content-Security-Policy with worker-src blob:', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(String(csp)).toContain('worker-src');
    expect(String(csp)).toContain('blob:');
    expect(String(csp)).toContain("frame-ancestors 'none'");
  });

  it('hides the X-Powered-By header', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not emit HSTS by default (HTTP-friendly LAN deploys)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('emits HSTS when ENABLE_HSTS=1', async () => {
    process.env.ENABLE_HSTS = '1';
    const hstsServer = await buildServer({ test: true });
    try {
      const res = await hstsServer.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    } finally {
      await hstsServer.close();
      delete process.env.ENABLE_HSTS;
    }
  });
});
