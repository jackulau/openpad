import { test, expect, type BrowserContext } from '@playwright/test';

function uniqName(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Back-compat shim — auth is guest-only, no email required.
function uniqEmail(label: string): string {
  return uniqName(label);
}

async function registerAndLogin(
  context: BrowserContext,
  name: string,
  _emailIgnored?: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: /Start coding/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.close();
}

test.describe.configure({ mode: 'serial' });

test('clicking Fork in a pad lands on a new pad slug', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const email = uniqEmail('fork');
  await registerAndLogin(ctx, 'Forker', email);
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /create pad/i }).click();
  await page.waitForURL(/\/p\//);
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  const originalSlug = page.url().split('/p/')[1].split(/[/?#]/)[0];

  await page.getByRole('button', { name: /^Fork(ing…)?$/ }).click();
  await page.waitForURL(
    (url) => /\/p\//.test(url.pathname) && !url.pathname.includes(originalSlug),
    { timeout: 15_000 },
  );
  const forkSlug = page.url().split('/p/')[1].split(/[/?#]/)[0];
  expect(forkSlug).not.toBe(originalSlug);
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await ctx.close();
});
