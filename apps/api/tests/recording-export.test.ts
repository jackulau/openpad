import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;
let padId: string;

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
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `exp-${Date.now()}@example.com`, name: 'X'},
  });
  token = r.json().token;
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

describe('recording export', () => {
  it('returns a self-contained JSON bundle with meta + timeline', async () => {
    const rec = await prisma.recording.create({
      data: {
        padId,
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T10:30:00Z'),
        autoStarted: true,
        participants: JSON.stringify([{ userId: 'u1', name: 'Alice' }]),
      },
    });
    await prisma.editEvent.create({
      data: { padId, kind: 'yjs', payload: Buffer.from('x'), createdAt: new Date('2026-01-01T10:05:00Z') },
    });
    await prisma.editEvent.create({
      data: { padId, kind: 'run', payload: Buffer.from('{}'), createdAt: new Date('2026-01-01T10:20:00Z') },
    });

    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/recordings/${rec.id}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.recording.id).toBe(rec.id);
    expect(body.pad.slug).toBe(slug);
    expect(body.recording.participants[0].name).toBe('Alice');
    expect(body.timeline.events).toHaveLength(2);
  });

  it('returns 404 for unknown recording', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/recordings/missing-id/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
