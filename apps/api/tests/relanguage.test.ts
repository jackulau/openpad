import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { templateFor } from '@opencoder/shared';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let token: string;
let slug: string;

async function register(): Promise<void> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `rl-${Date.now()}@example.com`, name: 'X', password: 'password1234' },
  });
  token = r.json().token;
}

async function createPythonPad(): Promise<{ slug: string; fileId: string }> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python312', template: 'hello' },
  });
  const s = r.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${s}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { slug: s, fileId: d.json().files[0].id };
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
});

describe('PATCH /:slug/files/:fileId/relanguage', () => {
  it('renames the file to the new language default + swaps template when pristine', async () => {
    const { slug: s, fileId } = await createPythonPad();
    slug = s;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/files/${fileId}/relanguage`,
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'java21' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.file.name).toBe('Main.java');
    expect(body.file.language).toBe('java21');
    expect(body.contentReplaced).toBe(true);

    // DB content matches Java hello template.
    const row = await prisma.padFile.findUnique({ where: { id: fileId } });
    expect(row?.content).toBe(templateFor('java21', 'hello'));
  });

  it('renames but preserves content when the user has edited the file', async () => {
    const { slug: s, fileId } = await createPythonPad();
    slug = s;
    // User typed real code (not the hello template).
    const userCode = 'print("real work I do not want clobbered")';
    await prisma.padFile.update({ where: { id: fileId }, data: { content: userCode } });

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/files/${fileId}/relanguage`,
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'go122' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().file.name).toBe('main.go');
    expect(res.json().contentReplaced).toBe(false);
    const row = await prisma.padFile.findUnique({ where: { id: fileId } });
    expect(row?.content).toBe(userCode);
    expect(row?.language).toBe('go122');
  });

  it('appends a suffix on filename collision', async () => {
    const { slug: s, fileId } = await createPythonPad();
    // Create a second file already named Main.java to force collision.
    await server.inject({
      method: 'POST',
      url: `/api/pads/${s}/files`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Main.java', language: 'java21', content: '// existing' },
    });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${s}/files/${fileId}/relanguage`,
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'java21' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().file.name).toBe('Main-2.java');
  });

  it('rejects unknown language', async () => {
    const { slug: s, fileId } = await createPythonPad();
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${s}/files/${fileId}/relanguage`,
      headers: { authorization: `Bearer ${token}` },
      payload: { language: 'not-a-real-lang' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects viewers / non-editors', async () => {
    const { slug: s, fileId } = await createPythonPad();
    // make a second user with no membership
    const other = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `rl2-${Date.now()}@example.com`, name: 'O', password: 'password1234' },
    });
    const otherToken = other.json().token;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${s}/files/${fileId}/relanguage`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { language: 'go122' },
    });
    expect(res.statusCode).toBe(404);
  });
});
