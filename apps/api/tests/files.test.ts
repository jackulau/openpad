import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  server = await buildServer({ test: true });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'f@b.com', name: 'F', password: 'password1234' },
  });
  token = r.json().token;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(token),
    payload: { language: 'python' },
  });
  slug = p.json().pad.slug;
});

describe('files', () => {
  it('creates a new file', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: 'util.py', content: 'def add(a, b):\n    return a + b\n' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().file.name).toBe('util.py');
    expect(res.json().file.language).toBe('python');
  });

  it('rejects duplicate filename', async () => {
    await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: 'dup.py' },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: 'dup.py' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects slashes in filename', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: '../escape.py' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('renames a file and infers new language', async () => {
    const c = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: 'thing.py' },
    });
    const id = c.json().file.id;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/files/${id}`,
      headers: auth(token),
      payload: { name: 'thing.go' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().file.name).toBe('thing.go');
    expect(res.json().file.language).toBe('go');
  });

  it('deletes a file (but not the last one)', async () => {
    const c = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(token),
      payload: { name: 'aux.py' },
    });
    const id = c.json().file.id;
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}/files/${id}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    // try deleting the last remaining
    const list = await prisma.padFile.findMany({ where: { pad: { slug } } });
    expect(list).toHaveLength(1);
    const lastId = list[0].id;
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}/files/${lastId}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().error).toBe('cannot_delete_last_file');
  });

  it('forbids file ops from non-members', async () => {
    const r = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@b.com', name: 'X', password: 'password1234' },
    });
    const otherToken = r.json().token;
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/files`,
      headers: auth(otherToken),
      payload: { name: 'sneaky.py' },
    });
    expect(res.statusCode).toBe(404);
  });
});
