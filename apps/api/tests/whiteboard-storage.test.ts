import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;

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
    payload: { email: `wb-${Date.now()}@example.com`, name: 'X'},
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  slug = p.json().pad.slug;
});

describe('whiteboard storage', () => {
  it('GET /:slug/whiteboard returns a fileId, creating the row on first call', async () => {
    const r1 = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/whiteboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r1.statusCode).toBe(200);
    const fileId = r1.json().fileId;
    expect(fileId).toBeTruthy();
    const row = await prisma.padFile.findUnique({ where: { id: fileId } });
    expect(row?.language).toBe('whiteboard');
    expect(row?.name).toBe('_whiteboard.draw');
  });

  it('returns the same fileId on repeated calls (idempotent)', async () => {
    const r1 = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/whiteboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    const r2 = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/whiteboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r1.json().fileId).toBe(r2.json().fileId);
  });

  it('whiteboard file is hidden from the regular files list', async () => {
    await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/whiteboard`,
      headers: { authorization: `Bearer ${token}` },
    });
    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const names = detail.json().files.map((f: { name: string }) => f.name);
    expect(names).not.toContain('_whiteboard.draw');
  });

  it('non-viewers cannot access the whiteboard', async () => {
    const otherR = await server.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { email: `wb-o-${Date.now()}@example.com`, name: 'O'},
    });
    const otherToken = otherR.json().token;
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/whiteboard`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
