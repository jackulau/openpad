import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let owner: string;

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
  owner = await reg('iv@b.com');
});

describe('questions CRUD', () => {
  it('creates and lists questions', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/questions',
      headers: auth(owner),
      payload: {
        title: 'Reverse a string',
        body: 'Write a function that reverses a given string.',
        difficulty: 'easy',
        language: 'python',
      },
    });
    const list = await server.inject({
      method: 'GET',
      url: '/api/questions',
      headers: auth(owner),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().questions).toHaveLength(1);
  });

  it('forbids editing others questions', async () => {
    const other = await reg('z@b.com');
    const c = await server.inject({
      method: 'POST',
      url: '/api/questions',
      headers: auth(owner),
      payload: { title: 'A', body: 'body' },
    });
    const id = c.json().question.id;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/questions/${id}`,
      headers: auth(other),
      payload: { title: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('interview pad', () => {
  let slug: string;
  let qId: string;
  beforeEach(async () => {
    const p = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(owner),
      payload: { kind: 'interview', language: 'python' },
    });
    slug = p.json().pad.slug;
    const q = await server.inject({
      method: 'POST',
      url: '/api/questions',
      headers: auth(owner),
      payload: { title: 'FizzBuzz', body: 'Print 1..100.', language: 'python' },
    });
    qId = q.json().question.id;
  });

  it('owner sees interviewer view with empty score, candidate sees only question', async () => {
    // attach question
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/interview/attach`,
      headers: auth(owner),
      payload: { questionId: qId },
    });
    // owner GET
    const ownerRes = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/interview`,
      headers: auth(owner),
    });
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.json().role).toBe('interviewer');
    expect(ownerRes.json().question.title).toBe('FizzBuzz');
    expect(ownerRes.json().score).toBeNull();

    // candidate joins
    const candidate = await reg('cand@b.com');
    const padRow = await prisma.pad.findUnique({ where: { slug } });
    const candUser = await prisma.user.findUnique({ where: { email: 'cand@b.com' } });
    await prisma.padMember.create({
      data: { padId: padRow!.id, userId: candUser!.id, role: 'candidate' },
    });
    const candRes = await server.inject({
      method: 'GET',
      url: `/api/pads/${slug}/interview`,
      headers: auth(candidate),
    });
    expect(candRes.statusCode).toBe(200);
    expect(candRes.json().role).toBe('candidate');
    expect(candRes.json().question.title).toBe('FizzBuzz');
    expect(candRes.json().score).toBeUndefined();
  });

  it('owner can score; candidate cannot', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/interview/score`,
      headers: auth(owner),
      payload: {
        correctness: 4,
        style: 3,
        communication: 5,
        problemSolving: 4,
        notes: 'strong fundamentals',
        decision: 'hire',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().score.correctness).toBe(4);
    expect(res.json().score.decision).toBe('hire');

    const candidate = await reg('cand2@b.com');
    const padRow = await prisma.pad.findUnique({ where: { slug } });
    const candUser = await prisma.user.findUnique({ where: { email: 'cand2@b.com' } });
    await prisma.padMember.create({
      data: { padId: padRow!.id, userId: candUser!.id, role: 'candidate' },
    });
    const cand = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/interview/score`,
      headers: auth(candidate),
      payload: { correctness: 5 },
    });
    expect(cand.statusCode).toBe(403);
  });

  it('non-interview pad returns 400 on interview endpoints', async () => {
    const sandboxPad = await server.inject({
      method: 'POST',
      url: '/api/pads',
      headers: auth(owner),
      payload: { kind: 'sandbox' },
    });
    const sb = sandboxPad.json().pad.slug;
    const res = await server.inject({
      method: 'GET',
      url: `/api/pads/${sb}/interview`,
      headers: auth(owner),
    });
    expect(res.statusCode).toBe(400);
  });
});
