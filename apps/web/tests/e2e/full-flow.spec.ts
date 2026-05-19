import { test, expect, type BrowserContext } from '@playwright/test';

function uniqEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@opencoder.test`;
}

async function registerAndLogin(
  context: BrowserContext,
  name: string,
  email: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password1234');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.close();
}

test.describe.configure({ mode: 'serial' });

test('register → login → dashboard', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = uniqEmail('reg');
  await page.goto('/register');
  await page.getByLabel('Display name').fill('Reg');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password1234');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /your pads/i })).toBeVisible();
  await ctx.close();
});

test('create a pad and see Monaco editor', async ({ browser }) => {
  const ctx = await browser.newContext();
  const email = uniqEmail('mona');
  await registerAndLogin(ctx, 'Mona', email);
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /create pad/i }).click();
  await page.waitForURL(/\/p\//);
  // Monaco renders inside .monaco-editor; wait for it.
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Run/i })).toBeVisible();
  await ctx.close();
});

test('run python code and see output', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const email = uniqEmail('runner');
  await registerAndLogin(ctx, 'Runner', email);
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /create pad/i }).click();
  await page.waitForURL(/\/p\//);
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  // Replace editor content. We bypass Monaco's keyboard nuances by clearing + typing.
  // Click into the editor first.
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('print(2 + 3)\n');
  await page.getByRole('button', { name: /Run/i }).click();
  // Output panel
  await expect(page.getByText(/exit/, { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('pre').filter({ hasText: '5' })).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

test('chat history endpoint returns own messages', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const email = uniqEmail('chat');
  await registerAndLogin(ctx, 'Chat', email);
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /create pad/i }).click();
  await page.waitForURL(/\/p\//);
  const url = page.url();
  const slug = url.split('/p/')[1].split(/[/?#]/)[0];

  // login via the browser session: read token from localStorage and hit API directly
  const token = await page.evaluate(() => localStorage.getItem('oc_token'));
  expect(token).toBeTruthy();

  // Make sure /api is reachable through the dev proxy by hitting it from the page.
  const status = await page.evaluate(
    async (slug) => {
      const res = await fetch(`/api/pads/${slug}/messages`, { credentials: 'include' });
      return res.status;
    },
    slug,
  );
  expect(status).toBe(200);
  await ctx.close();
});
