import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';

let server: AppServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

async function buildWithOrigins(origins?: string): Promise<AppServer> {
  if (origins !== undefined) process.env.ALLOWED_ORIGINS = origins;
  else delete process.env.ALLOWED_ORIGINS;
  return buildServer({ test: true });
}

describe('CORS configuration', () => {
  it('with no ALLOWED_ORIGINS env, reflects request origin (dev-friendly)', async () => {
    server = await buildWithOrigins(undefined);
    const res = await server.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://anywhere.example',
        'access-control-request-method': 'GET',
      },
    });
    // Permissive mode echoes the origin back.
    expect(res.headers['access-control-allow-origin']).toBe('http://anywhere.example');
  });

  it('with ALLOWED_ORIGINS allowlist, allows listed origins', async () => {
    server = await buildWithOrigins('http://localhost:5173,http://192.168.1.143:5173');
    const res = await server.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://192.168.1.143:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://192.168.1.143:5173');
  });

  it('with ALLOWED_ORIGINS allowlist, rejects un-listed origins', async () => {
    server = await buildWithOrigins('http://localhost:5173');
    const res = await server.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://evil.example.com',
        'access-control-request-method': 'GET',
      },
    });
    // Either the preflight is denied, or no Allow-Origin header is set.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('credentials flag is set when origin matches', async () => {
    server = await buildWithOrigins('http://localhost:5173');
    const res = await server.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('same-origin / no-origin requests are not blocked', async () => {
    server = await buildWithOrigins('http://localhost:5173');
    const res = await server.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(res.statusCode).toBe(200);
    await prisma.$disconnect();
  });
});
