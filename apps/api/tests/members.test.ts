import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function reg(email: string): Promise<{ token: string; id: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
  });
  return { token: r.json().token, id: r.json().user.id };
}

async function createPad(token: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(token),
    payload: {},
  });
  return r.json().pad.slug;
}

async function inviteAccept(slug: string, ownerToken: string, joinerToken: string): Promise<string> {
  const inv = await server.inject({
    method: 'POST',
    url: `/api/pads/${slug}/invites`,
    headers: auth(ownerToken),
    payload: { role: 'collaborator' },
  });
  const tok = inv.json().invite.token;
  await server.inject({
    method: 'POST',
    url: `/api/invites/${tok}/accept`,
    headers: auth(joinerToken),
    payload: {},
  });
  const detail = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: auth(ownerToken),
  });
  const joinerName = (await server.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: auth(joinerToken),
  })).json().user.id;
  const m = detail.json().members.find((mm: { userId: string }) => mm.userId === joinerName);
  return m.id as string;
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
});

describe('members API', () => {
  it('owner can change a member role from collaborator to viewer', async () => {
    const owner = await reg('mo@a.com');
    const friend = await reg('mf@a.com');
    const slug = await createPad(owner.token);
    const memberId = await inviteAccept(slug, owner.token, friend.token);

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/members/${memberId}`,
      headers: auth(owner.token),
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('viewer');
    const row = await prisma.padMember.findUnique({ where: { id: memberId } });
    expect(row?.role).toBe('viewer');
  });

  it('non-owner cannot change role', async () => {
    const owner = await reg('mo2@a.com');
    const friend = await reg('mf2@a.com');
    const slug = await createPad(owner.token);
    const memberId = await inviteAccept(slug, owner.token, friend.token);

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/members/${memberId}`,
      headers: auth(friend.token),
      payload: { role: 'viewer' },
    });
    // Non-owner gets 404 because canManage check happens after access lookup
    // and friend has access but not manage rights → 403.
    expect([403, 404]).toContain(res.statusCode);
  });

  it('cannot change owner role', async () => {
    const owner = await reg('mo3@a.com');
    const slug = await createPad(owner.token);
    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(owner.token),
    });
    const ownerMember = detail.json().members.find(
      (m: { role: string }) => m.role === 'owner',
    );
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/members/${ownerMember.id}`,
      headers: auth(owner.token),
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('non-owner can leave the pad', async () => {
    const owner = await reg('mo4@a.com');
    const friend = await reg('mf4@a.com');
    const slug = await createPad(owner.token);
    await inviteAccept(slug, owner.token, friend.token);

    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/members/leave`,
      headers: auth(friend.token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(owner.token),
    });
    expect(detail.json().members.find((m: { userId: string }) => m.userId === friend.id)).toBeUndefined();
  });

  it('owner cannot leave (would orphan pad)', async () => {
    const owner = await reg('mo5@a.com');
    const slug = await createPad(owner.token);
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/members/leave`,
      headers: auth(owner.token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('owner_cannot_leave');
  });
});
