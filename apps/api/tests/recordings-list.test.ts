import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;
let padId: string;

async function register(): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `recs-${Date.now()}@example.com`, name: 'X', password: 'password1234' },
  });
  return r.json().token;
}

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
  await prisma.recording.deleteMany();
  token = await register();
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  slug = p.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${token}` },
  });
  padId = d.json().pad.id;
});

describe('recordings API', () => {
  it('PATCH /:slug/auto-record toggles the flag', async () => {
    const on = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/auto-record`,
      headers: { authorization: `Bearer ${token}` },
      payload: { autoRecord: true },
    });
    expect(on.statusCode).toBe(200);
    const pad = await prisma.pad.findUnique({ where: { id: padId } });
    expect(pad?.autoRecord).toBe(true);
  });

  it('POST /:slug/recordings starts a manual recording', async () => {
    const start = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/recordings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(start.statusCode).toBe(201);
    expect(start.json().recordingId).toBeTruthy();
    const list = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/recordings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().recordings).toHaveLength(1);
    expect(list.json().recordings[0].endedAt).toBeNull();
  });

  it('POST /:slug/recordings/:id/stop closes it with duration', async () => {
    const start = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/recordings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const recordingId = start.json().recordingId;
    await new Promise((r) => setTimeout(r, 20));
    const stop = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/recordings/${recordingId}/stop`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(stop.statusCode).toBe(200);
    const row = await prisma.recording.findUnique({ where: { id: recordingId } });
    expect(row?.endedAt).not.toBeNull();
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('DELETE /:slug/recordings/:id removes the row + audit-logs', async () => {
    const start = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/recordings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const recordingId = start.json().recordingId;
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}/recordings/${recordingId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    const row = await prisma.recording.findUnique({ where: { id: recordingId } });
    expect(row).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    const audit = await prisma.auditLog.findFirst({ where: { action: 'recording.delete' } });
    expect(audit).toBeTruthy();
  });

  it('non-managers cannot toggle autoRecord', async () => {
    const otherToken = await register();
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/auto-record`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { autoRecord: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
