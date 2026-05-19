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

describe('auth: register', () => {
  it('rejects malformed body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'nope', name: '', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
  });

  it('creates user, sets cookie, returns token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'a@b.com', name: 'Alice', password: 'password1234' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe('a@b.com');
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/oc_token=/);
    const user = await prisma.user.findUnique({ where: { email: 'a@b.com' } });
    expect(user?.passwordHash).not.toBe('password1234');
  });

  it('rejects duplicate email', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'b@b.com', name: 'B', password: 'password1234' },
    });
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'B@b.com', name: 'B2', password: 'password1234' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('auth: login', () => {
  beforeEach(async () => {
    await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'login@b.com', name: 'L', password: 'password1234' },
    });
  });

  it('returns 401 on bad password', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@b.com', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns token on good password', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@b.com', password: 'password1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('returns 401 for unknown email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nope@b.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
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
      url: '/api/auth/register',
      payload: { email: 'me@b.com', name: 'Me', password: 'password1234' },
    });
    const token = reg.json().token as string;
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('me@b.com');
  });

  it('returns user with cookie token', async () => {
    const reg = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'cookie@b.com', name: 'C', password: 'password1234' },
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
    expect(res.json().user.email).toBe('cookie@b.com');
  });

  it('logout clears cookie', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/oc_token=;/);
  });
});
