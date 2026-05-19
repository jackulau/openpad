import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import {
  MSG,
  decodeJSON,
  encodeJSON,
  messageType,
} from '../src/ws/protocol.js';
import { _resetForTest } from '../src/ws/hub.js';

let server: AppServer;
let baseUrl: string;

async function reg(email: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email, name: email.split('@')[0]},
  });
  return r.json().token as string;
}
async function createPad(token: string): Promise<{ slug: string; padId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  const slug = r.json().pad.slug as string;
  const pad = await prisma.pad.findUnique({ where: { slug } });
  return { slug, padId: pad!.id };
}

interface ConnHelper {
  ws: WebSocket;
  next: (type: number, timeoutMs?: number) => Promise<Buffer>;
}
function open(slug: string, token: string): Promise<ConnHelper> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}`, [`oc.bearer.${token}`]);
    ws.binaryType = 'nodebuffer';
    const inbox: Buffer[] = [];
    const waiters: Array<{ type: number; res: (b: Buffer) => void; rej: (e: Error) => void; timer: NodeJS.Timeout }> = [];
    ws.on('message', (buf: Buffer) => {
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].type === messageType(buf)) {
          clearTimeout(waiters[i].timer);
          waiters[i].res(buf);
          waiters.splice(i, 1);
          return;
        }
      }
      inbox.push(buf);
    });
    ws.once('open', () =>
      resolve({
        ws,
        next: (type, timeoutMs = 2000) =>
          new Promise<Buffer>((res, rej) => {
            for (let i = 0; i < inbox.length; i++) {
              if (messageType(inbox[i]) === type) {
                const [buf] = inbox.splice(i, 1);
                res(buf);
                return;
              }
            }
            const timer = setTimeout(
              () => rej(new Error(`timed out waiting for type ${type}`)),
              timeoutMs,
            );
            waiters.push({ type, res, rej, timer });
          }),
      }),
    );
    ws.once('error', reject);
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
  _resetForTest();
});

describe('chat', () => {
  it('messages flow between members', async () => {
    const tokenA = await reg('a@chat.com');
    const { slug, padId } = await createPad(tokenA);
    const tokenB = await reg('b@chat.com');
    const bUser = await prisma.user.findUnique({ where: { email: 'b@chat.com' } });
    await prisma.padMember.create({
      data: { padId, userId: bUser!.id, role: 'collaborator' },
    });

    const a = await open(slug, tokenA);
    const b = await open(slug, tokenB);

    a.ws.send(encodeJSON(MSG.CHAT, { body: 'hi friend' }));
    const got = await b.next(MSG.CHAT);
    const msg = decodeJSON<{ body: string; userName: string }>(got);
    expect(msg.body).toBe('hi friend');
    expect(msg.userName).toBe('a');

    a.ws.close();
    b.ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('persists messages to db', async () => {
    const token = await reg('one@chat.com');
    const { slug, padId } = await createPad(token);
    const c = await open(slug, token);
    c.ws.send(encodeJSON(MSG.CHAT, { body: 'persisted' }));
    await new Promise((r) => setTimeout(r, 200));
    const rows = await prisma.chatMessage.findMany({ where: { padId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('persisted');
    c.ws.close();
  });

  it('ignores empty body', async () => {
    const token = await reg('empty@chat.com');
    const { slug, padId } = await createPad(token);
    const c = await open(slug, token);
    c.ws.send(encodeJSON(MSG.CHAT, { body: '   ' }));
    await new Promise((r) => setTimeout(r, 200));
    const rows = await prisma.chatMessage.findMany({ where: { padId } });
    expect(rows).toHaveLength(0);
    c.ws.close();
  });

  it('rate-limits spam', async () => {
    const token = await reg('spam@chat.com');
    const { slug, padId } = await createPad(token);
    const c = await open(slug, token);
    for (let i = 0; i < 20; i++) {
      c.ws.send(encodeJSON(MSG.CHAT, { body: `msg ${i}` }));
    }
    await new Promise((r) => setTimeout(r, 400));
    const rows = await prisma.chatMessage.findMany({ where: { padId } });
    // rate-limited to ~ MIN_INTERVAL_MS apart, so only a few should land
    expect(rows.length).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);
    c.ws.close();
  });

  it('GET /messages returns history in chronological order', async () => {
    const token = await reg('hist@chat.com');
    const { slug, padId } = await createPad(token);
    const user = await prisma.user.findUnique({ where: { email: 'hist@chat.com' } });
    for (const body of ['first', 'second', 'third']) {
      await prisma.chatMessage.create({
        data: { padId, userId: user!.id, body },
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const msgs = res.json().messages as Array<{ body: string }>;
    expect(msgs.map((m) => m.body)).toEqual(['first', 'second', 'third']);
  });
});
