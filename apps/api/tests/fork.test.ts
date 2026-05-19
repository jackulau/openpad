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
  owner = await reg('o@fork.com');
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(owner),
    payload: { language: 'python312' },
  });
  slug = p.json().pad.slug;
});

describe('pad fork', () => {
  it('owner forks own pad — gets a new pad with copied files', async () => {
    // add a second file to the original
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(owner),
      payload: { name: 'util.py', content: 'def helper(): return 42' },
    });
    const fork = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/fork`,
      headers: auth(owner),
      payload: {},
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().pad.title).toMatch(/fork/);
    const forkSlug = fork.json().pad.slug;
    expect(forkSlug).not.toBe(slug);

    const detail = await server.inject({
      method: 'GET',
      url: `/api/pads/${forkSlug}`,
      headers: auth(owner),
    });
    expect(detail.json().files.map((f: { name: string }) => f.name).sort()).toEqual([
      'main.py',
      'util.py',
    ]);
  });

  it('collaborator can fork to make their own copy', async () => {
    const friend = await reg('f@fork.com');
    const padRow = await prisma.pad.findUnique({ where: { slug } });
    const friendRow = await prisma.user.findUnique({ where: { email: 'f@fork.com' } });
    await prisma.padMember.create({
      data: { padId: padRow!.id, userId: friendRow!.id, role: 'collaborator' },
    });
    const fork = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/fork`,
      headers: auth(friend),
      payload: {},
    });
    expect(fork.statusCode).toBe(201);
    const forkSlug = fork.json().pad.slug;
    const forked = await prisma.pad.findUnique({ where: { slug: forkSlug } });
    expect(forked?.ownerId).toBe(friendRow!.id);
  });

  it('non-member cannot fork', async () => {
    const other = await reg('x@fork.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/fork`,
      headers: auth(other),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('forking an interview pad downgrades the copy to a sandbox', async () => {
    // Create an interview pad with a question link so we can prove both
    // kind and questionId are dropped on the fork.
    // Need an author user for the FK + Prisma-required relation.
    const authorUser = await prisma.user.findFirst();
    if (!authorUser) throw new Error('no user');
    const q = await prisma.question.create({
      data: {
        title: 'two sum',
        body: 'add two numbers',
        language: 'python',
        author: { connect: { id: authorUser.id } },
      },
    });
    const interview = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(owner),
      payload: { language: 'python', kind: 'interview' },
    });
    const interviewSlug = interview.json().pad.slug;
    await prisma.pad.update({
      where: { slug: interviewSlug },
      data: { questionId: q.id },
    });

    const fork = await server.inject({
      method: 'POST',
      url: `/api/pads/${interviewSlug}/fork`,
      headers: auth(owner),
      payload: {},
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().pad.kind).toBe('sandbox');

    const forkSlug = fork.json().pad.slug;
    const forked = await prisma.pad.findUnique({ where: { slug: forkSlug } });
    expect(forked?.kind).toBe('sandbox');
    expect(forked?.questionId).toBeNull();
  });

  it('fork carries packages config', async () => {
    await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/packages`,
      headers: auth(owner),
      payload: { pip: ['numpy'] },
    });
    const fork = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/fork`,
      headers: auth(owner),
      payload: {},
    });
    const forkSlug = fork.json().pad.slug;
    const forked = await prisma.pad.findUnique({ where: { slug: forkSlug } });
    expect(forked?.packages).toContain('numpy');
  });
});
