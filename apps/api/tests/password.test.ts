import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let owner: string;
let slug: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function reg(email: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email, name: email.split('@')[0]},
  });
  return r.json().token as string;
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
  owner = await reg('o@pw.com');
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(owner),
    payload: {},
  });
  slug = p.json().pad.slug;
});

describe('pad password', () => {
  it('owner sets and clears password', async () => {
    const set = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: auth(owner),
      payload: { password: 'hunter22' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().hasPassword).toBe(true);
    const pad = await prisma.pad.findUnique({ where: { slug } });
    expect(pad?.passwordHash).toBeTruthy();
    expect(pad?.passwordHash).not.toBe('hunter22');

    const clear = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: auth(owner),
      payload: { password: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().hasPassword).toBe(false);
  });

  it('non-owner cannot set password', async () => {
    const other = await reg('x@pw.com');
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: auth(other),
      payload: { password: 'hunter22' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('unlock with correct password joins user as passwordRole', async () => {
    await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/password`,
      headers: auth(owner),
      payload: { password: 'hunter22', role: 'viewer' },
    });
    const friend = await reg('f@pw.com');
    // friend cannot access before unlock
    const before = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(friend),
    });
    expect(before.statusCode).toBe(404);
    // wrong password
    const wrong = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/unlock`,
      headers: auth(friend),
      payload: { password: 'bad' },
    });
    expect(wrong.statusCode).toBe(401);
    // right password
    const ok = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/unlock`,
      headers: auth(friend),
      payload: { password: 'hunter22' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe('viewer');
    // now access works
    const after = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(friend),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().pad.myRole).toBe('viewer');
  });

  it('unlock returns 400 when pad has no password', async () => {
    const friend = await reg('np@pw.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/unlock`,
      headers: auth(friend),
      payload: { password: 'anything' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_password');
  });
});
