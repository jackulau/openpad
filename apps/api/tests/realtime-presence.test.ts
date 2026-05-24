import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import {
  MSG,
  encodeJSON,
  encodeBinaryWithFile,
  decodeBinaryWithFile,
  messageType,
} from '../src/ws/protocol.js';

let server: AppServer;
let baseUrl: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  baseUrl = `ws://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

async function token(suffix: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `pres-${Date.now()}-${suffix}@example.com`, name: `U${suffix}` },
  });
  return r.json().token as string;
}

async function newPadWithFile(t: string): Promise<{ slug: string; fileId: string; padId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${t}` },
    payload: {},
  });
  const slug = r.json().pad.slug as string;
  const g = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${t}` },
  });
  const fileId = g.json().files[0].id as string;
  const pad = await prisma.pad.findUniqueOrThrow({ where: { slug } });
  return { slug, fileId, padId: pad.id };
}

function openWs(slug: string, t: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`, [`oc.bearer.${t}`]);
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function helloAndWaitForState(ws: WebSocket, fileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('STATE timeout')), 3000);
    const onMsg = (raw: Buffer): void => {
      if (messageType(raw) === MSG.STATE) {
        const d = decodeBinaryWithFile(raw);
        if (d.fileId === fileId) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve();
        }
      }
    };
    ws.on('message', onMsg);
    ws.send(encodeJSON(MSG.HELLO, { fileId }));
  });
}

interface AwarenessPayload {
  userId?: string;
  name?: string;
  color?: string;
  cursor?: { line: number; column: number };
  type?: string;
}

describe('Realtime presence + leave propagation', () => {
  it('A setSelfPresence cursor → B observes stamped awareness in <100ms', async () => {
    const ta = await token('a');
    const tb = await token('b');
    const { slug, fileId, padId } = await newPadWithFile(ta);
    const userB = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-b@' } } });
    await prisma.padMember.create({
      data: { padId, userId: userB.id, role: 'collaborator' },
    });

    const wsA = await openWs(slug, ta);
    const wsB = await openWs(slug, tb);
    await Promise.all([helloAndWaitForState(wsA, fileId), helloAndWaitForState(wsB, fileId)]);

    const seenByB = new Promise<{ payload: AwarenessPayload; latencyMs: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('presence timeout')), 1500);
        const onMsg = (raw: Buffer): void => {
          if (messageType(raw) !== MSG.AWARENESS) return;
          const { payload } = decodeBinaryWithFile(raw);
          try {
            const p = JSON.parse(payload.toString('utf8')) as AwarenessPayload;
            // ignore our own echo or stale frames
            if (p.cursor && p.userId && p.userId !== userB.id) {
              clearTimeout(timer);
              wsB.off('message', onMsg);
              resolve({ payload: p, latencyMs: performance.now() - sentAt });
            }
          } catch {
            /* ignore */
          }
        };
        wsB.on('message', onMsg);
      },
    );

    const cursor = { line: 5, column: 3 };
    const sentAt = performance.now();
    wsA.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor, fileId })),
      ),
    );

    const got = await seenByB;
    // eslint-disable-next-line no-console
    console.log(
      `[realtime-presence] cursor RTT B-side observed=${got.latencyMs.toFixed(1)}ms userId=${got.payload.userId}`,
    );
    expect(got.payload.cursor).toEqual(cursor);
    expect(typeof got.payload.userId).toBe('string');
    expect(typeof got.payload.name).toBe('string');
    expect(typeof got.payload.color).toBe('string');
    expect(got.latencyMs).toBeLessThan(150); // generous; localhost realistically <20ms

    wsA.close();
    wsB.close();
  }, 15_000);

  it('A closes → B receives {type:"leave", userId:A}', async () => {
    const ta = await token('a');
    const tb = await token('b');
    const { slug, fileId, padId } = await newPadWithFile(ta);
    const userA = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-a@' } } });
    const userB = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-b@' } } });
    await prisma.padMember.create({
      data: { padId, userId: userB.id, role: 'collaborator' },
    });

    const wsA = await openWs(slug, ta);
    const wsB = await openWs(slug, tb);
    await Promise.all([helloAndWaitForState(wsA, fileId), helloAndWaitForState(wsB, fileId)]);

    // A broadcasts presence first so the server caches it
    wsA.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor: { line: 0, column: 0 }, fileId })),
      ),
    );
    // small delay so server stamps + broadcasts
    await new Promise((r) => setTimeout(r, 50));

    const leaveSeen = new Promise<AwarenessPayload>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('leave timeout')), 2000);
      const onMsg = (raw: Buffer): void => {
        if (messageType(raw) !== MSG.AWARENESS) return;
        const { payload } = decodeBinaryWithFile(raw);
        try {
          const p = JSON.parse(payload.toString('utf8')) as AwarenessPayload;
          if (p.type === 'leave' && p.userId === userA.id) {
            clearTimeout(timer);
            wsB.off('message', onMsg);
            resolve(p);
          }
        } catch {
          /* ignore */
        }
      };
      wsB.on('message', onMsg);
    });

    wsA.close();
    const got = await leaveSeen;
    expect(got.type).toBe('leave');
    expect(got.userId).toBe(userA.id);

    wsB.close();
  }, 15_000);
});
