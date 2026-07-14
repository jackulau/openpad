import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';

let server: AppServer;
let ownerToken: string;
let ownerId: string;
let outsiderToken: string;
let viewerToken: string;
let viewerId: string;
let slug: string;
let padId: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function guest(email: string, name: string): Promise<{ token: string; id: string }> {
  const r = await server.inject({ method: 'POST', url: '/api/auth/guest', payload: { email, name } });
  const j = r.json();
  return { token: j.token, id: j.user.id };
}

// Minimal multipart/form-data body for server.inject (avoids a form-data dep).
function multipart(field: string, filename: string, contentType: string, bytes: Buffer) {
  const boundary = '----octest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, tail]),
  };
}

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG signature + IHDR start

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const owner = await guest('owner@n.com', 'Owner');
  ownerToken = owner.token;
  ownerId = owner.id;
  const outsider = await guest('out@n.com', 'Outsider');
  outsiderToken = outsider.token;
  const viewer = await guest('view@n.com', 'Viewer');
  viewerToken = viewer.token;
  viewerId = viewer.id;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(ownerToken),
    payload: { language: 'python', kind: 'interview' },
  });
  slug = p.json().pad.slug;
  padId = (await prisma.pad.findUnique({ where: { slug } }))!.id;
  await prisma.padMember.create({ data: { padId, userId: viewerId, role: 'viewer' } });
});

describe('notes routes', () => {
  it('owner saves markdown notes, creating + attaching a question', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: `/api/pads/${slug}/notes`,
      headers: auth(ownerToken),
      payload: { title: 'Two Sum', body: '# Two Sum\n\nReturn indices.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().question.body).toContain('Return indices');
    const pad = await prisma.pad.findUnique({ where: { id: padId } });
    expect(pad?.questionId).toBeTruthy();
  });

  it('members read notes; canEdit reflects role; outsiders 404', async () => {
    await server.inject({
      method: 'PUT',
      url: `/api/pads/${slug}/notes`,
      headers: auth(ownerToken),
      payload: { body: 'hello world' },
    });
    const asOwner = await server.inject({ method: 'GET', url: `/api/pads/${slug}/notes`, headers: auth(ownerToken) });
    expect(asOwner.json().canEdit).toBe(true);
    expect(asOwner.json().question.body).toBe('hello world');

    const asViewer = await server.inject({ method: 'GET', url: `/api/pads/${slug}/notes`, headers: auth(viewerToken) });
    expect(asViewer.statusCode).toBe(200);
    expect(asViewer.json().canEdit).toBe(false);

    const asOutsider = await server.inject({ method: 'GET', url: `/api/pads/${slug}/notes`, headers: auth(outsiderToken) });
    expect(asOutsider.statusCode).toBe(404);
  });

  it('owner uploads an image asset and it serves back with its mime', async () => {
    const mp = multipart('file', 'diagram.png', 'image/png', PNG_BYTES);
    const up = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/notes/assets`,
      headers: { ...auth(ownerToken), ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(201);
    const url = up.json().asset.url as string;
    expect(url).toMatch(/^\/api\/assets\//);

    const served = await server.inject({ method: 'GET', url, headers: auth(viewerToken) });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects non-image uploads (415) and non-owner uploads (403)', async () => {
    const txt = multipart('file', 'notes.txt', 'text/plain', Buffer.from('nope'));
    const bad = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/notes/assets`,
      headers: { ...auth(ownerToken), ...txt.headers },
      payload: txt.payload,
    });
    expect(bad.statusCode).toBe(415);

    const png = multipart('file', 'x.png', 'image/png', PNG_BYTES);
    const forbidden = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/notes/assets`,
      headers: { ...auth(viewerToken), ...png.headers },
      payload: png.payload,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('owner deletes an asset; it then 404s', async () => {
    const mp = multipart('file', 'd.png', 'image/png', PNG_BYTES);
    const up = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/notes/assets`,
      headers: { ...auth(ownerToken), ...mp.headers },
      payload: mp.payload,
    });
    const assetId = up.json().asset.id as string;
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/pads/${slug}/notes/assets/${assetId}`,
      headers: auth(ownerToken),
    });
    expect(del.statusCode).toBe(200);
    const gone = await server.inject({ method: 'GET', url: `/api/assets/${assetId}`, headers: auth(ownerToken) });
    expect(gone.statusCode).toBe(404);
  });
});
