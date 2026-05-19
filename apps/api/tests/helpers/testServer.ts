import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

let tmpDir: string | null = null;

export interface TestEnv {
  dbUrl: string;
  cleanup: () => void;
}

export function setupTestDatabase(): TestEnv {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'opencoder-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const dbUrl = `file:${dbPath}`;
  process.env.DATABASE_URL = dbUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-must-be-32-characters-long';
  execSync('pnpm prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });
  return {
    dbUrl,
    cleanup: () => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    },
  };
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  // Order matters due to FK cascades; deleteMany on each is safe.
  await prisma.editEvent.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.interviewScore.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.padMember.deleteMany();
  await prisma.padFile.deleteMany();
  await prisma.pad.deleteMany();
  await prisma.question.deleteMany();
  await prisma.user.deleteMany();
}
