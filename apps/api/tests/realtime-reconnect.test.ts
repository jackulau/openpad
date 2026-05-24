import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import {
  MSG,
  encodeJSON,
  decodeBinaryWithFile,
  messageType,
} from '../src/ws/protocol.js';

// We need a fixed port for the "restart on same port" check so a client that
// re-dials the URL after server.close() hits the new instance. Use 0 to grab
// an ephemeral port for the first boot, then reboot bound to the same one.

let server: AppServer;
let port = 0;

async function boot(usePort: number): Promise<AppServer> {
  const s = await buildServer({ test: true });
  await s.listen({ host: '127.0.0.1', port: usePort });
  const addr = s.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
  return s;
}

beforeAll(async () => {
  server = await boot(0);
});
afterAll(async () => {
  await server.close().catch(() => {});
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

async function token(): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `rec-${Date.now()}@example.com`, name: 'U' },
  });
  return r.json().token as string;
}

async function newPad(t: string): Promise<{ slug: string; fileId: string }> {
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
  return { slug, fileId: g.json().files[0].id as string };
}

function openWs(slug: string, t: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pad/${slug}`, [`oc.bearer.${t}`]);
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForState(ws: WebSocket, fileId: string, label = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`STATE timeout (${label})`)), 5000);
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
  });
}

describe('Realtime reconnect + state catch-up', () => {
  it('survives server restart on same port; re-HELLO returns STATE for known fileId', async () => {
    const t = await token();
    const { slug, fileId } = await newPad(t);

    // 1. open conn 1, HELLO, get initial STATE
    let ws = await openWs(slug, t);
    const got1 = waitForState(ws, fileId, 'initial');
    ws.send(encodeJSON(MSG.HELLO, { fileId }));
    await got1;

    // 2. kill server and rebuild on the same port
    const savedPort = port;
    await server.close();
    // socket closure propagates; client's onclose fires
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    await closed;

    // tiny delay before rebind so the OS releases the port reliably
    await new Promise((r) => setTimeout(r, 100));
    server = await boot(savedPort);
    expect(port).toBe(savedPort);

    // 3. simulate the client reconnect: open new ws, send HELLO again, expect STATE
    ws = await openWs(slug, t);
    const got2 = waitForState(ws, fileId, 'after-restart');
    ws.send(encodeJSON(MSG.HELLO, { fileId }));
    await got2;
    ws.close();
  }, 30_000);
});
