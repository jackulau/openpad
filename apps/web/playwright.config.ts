import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const apiURL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
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
