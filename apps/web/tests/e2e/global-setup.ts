import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<void> {
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  // Absolute DATABASE_URL so prisma CLI (resolves relative to schema.prisma
  // dir = apps/api/prisma) and PrismaClient runtime (resolves relative to
  // process.cwd = apps/api when pnpm filter runs) point at the SAME file.
  // A relative `file:./e2e.db` creates the DB at apps/api/prisma/e2e.db
  // during migrate but the server tries to open apps/api/e2e.db — every
  // signup 500s with "Unable to open the database file" (sqlite error 14).
  const dbPath = path.join(repoRoot, 'apps', 'api', 'prisma', 'e2e.db');
  const dbUrl = process.env.DATABASE_URL ?? `file:${dbPath}`;
  const jwtSecret =
    process.env.JWT_SECRET ?? 'e2e-secret-must-be-32-characters-long-enough';
  // Propagate for child processes (and the api dev server Playwright will launch).
  process.env.DATABASE_URL = dbUrl;
  process.env.JWT_SECRET = jwtSecret;
  process.env.EXEC_FORCE_LOCAL = process.env.EXEC_FORCE_LOCAL ?? 'true';
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';

  const envPath: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    JWT_SECRET: jwtSecret,
  };
  execSync('pnpm --filter @opencoder/api prisma:generate', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: envPath,
  });
  const res = spawnSync(
    'pnpm',
    ['--filter', '@opencoder/api', 'exec', 'prisma', 'migrate', 'deploy'],
    { cwd: repoRoot, stdio: 'inherit', env: envPath },
  );
  if (res.status !== 0) {
    throw new Error('prisma migrate deploy failed');
  }
}
