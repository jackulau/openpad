import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;
let padId: string;

async function register(): Promise<void> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `runcap-${Date.now()}@example.com`, name: 'X', password: 'password1234' },
  });
  token = r.json().token;
}

async function createPad(): Promise<void> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python312' },
  });
  slug = r.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${token}` },
  });
  padId = d.json().pad.id;
}

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
  await register();
  await createPad();
});

describe('run output capture', () => {
  it('persists stdout in the EditEvent payload so playback can replay it', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'print("hello, recorder")' },
    });
    expect(res.statusCode).toBe(200);

    const ev = await prisma.editEvent.findFirst({
      where: { padId, kind: 'run' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ev).toBeTruthy();
    const meta = JSON.parse(ev!.payload.toString('utf8'));
    expect(meta.stdout).toMatch(/hello, recorder/);
    expect(meta.stdoutTruncated).toBe(false);
    expect(meta.stdoutLen).toBeGreaterThan(0);
  });

  it('marks stdoutTruncated=true when output exceeds the 64KB cap', async () => {
    // Generate ~90KB of output to trigger truncation.
    const src = `print("X" * 90000)`;
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: src },
    });
    expect(res.statusCode).toBe(200);
    const ev = await prisma.editEvent.findFirst({
      where: { padId, kind: 'run' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = JSON.parse(ev!.payload.toString('utf8'));
    expect(meta.stdoutLen).toBeGreaterThan(64 * 1024);
    expect(meta.stdoutTruncated).toBe(true);
    expect(meta.stdout.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('persists stderr separately from stdout', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: 'import sys; sys.stderr.write("uh oh\\n"); print("ok")' },
    });
    expect(res.statusCode).toBe(200);
    const ev = await prisma.editEvent.findFirst({
      where: { padId, kind: 'run' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = JSON.parse(ev!.payload.toString('utf8'));
    expect(meta.stdout).toMatch(/ok/);
    expect(meta.stderr).toMatch(/uh oh/);
  });
});
