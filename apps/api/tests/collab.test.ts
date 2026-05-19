import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import {
  MSG,
  decodeBinaryWithFile,
  encodeBinaryWithFile,
  encodeJSON,
  messageType,
} from '../src/ws/protocol.js';
import { _resetForTest, flushAllForTest } from '../src/ws/hub.js';

let server: AppServer;
let baseUrl: string;
let port: number;

async function reg(email: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
  });
  return r.json().token as string;
}

async function createPad(token: string): Promise<{ slug: string; fileId: string; padId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  const slug = r.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const fileId = d.json().files[0].id;
  const padId = d.json().pad.id;
  return { slug, fileId, padId };
}

interface Connected {
  ws: WebSocket;
  inbox: Buffer[];
  next: (type: number, timeoutMs?: number) => Promise<Buffer>;
}

function open(slug: string, token: string): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws/pad/${slug}?token=${token}`);
    ws.binaryType = 'nodebuffer';
    const inbox: Buffer[] = [];
    const waiters: Array<{ type: number; resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
    ws.on('message', (buf: Buffer) => {
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].type === messageType(buf)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(buf);
          waiters.splice(i, 1);
          return;
        }
      }
      inbox.push(buf);
    });
    ws.once('open', () =>
      resolve({
        ws,
        inbox,
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
            waiters.push({ type, resolve: res, reject: rej, timer });
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
  port = addr.port;
  baseUrl = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  _resetForTest();
});

describe('collab WS', () => {
  it('rejects without token', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/pad/anything`);
    const code = await new Promise<number>((res) => {
      ws.on('close', (c) => res(c));
      ws.on('error', () => {
        // some servers emit error before close
      });
    });
    expect(code).toBe(4001);
  });

  it('rejects bad pad slug', async () => {
    const token = await reg('a@b.com');
    const conn = await open('non-existent-slug', token);
    const errMsg = await conn.next(MSG.ERROR);
    expect(messageType(errMsg)).toBe(MSG.ERROR);
    conn.ws.close();
  });

  it('two clients sync edits via Yjs', async () => {
    const tokenA = await reg('alice@b.com');
    const { slug, fileId, padId } = await createPad(tokenA);
    const bobToken = await reg('bob@b.com');
    const bobUser = await prisma.user.findUnique({ where: { email: 'bob@b.com' } });
    await prisma.padMember.create({
      data: { padId, userId: bobUser!.id, role: 'collaborator' },
    });

    const a = await open(slug, tokenA);
    const b = await open(slug, bobToken);

    a.ws.send(encodeJSON(MSG.HELLO, { fileId }));
    b.ws.send(encodeJSON(MSG.HELLO, { fileId }));
    await a.next(MSG.STATE);
    await b.next(MSG.STATE);

    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello from alice');
    const update = Y.encodeStateAsUpdate(doc);
    a.ws.send(encodeBinaryWithFile(MSG.UPDATE, fileId, update));

    const buf = await b.next(MSG.UPDATE);
    const { fileId: gotFid, payload } = decodeBinaryWithFile(buf);
    expect(gotFid).toBe(fileId);
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, new Uint8Array(payload));
    expect(remoteDoc.getText('content').toString()).toBe('hello from alice');

    await flushAllForTest();
    const file = await prisma.padFile.findUnique({ where: { id: fileId } });
    expect(file?.content).toContain('hello from alice');

    a.ws.close();
    b.ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('viewer cannot send updates', async () => {
    const tokenA = await reg('owner@b.com');
    const { slug, fileId, padId } = await createPad(tokenA);
    const tokenV = await reg('viewer@b.com');
    const viewer = await prisma.user.findUnique({ where: { email: 'viewer@b.com' } });
    await prisma.padMember.create({
      data: { padId, userId: viewer!.id, role: 'viewer' },
    });

    const a = await open(slug, tokenA);
    const v = await open(slug, tokenV);
    a.ws.send(encodeJSON(MSG.HELLO, { fileId }));
    v.ws.send(encodeJSON(MSG.HELLO, { fileId }));
    await a.next(MSG.STATE);
    await v.next(MSG.STATE);

    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'sneaky');
    v.ws.send(encodeBinaryWithFile(MSG.UPDATE, fileId, Y.encodeStateAsUpdate(doc)));

    const got = await a.next(MSG.UPDATE, 400).catch(() => null);
    expect(got).toBeNull();

    a.ws.close();
    v.ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});
