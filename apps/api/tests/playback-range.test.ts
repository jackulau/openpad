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
    url: '/api/auth/register',
    payload: { email: `pbr-${Date.now()}@example.com`, name: 'X', password: 'password1234' },
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python312' },
  });
  slug = p.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${token}` },
  });
  padId = d.json().pad.id;
});

async function insertEvent(at: Date, kind = 'yjs'): Promise<void> {
  await prisma.editEvent.create({
    data: { padId, kind, payload: Buffer.from('x'), createdAt: at },
  });
}

describe('playback by recording', () => {
  it('returns everything when no recording filter is given', async () => {
    await insertEvent(new Date('2026-01-01T10:00:00Z'));
    await insertEvent(new Date('2026-01-01T10:05:00Z'));
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(2);
  });

  it('trims to the recording window when ?recording=<id> is provided', async () => {
    await insertEvent(new Date('2026-01-01T09:00:00Z')); // before window
    await insertEvent(new Date('2026-01-01T10:10:00Z')); // inside window
    await insertEvent(new Date('2026-01-01T10:20:00Z')); // inside window
    await insertEvent(new Date('2026-01-01T11:00:00Z')); // after window
    const rec = await prisma.recording.create({
      data: {
        padId,
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T10:30:00Z'),
        autoStarted: false,
        participants: '[]',
      },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback?recording=${rec.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(2);
    expect(res.json().recordingId).toBe(rec.id);
  });

  it('returns 404 for an unknown recording id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback?recording=does-not-exist`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a recording id that belongs to another pad', async () => {
    const otherPad = await prisma.pad.create({
      data: { slug: 'other-pad-1', title: 't', language: 'python312', ownerId: padId.slice(0, 25) + 'a' },
    }).catch(async () => {
      const r2 = await server.inject({
        method: 'POST',
        url: '/api/pads',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      return prisma.pad.findUnique({ where: { id: r2.json().pad.id } });
    });
    if (!otherPad) throw new Error('failed to set up second pad');
    const rec = await prisma.recording.create({
      data: { padId: otherPad.id, startedAt: new Date(), autoStarted: false, participants: '[]' },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback?recording=${rec.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
