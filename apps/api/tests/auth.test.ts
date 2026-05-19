import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;

beforeAll(async () => {
  server = await buildServer({ test: true });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('auth: guest signup', () => {
  it('rejects empty name', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
  });

  it('creates user, sets cookie, returns token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.name).toBe('Alice');
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/oc_token=/);
  });

  it('two signups with the same name yield distinct users', async () => {
    const a = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Bob' },
    });
    const b = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Bob' },
    });
    expect(a.json().user.id).not.toBe(b.json().user.id);
  });
});

describe('auth: me + logout', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns user with bearer token', async () => {
    const reg = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Me' },
    });
    const token = reg.json().token as string;
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Me');
  });

  it('returns user with cookie token', async () => {
    const reg = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'C' },
    });
    const setCookie = reg.headers['set-cookie'] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = cookieStr.split(';')[0];
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('C');
  });

  it('logout clears cookie', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/oc_token=;/);
  });
});
