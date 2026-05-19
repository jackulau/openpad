import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'opencoder-db-'));
  dbPath = path.join(tmpDir, 'test.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
  execSync('pnpm prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('db schema', () => {
  it('creates a user and reads it back', async () => {
    const u = await prisma.user.create({
      data: { email: 't1@example.com', name: 'T1', passwordHash: 'hash' },
    });
    expect(u.id).toBeTruthy();
    const found = await prisma.user.findUnique({ where: { email: 't1@example.com' } });
    expect(found?.id).toBe(u.id);
  });

  it('creates a pad with file and member', async () => {
    const owner = await prisma.user.create({
      data: { email: 't2@example.com', name: 'T2', passwordHash: 'hash' },
    });
    const pad = await prisma.pad.create({
      data: {
        slug: 'test-pad',
        title: 'Test',
        language: 'python',
        ownerId: owner.id,
        files: { create: { name: 'main.py', language: 'python', content: 'print(1)' } },
        members: { create: { userId: owner.id, role: 'owner' } },
      },
      include: { files: true, members: true },
    });
    expect(pad.files).toHaveLength(1);
    expect(pad.members).toHaveLength(1);
    expect(pad.members[0].role).toBe('owner');
  });

  it('enforces unique pad.slug', async () => {
    const owner = await prisma.user.create({
      data: { email: 't3@example.com', name: 'T3', passwordHash: 'hash' },
    });
    await prisma.pad.create({
      data: { slug: 'unique-slug', title: 'A', ownerId: owner.id },
    });
    await expect(
      prisma.pad.create({ data: { slug: 'unique-slug', title: 'B', ownerId: owner.id } }),
    ).rejects.toThrow();
  });

  it('cascade deletes pad children when pad is removed', async () => {
    const owner = await prisma.user.create({
      data: { email: 't4@example.com', name: 'T4', passwordHash: 'hash' },
    });
    const pad = await prisma.pad.create({
      data: {
        slug: 'cascade-pad',
        title: 'C',
        ownerId: owner.id,
        files: { create: { name: 'a.py', language: 'python', content: '' } },
      },
    });
    const padId = pad.id;
    await prisma.pad.delete({ where: { id: padId } });
    const files = await prisma.padFile.findMany({ where: { padId } });
    expect(files).toHaveLength(0);
  });
});
