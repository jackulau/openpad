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

async function guest(email: string): Promise<{ token: string; id: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email, name: 'X' },
  });
  return { token: r.json().token, id: r.json().user.id };
}

async function settle(): Promise<void> {
  // recordAudit fires-and-forgets; flush microtasks so the assertion sees the write.
  await new Promise((r) => setTimeout(r, 50));
}

describe('audit log', () => {
  it('records pad deletion', async () => {
    const { token, id } = await guest('audit-c@example.com');
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

  it('records account deletion', async () => {
    const { token, id } = await guest('audit-d@example.com');
    await server.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { confirm: 'DELETE' },
    });
    await settle();
    const rows = await prisma.auditLog.findMany({ where: { action: 'user.delete' } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(id);
    expect(rows[0].meta).toContain('audit-d@example.com');
  });

  it('records pad password set + clear separately', async () => {
    const { token } = await guest('audit-e@example.com');
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
