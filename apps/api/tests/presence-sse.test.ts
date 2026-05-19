import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import { _resetForTest, addConn, removeConn, type PadConn } from '../src/ws/hub.js';

let server: AppServer;
let port: number;
let token: string;
let padId: string;

async function register(): Promise<{ token: string; userId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: `sse-${Date.now()}@example.com`, name: 'X'},
  });
  return { token: r.json().token, userId: r.json().user.id };
}

async function createPad(t: string): Promise<{ slug: string; padId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${t}` },
    payload: {},
  });
  const slug = r.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${t}` },
  });
  return { slug, padId: d.json().pad.id };
}

function fakeConn(padId: string, userId: string): PadConn {
  return {
    ws: { readyState: 1, send: () => undefined } as unknown as PadConn['ws'],
    userId,
    userName: 'Tester',
    padId,
    color: '#0aa',
    alive: true,
  };
}

beforeAll(async () => {
  server = await buildServer({ test: true });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
  _resetForTest();
  const r = await register();
  token = r.token;
  const p = await createPad(token);
  padId = p.padId;
});

async function readEvents(timeoutMs: number, abort: () => void): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => {
    ac.abort();
    abort();
  }, timeoutMs);
  let buf = '';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/pads/presence`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.includes('event: snapshot')) {
        // Wait briefly so a follow-up snapshot from the test's addConn can land.
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  } catch {
    /* aborted */
  } finally {
    clearTimeout(t);
  }
  return buf;
}

describe('presence SSE', () => {
  it('requires authentication', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/pads/presence`);
    expect(res.status).toBe(401);
  });

  it('streams a snapshot event on connect, then a follow-up on addConn', async () => {
    const conn = fakeConn(padId, 'remote-user');
    // Stagger so we get: initial snapshot (empty), then a delta snapshot.
    setTimeout(() => addConn(conn), 100);
    setTimeout(() => removeConn(conn), 700);

    let cancel = () => {
      /* set after fetch starts */
    };
    const text = await readEvents(1200, () => cancel());

    // Should see at least two snapshot frames (initial + post-add).
    const frames = text.split('\n\n').filter((f) => f.includes('event: snapshot'));
    expect(frames.length).toBeGreaterThanOrEqual(2);
    // One of them should mention our padId with count >= 1.
    const padHit = frames.find((f) => f.includes(`"${padId}":1`));
    expect(padHit).toBeTruthy();
  });
});
