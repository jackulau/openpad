import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let baseUrl: string;

async function token(): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `ws-${Date.now()}@example.com`, name: 'X'},
  });
  return r.json().token as string;
}

async function pad(t: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${t}` },
    payload: {},
  });
  return r.json().pad.slug as string;
}

function wsClose(ws: WebSocket): Promise<number> {
  return new Promise((res) => {
    ws.on('close', (code) => res(code));
    ws.on('error', () => {
      /* errors raced with close are fine */
    });
  });
}

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

describe('WS auth (subprotocol bearer)', () => {
  it('accepts a connection that carries oc.bearer.<token> as subprotocol', async () => {
    const t = await token();
    const slug = await pad(t);
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`, [`oc.bearer.${t}`]);
    const opened = await new Promise<boolean>((res) => {
      ws.once('open', () => res(true));
      ws.once('error', () => res(false));
    });
    expect(opened).toBe(true);
    expect(ws.protocol).toBe(`oc.bearer.${t}`);
    ws.close();
  });

  it('rejects a connection with no subprotocol and no auth header', async () => {
    const t = await token();
    const slug = await pad(t);
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`);
    const code = await wsClose(ws);
    // 4001 = our app-level "unauthenticated"; some upstream layers may close
    // with 1006 if the handshake itself fails before the route runs.
    expect([4001, 1006]).toContain(code);
  });

  it('rejects a connection whose subprotocol carries a bogus token', async () => {
    const t = await token();
    const slug = await pad(t);
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`, [`oc.bearer.not-a-real-jwt`]);
    const code = await wsClose(ws);
    expect([4002, 1006]).toContain(code);
  });

  it('ignores ?token= in the URL (no longer accepted)', async () => {
    const t = await token();
    const slug = await pad(t);
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}?token=${t}`);
    const code = await wsClose(ws);
    // No subprotocol offered → must be unauthenticated.
    expect([4001, 1006]).toContain(code);
  });
});
