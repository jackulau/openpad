import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

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
    payload: { email: 's@b.com', name: 'S' },
  });
  token = r.json().token;
});

describe('settings — PATCH /me', () => {
  it('changes name', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Renamed');
  });

  it('empty body rejected', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('settings — DELETE /me', () => {
  it('deletes account with confirm token', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { confirm: 'DELETE' },
    });
    expect(res.statusCode).toBe(200);
    const u = await prisma.user.findUnique({ where: { email: 's@b.com' } });
    expect(u).toBeNull();
  });

  it('rejects without confirm token', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
