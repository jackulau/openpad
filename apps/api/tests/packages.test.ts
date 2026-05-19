import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import { installCommandFor, parsePackages } from '../src/services/packages.js';

let server: AppServer;
let token: string;
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
  token = await reg('pkg@b.com');
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(token),
    payload: { language: 'python312' },
  });
  slug = p.json().pad.slug;
});

describe('packages (unit)', () => {
  it('builds pip install command for python', () => {
    expect(installCommandFor('python312', { pip: ['numpy', 'pandas'] })).toContain('pip install');
    expect(installCommandFor('python312', { pip: ['numpy'] })).toContain("'numpy'");
  });

  it('quotes safely against shell injection', () => {
    const cmd = installCommandFor('python312', { pip: ["evil; rm -rf /"] });
    // The whole value lives inside a single-quoted string — no unquoted ;rm.
    expect(cmd).toContain("'evil; rm -rf /'");
    // Embedded single quote gets escaped as '\'' (close-quote, literal, reopen).
    const cmd2 = installCommandFor('python312', { pip: ["x'y"] });
    expect(cmd2).toContain("'x'\\''y'");
  });

  it('npm for js, cargo for rust', () => {
    expect(installCommandFor('node20', { npm: ['left-pad'] })).toContain('npm install');
    expect(installCommandFor('rust-stable', { cargo: ['serde'] })).toContain('cargo install');
  });

  it('skips managers irrelevant to language', () => {
    expect(installCommandFor('python312', { npm: ['x'] })).toBe('');
  });

  it('parsePackages tolerates bad JSON', () => {
    expect(parsePackages(null)).toEqual({});
    expect(parsePackages('not-json')).toEqual({});
    expect(parsePackages('{"pip":["x"]}').pip).toEqual(['x']);
  });
});

describe('packages (HTTP)', () => {
  it('owner sets packages, retrieves on pad detail', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/packages`,
      headers: auth(token),
      payload: { pip: ['requests', 'pyyaml'] },
    });
    expect(res.statusCode).toBe(200);
    const pad = await prisma.pad.findUnique({ where: { slug } });
    expect(pad?.packages).toContain('requests');
  });

  it('non-owner cannot set packages', async () => {
    const other = await reg('o@pkg.com');
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/packages`,
      headers: auth(other),
      payload: { pip: ['x'] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects oversized arrays', async () => {
    const huge = Array.from({ length: 200 }, (_, i) => `pkg-${i}`);
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/pads/${slug}/packages`,
      headers: auth(token),
      payload: { pip: huge },
    });
    expect(res.statusCode).toBe(400);
  });
});
