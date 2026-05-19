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
  await prisma.auditLog.deleteMany();
});

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'X', password: 'password1234' },
  });
  return { token: r.json().token, id: r.json().user.id };
}

async function settle(): Promise<void> {
  // recordAudit fires-and-forgets; flush microtasks so the assertion sees the write.
  await new Promise((r) => setTimeout(r, 50));
}

describe('audit log', () => {
  it('records failed login attempts', async () => {
    await register('audit-a@example.com');
    await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'audit-a@example.com', password: 'wrong-password' },
    });
    await settle();
    const rows = await prisma.auditLog.findMany({ where: { action: 'login.fail' } });
    expect(rows.length).toBe(1);
    expect(rows[0].target).toBe('audit-a@example.com');
  });

  it('records password change', async () => {
    const { token, id } = await register('audit-b@example.com');
    await server.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password1234', newPassword: 'new-password-9999' },
    });
    await settle();
    const rows = await prisma.auditLog.findMany({ where: { action: 'user.password.change' } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(id);
  });

  it('records pad deletion', async () => {
    const { token, id } = await register('audit-c@example.com');
    const p = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const slug = p.json().pad.slug;
    await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}`,
      headers: { authorization: `Bearer ${token}` },
    });
    await settle();
    const rows = await prisma.auditLog.findMany({ where: { action: 'pad.delete' } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(id);
    expect(rows[0].target).toBe(slug);
  });

  it('records account deletion with email metadata', async () => {
    const { token, id } = await register('audit-d@example.com');
    await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { confirm: 'DELETE', password: 'password1234' },
    });
    await settle();
    const rows = await prisma.auditLog.findMany({ where: { action: 'user.delete' } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(id);
    expect(rows[0].meta).toContain('audit-d@example.com');
  });

  it('records pad password set + clear separately', async () => {
    const { token } = await register('audit-e@example.com');
    const p = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const slug = p.json().pad.slug;
    await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'shareable-secret', role: 'collaborator' },
    });
    await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: null },
    });
    await settle();
    const set = await prisma.auditLog.findMany({ where: { action: 'pad.password.set' } });
    const cleared = await prisma.auditLog.findMany({ where: { action: 'pad.password.clear' } });
    expect(set.length).toBe(1);
    expect(cleared.length).toBe(1);
  });
});
