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
    url: '/api/auth/register',
    payload: { email: 's@b.com', name: 'S', password: 'password1234' },
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

  it('changes password with correct current', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { currentPassword: 'password1234', newPassword: 'newpassword999' },
    });
    expect(res.statusCode).toBe(200);
    // login with new password works
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 's@b.com', password: 'newpassword999' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects wrong current password', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { currentPassword: 'wrong', newPassword: 'newpassword999' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('wrong_current_password');
  });

  it('requires current password to set new', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { newPassword: 'newpassword999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('current_password_required');
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
  it('deletes account with correct password + confirm', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { confirm: 'DELETE', password: 'password1234' },
    });
    expect(res.statusCode).toBe(200);
    const u = await prisma.user.findUnique({ where: { email: 's@b.com' } });
    expect(u).toBeNull();
  });

  it('rejects wrong password', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { confirm: 'DELETE', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects without confirm token', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: auth(token),
      payload: { password: 'password1234' },
    });
    expect(res.statusCode).toBe(400);
  });
});
