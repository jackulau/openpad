import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const apiURL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: path.join(__dirname_, 'tests', 'e2e', 'global-setup.ts'),
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : [
        {
          command: 'pnpm --filter @opencoder/api dev',
          url: `${apiURL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
          env: {
            // global-setup.ts computes an absolute DATABASE_URL and writes it
            // into process.env BEFORE webServer launches. Fall back to a
            // repo-rooted absolute path so PrismaClient (CWD-relative) and the
            // prisma CLI (schema.prisma-dir-relative) open the SAME file.
            DATABASE_URL:
              process.env.DATABASE_URL ??
              `file:${path.join(__dirname_, '..', '..', 'apps', 'api', 'prisma', 'e2e.db')}`,
            JWT_SECRET:
              process.env.JWT_SECRET ?? 'e2e-secret-must-be-32-characters-long-enough',
            EXEC_FORCE_LOCAL: 'true',
            NODE_ENV: 'development',
            PUBLIC_BASE_URL: 'http://localhost:5173',
          },
        },
        {
          command: 'pnpm --filter @opencoder/web dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
      ],
});
