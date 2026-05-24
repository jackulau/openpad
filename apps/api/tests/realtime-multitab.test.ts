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
    payload: { email: `mt-${Date.now()}-${suffix}@example.com`, name: `U${suffix}` },
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

function waitStateOnHello(ws: WebSocket, fileId: string): Promise<void> {
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

interface Stamped {
  userId?: string;
  connId?: string;
  cursor?: { line: number; column: number };
  type?: string;
}

function collectAwareness(
  ws: WebSocket,
  predicate: (p: Stamped) => boolean,
  count: number,
  timeoutMs = 2000,
): Promise<Stamped[]> {
  return new Promise((resolve, reject) => {
    const out: Stamped[] = [];
    const timer = setTimeout(
      () => reject(new Error(`awareness collect timeout: got ${out.length}/${count}`)),
      timeoutMs,
    );
    const onMsg = (raw: Buffer): void => {
      if (messageType(raw) !== MSG.AWARENESS) return;
      const { payload } = decodeBinaryWithFile(raw);
      try {
        const p = JSON.parse(payload.toString('utf8')) as Stamped;
        if (predicate(p)) {
          out.push(p);
          if (out.length >= count) {
            clearTimeout(timer);
            ws.off('message', onMsg);
            resolve(out);
          }
        }
      } catch {
        /* ignore */
      }
    };
    ws.on('message', onMsg);
  });
}

describe('Realtime multi-tab presence (no stomp)', () => {
  it('one user, two simultaneous WS conns → observer sees both presence entries with distinct connId', async () => {
    const ta = await token('a');
    const tobs = await token('obs');
    const { slug, fileId, padId } = await newPadWithFile(ta);
    const userA = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-a@' } } });
    const userObs = await prisma.user.findFirstOrThrow({
      where: { email: { contains: '-obs@' } },
    });
    await prisma.padMember.create({
      data: { padId, userId: userObs.id, role: 'collaborator' },
    });

    // observer opens first so we can collect awareness from A's tabs as they arrive
    const wsObs = await openWs(slug, tobs);
    await waitStateOnHello(wsObs, fileId);

    // user A opens two tabs
    const wsA1 = await openWs(slug, ta);
    await waitStateOnHello(wsA1, fileId);
    const wsA2 = await openWs(slug, ta);
    await waitStateOnHello(wsA2, fileId);

    // wait for at least 2 awareness frames from userA with distinct connIds
    const collected = collectAwareness(
      wsObs,
      (p) => p.userId === userA.id && !!p.connId && !p.type,
      2,
      2500,
    );

    // both A tabs broadcast distinct cursor presence
    wsA1.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor: { line: 1, column: 0 }, fileId })),
      ),
    );
    wsA2.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor: { line: 9, column: 9 }, fileId })),
      ),
    );

    const seen = await collected;
    const connIds = new Set(seen.map((p) => p.connId));
    // eslint-disable-next-line no-console
    console.log(
      `[realtime-multitab] observer saw ${seen.length} entries, distinct connIds=${connIds.size}`,
    );
    expect(connIds.size).toBe(2);
    // verify cursors are not stomped — the two payloads should carry the two
    // distinct cursor positions
    const cursors = seen.map((p) => p.cursor);
    expect(cursors).toContainEqual({ line: 1, column: 0 });
    expect(cursors).toContainEqual({ line: 9, column: 9 });

    wsA1.close();
    wsA2.close();
    wsObs.close();
  }, 15_000);

  it('closing one of two tabs leaves the other tab visible (leave is connId-scoped)', async () => {
    const ta = await token('a');
    const tobs = await token('obs');
    const { slug, fileId, padId } = await newPadWithFile(ta);
    const userA = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-a@' } } });
    const userObs = await prisma.user.findFirstOrThrow({
      where: { email: { contains: '-obs@' } },
    });
    await prisma.padMember.create({
      data: { padId, userId: userObs.id, role: 'collaborator' },
    });

    const wsObs = await openWs(slug, tobs);
    await waitStateOnHello(wsObs, fileId);

    const wsA1 = await openWs(slug, ta);
    await waitStateOnHello(wsA1, fileId);
    const wsA2 = await openWs(slug, ta);
    await waitStateOnHello(wsA2, fileId);

    const bothAnnounced = collectAwareness(
      wsObs,
      (p) => p.userId === userA.id && !!p.cursor,
      2,
      2500,
    );
    wsA1.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor: { line: 1, column: 0 }, fileId })),
      ),
    );
    wsA2.send(
      encodeBinaryWithFile(
        MSG.AWARENESS,
        fileId,
        Buffer.from(JSON.stringify({ cursor: { line: 2, column: 0 }, fileId })),
      ),
    );
    const both = await bothAnnounced;
    const connA1 = both[0].connId;
    const connA2 = both[1].connId;
    expect(connA1).not.toBe(connA2);

    // close tab 1, wait for leave with that specific connId
    const leave = collectAwareness(
      wsObs,
      (p) => p.type === 'leave' && p.userId === userA.id,
      1,
      2000,
    );
    wsA1.close();
    const [leaveFrame] = await leave;
    expect(leaveFrame.connId).toBe(connA1);

    wsA2.close();
    wsObs.close();
  }, 15_000);
});
