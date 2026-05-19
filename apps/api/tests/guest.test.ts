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

describe('guest signup', () => {
  it('creates an account from just a name', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.name).toBe('Alice');
    expect(body.user.email).toMatch(/@local$/);
  });

  it('token can hit /me', async () => {
    const reg = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Bob' },
    });
    const token = reg.json().token as string;
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.name).toBe('Bob');
  });

  it('two guests with same name get distinct accounts', async () => {
    const a = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Alice' },
    });
    const b = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: 'Alice' },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().user.id).not.toBe(b.json().user.id);
  });

  it('rejects empty name', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
