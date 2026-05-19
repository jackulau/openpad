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
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
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
  owner = await reg('owner@inv.com');
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(owner),
    payload: {},
  });
  slug = p.json().pad.slug;
});

describe('invites', () => {
  it('owner creates email-bound invite, friend accepts', async () => {
    const friendToken = await reg('friend@inv.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
      payload: { email: 'friend@inv.com', role: 'collaborator' },
    });
    expect(res.statusCode).toBe(201);
    const { invite } = res.json();
    expect(invite.token).toBeTruthy();
    expect(invite.role).toBe('collaborator');

    const accept = await server.inject({
      method: 'POST',
      url: `/api/invites/${invite.token}/accept`,
      headers: auth(friendToken),
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().slug).toBe(slug);

    // Now friend can access pad
    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(friendToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().pad.myRole).toBe('collaborator');
  });

  it('email-bound invite rejects wrong email', async () => {
    const wrong = await reg('wrong@inv.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
      payload: { email: 'right@inv.com', role: 'collaborator' },
    });
    const token = res.json().invite.token;
    const a = await server.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: auth(wrong),
    });
    expect(a.statusCode).toBe(403);
    expect(a.json().error).toBe('wrong_email');
  });

  it('share link works for anyone (multi-use)', async () => {
    const friend1 = await reg('f1@inv.com');
    const friend2 = await reg('f2@inv.com');
    const share = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/share`,
      headers: auth(owner),
      payload: { role: 'viewer' },
    });
    const token = share.json().invite.token;
    const a = await server.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: auth(friend1),
    });
    expect(a.statusCode).toBe(200);
    const b = await server.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: auth(friend2),
    });
    expect(b.statusCode).toBe(200);
  });

  it('expired invite rejected', async () => {
    const friend = await reg('exp@inv.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
      payload: { email: 'exp@inv.com', expiresInHours: 1 },
    });
    const id = res.json().invite.id;
    const token = res.json().invite.token;
    await prisma.invite.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const a = await server.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      headers: auth(friend),
    });
    expect(a.statusCode).toBe(410);
  });

  it('non-owner cannot create invites', async () => {
    const friend = await reg('other@inv.com');
    const padRow = await prisma.pad.findUnique({ where: { slug } });
    const fu = await prisma.user.findUnique({ where: { email: 'other@inv.com' } });
    await prisma.padMember.create({
      data: { padId: padRow!.id, userId: fu!.id, role: 'collaborator' },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/invites`,
      headers: auth(friend),
      payload: { email: 'sneaky@inv.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('preview endpoint returns invite info', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/share`,
      headers: auth(owner),
      payload: { role: 'viewer' },
    });
    const token = res.json().invite.token;
    const preview = await server.inject({
      method: 'GET',
      url: `/api/invites/${token}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().invite.padSlug).toBe(slug);
    expect(preview.json().invite.role).toBe('viewer');
  });

  it('lists and revokes invites', async () => {
    const a = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
      payload: { email: 'a@inv.com' },
    });
    const list = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
    });
    expect(list.json().invites).toHaveLength(1);
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}/invites/${a.json().invite.id}`,
      headers: auth(owner),
    });
    expect(del.statusCode).toBe(200);
    const list2 = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/invites`,
      headers: auth(owner),
    });
    expect(list2.json().invites).toHaveLength(0);
  });
});
