import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;
let padId: string;
let fileId: string;
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
    payload: { email: 'play@b.com', name: 'P', password: 'password1234' },
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(token),
    payload: { language: 'python' },
  });
  slug = p.json().pad.slug;
  const pad = await prisma.pad.findUnique({ where: { slug } });
  padId = pad!.id;
  const files = await prisma.padFile.findMany({ where: { padId } });
  fileId = files[0].id;
});

describe('playback', () => {
  it('returns empty timeline initially', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(0);
  });

  it('records yjs + chat + run events', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello');
    const update = Y.encodeStateAsUpdate(doc);
    const user = await prisma.user.findUnique({ where: { email: 'play@b.com' } });
    await prisma.editEvent.create({
      data: {
        padId,
        fileId,
        kind: 'yjs',
        userId: user!.id,
        payload: Buffer.from(update),
      },
    });
    await prisma.chatMessage.create({
      data: { padId, userId: user!.id, body: 'hi' },
    });
    await prisma.editEvent.create({
      data: {
        padId,
        kind: 'run',
        userId: user!.id,
        payload: Buffer.from(JSON.stringify({ language: 'python', exitCode: 0 })),
      },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events.length).toBe(3);
    const kinds = body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('yjs');
    expect(kinds).toContain('chat');
    expect(kinds).toContain('run');
    // events should be sorted by ts
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i].ts).toBeGreaterThanOrEqual(body.events[i - 1].ts);
    }
  });

  it('rejects non-members', async () => {
    const r = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@b.com', name: 'X', password: 'password1234' },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback`,
      headers: auth(r.json().token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('reconstructs document by applying yjs updates', async () => {
    // simulate edits
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    let prev = Y.encodeStateAsUpdate(doc);
    updates.push(prev);
    doc.getText('content').insert(0, 'hi ');
    const u1 = Y.encodeStateAsUpdate(doc, prev);
    updates.push(u1);
    prev = Y.encodeStateAsUpdate(doc);
    doc.getText('content').insert(3, 'friend');
    const u2 = Y.encodeStateAsUpdate(doc, prev);
    updates.push(u2);

    const user = await prisma.user.findUnique({ where: { email: 'play@b.com' } });
    for (const u of updates) {
      await prisma.editEvent.create({
        data: { padId, fileId, kind: 'yjs', userId: user!.id, payload: Buffer.from(u) },
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/playback`,
      headers: auth(token),
    });
    const body = res.json();
    const yjsEvents = body.events.filter((e: { kind: string }) => e.kind === 'yjs');
    expect(yjsEvents).toHaveLength(3);
    // reconstruct
    const rebuilt = new Y.Doc();
    for (const e of yjsEvents as Array<{ payload: string }>) {
      Y.applyUpdate(rebuilt, new Uint8Array(Buffer.from(e.payload, 'base64')));
    }
    expect(rebuilt.getText('content').toString()).toBe('hi friend');
  });
});
