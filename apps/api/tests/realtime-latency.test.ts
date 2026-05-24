import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
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

async function token(suffix = ''): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `lat-${Date.now()}-${suffix}@example.com`, name: `U${suffix}` },
  });
  return r.json().token as string;
}

async function newPadWithFile(t: string): Promise<{ slug: string; fileId: string }> {
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
  return { slug, fileId };
}

function openWs(slug: string, t: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`, [`oc.bearer.${t}`]);
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('close', (code, reason) => {
      // surface early closes so the test fails loudly instead of timing out
      // on STATE wait
      // eslint-disable-next-line no-console
      console.warn(`[ws closed] code=${code} reason=${reason?.toString?.() ?? ''}`);
    });
  });
}

function helloAndWaitForState(ws: WebSocket, fileId: string, label = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`STATE timeout (${label})`)), 5000);
    const onMsg = (raw: Buffer): void => {
      const t = messageType(raw);
      if (t === MSG.ERROR) {
        // eslint-disable-next-line no-console
        console.warn(`[${label}] server ERROR frame:`, raw.slice(1).toString('utf8'));
      }
      if (t === MSG.STATE) {
        const decoded = decodeBinaryWithFile(raw);
        if (decoded.fileId === fileId) {
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

describe('Realtime edit propagation latency (2 clients via WS relay)', () => {
  it('p50 < 50ms and p95 < 200ms on localhost for Yjs updates', async () => {
    const ta = await token('a');
    const tb = await token('b');
    const { slug, fileId } = await newPadWithFile(ta);
    // give b view/edit access by joining as guest via invite-free public pad?
    // pads default to private; grant b membership directly via prisma.
    const padRow = await prisma.pad.findUniqueOrThrow({ where: { slug } });
    const userB = await prisma.user.findFirstOrThrow({ where: { email: { contains: '-b@' } } });
    await prisma.padMember.create({
      data: { padId: padRow.id, userId: userB.id, role: 'collaborator' },
    });

    const wsA = await openWs(slug, ta);
    const wsB = await openWs(slug, tb);
    await Promise.all([
      helloAndWaitForState(wsA, fileId, 'A'),
      helloAndWaitForState(wsB, fileId, 'B'),
    ]);

    const docA = new Y.Doc();
    const samples: number[] = [];
    const N = 30;
    let pending: { sentAt: number; resolve: () => void } | null = null;

    wsB.on('message', (raw: Buffer) => {
      if (messageType(raw) !== MSG.UPDATE) return;
      const { fileId: fid } = decodeBinaryWithFile(raw);
      if (fid !== fileId) return;
      if (pending) {
        samples.push(performance.now() - pending.sentAt);
        const resolve = pending.resolve;
        pending = null;
        resolve();
      }
    });

    for (let i = 0; i < N; i++) {
      const text = docA.getText('content');
      const before = Y.encodeStateVector(docA);
      text.insert(text.length, `x${i}`);
      const update = Y.encodeStateAsUpdateV2(docA, before);
      // server uses V1 updates; use V1 form
      const updateV1 = Y.encodeStateAsUpdate(docA, before);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`recv timeout iter ${i}`)), 1500);
        pending = {
          sentAt: performance.now(),
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        wsA.send(encodeBinaryWithFile(MSG.UPDATE, fileId, updateV1));
      });
      // tiny delay so we don't pipeline (we want per-update RTT)
      await new Promise((r) => setTimeout(r, 5));
      void update;
    }

    wsA.close();
    wsB.close();

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const max = sorted[sorted.length - 1];
    // eslint-disable-next-line no-console
    console.log(
      `[realtime-latency] N=${samples.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`,
    );
    expect(samples.length).toBe(N);
    expect(p50).toBeLessThan(50);
    expect(p95).toBeLessThan(200);
  }, 30_000);
});
