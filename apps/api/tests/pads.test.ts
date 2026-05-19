import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let otherToken: string;

async function reg(server: AppServer, email: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
  });
  return res.json().token as string;
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
  token = await reg(server, 'owner@b.com');
  otherToken = await reg(server, 'other@b.com');
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('pads', () => {
  it('creates a pad with default language + starter file', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pad.slug).toMatch(/^[a-z]+-[a-z]+-/);
    expect(body.pad.language).toBe('python312');
    expect(body.pad.myRole).toBe('owner');

    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${body.pad.slug}`,
      headers: auth(token),
    });
    expect(detail.statusCode).toBe(200);
    const j = detail.json();
    expect(j.files).toHaveLength(1);
    expect(j.files[0].name).toBe('main.py');
    expect(j.members).toHaveLength(1);
  });

  it('accepts language and kind on create', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: { language: 'go', kind: 'interview', title: 'My Go Pad' },
    });
    expect(res.statusCode).toBe(201);
    // 'go' is an alias that resolves to the default version.
    expect(res.json().pad.language).toBe('go');
    expect(res.json().pad.kind).toBe('interview');
    expect(res.json().pad.title).toBe('My Go Pad');
  });

  it('rejects unknown language', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: { language: 'cobol' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists my pads', async () => {
    await server.inject({ method: 'POST', url: '/api/pads', headers: auth(token), payload: {} });
    await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: { language: 'go' },
    });
    const res = await server.inject({ method: 'GET', url: '/api/pads', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().pads).toHaveLength(2);
  });

  it('hides pads from non-members', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: {},
    });
    const slug = created.json().pad.slug;
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}`,
      headers: auth(otherToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('patches title (owner only)', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: {},
    });
    const slug = created.json().pad.slug;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}`,
      headers: auth(token),
      payload: { title: 'renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pad.title).toBe('renamed');
  });

  it('forbids patch by non-owner', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: {},
    });
    const slug = created.json().pad.slug;
    const pad = await prisma.pad.findUnique({ where: { slug } });
    const otherUser = await prisma.user.findUnique({ where: { email: 'other@b.com' } });
    await prisma.padMember.create({
      data: { padId: pad!.id, userId: otherUser!.id, role: 'collaborator' },
    });

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}`,
      headers: auth(otherToken),
      payload: { title: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes pad as owner', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(token),
      payload: {},
    });
    const slug = created.json().pad.slug;
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const exists = await prisma.pad.findUnique({ where: { slug } });
    expect(exists).toBeNull();
  });
});
