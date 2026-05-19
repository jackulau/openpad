import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let baseUrl: string;

async function reg(email: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
  });
  return r.json().token as string;
}
async function createPad(token: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  return r.json().pad.slug as string;
}

function open(url: string): Promise<{ ws: WebSocket; msgs: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs: Array<Record<string, unknown>> = [];
    ws.on('message', (raw: Buffer) => {
      try {
        msgs.push(JSON.parse(raw.toString('utf8')));
      } catch {
        msgs.push({ raw: raw.toString('utf8') });
      }
    });
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

async function waitFor<T>(
  predicate: () => T | undefined,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  return new Promise<T>((resolve, reject) => {
    const tick = (): void => {
      const v = predicate();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 50);
    };
    tick();
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

describe('terminal WS', () => {
  it('rejects without token', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/terminal/anything`);
    const code = await new Promise<number>((res) => {
      ws.on('close', (c) => res(c));
      ws.on('error', () => {});
    });
    expect(code).toBe(4001);
  });

  it('rejects viewer role', async () => {
    const owner = await reg('o@b.com');
    const slug = await createPad(owner);
    const viewer = await reg('v@b.com');
    const padRow = await prisma.pad.findUnique({ where: { slug } });
    const viewerRow = await prisma.user.findUnique({ where: { email: 'v@b.com' } });
    await prisma.padMember.create({
      data: { padId: padRow!.id, userId: viewerRow!.id, role: 'viewer' },
    });
    const { msgs, ws } = await open(`${baseUrl}/ws/terminal/${slug}?token=${viewer}`);
    const err = await waitFor(() => msgs.find((m) => m.type === 'error'));
    expect(err.error).toBe('forbidden');
    ws.close();
  });

  it('owner gets ready or graceful unavailable', async () => {
    const owner = await reg('owner2@b.com');
    const slug = await createPad(owner);
    const { msgs, ws } = await open(`${baseUrl}/ws/terminal/${slug}?token=${owner}`);
    const first = await waitFor(() =>
      msgs.find((m) => m.type === 'ready' || m.type === 'error'),
    );
    // Either we got a ready (pty available) or graceful error (terminal_unavailable / spawn_failed).
    if (first.type === 'ready') {
      expect(typeof first.shell).toBe('string');
    } else {
      expect(['terminal_unavailable', 'spawn_failed']).toContain(first.error);
    }
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});
