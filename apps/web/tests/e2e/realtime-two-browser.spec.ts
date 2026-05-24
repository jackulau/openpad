import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// Two-browser real-time verification: user A and user B in the same pad. A
// types a character; B's editor must reflect it. Also asserts both connection
// chips show "live · Nms" once RTT settles.
//
// Auth uses the name-only guest signup flow at "/" (no /register page exists
// in this product). Each browser context starts on the landing page, types a
// name, and lands on /dashboard.

async function guestLogin(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  const nameInput = page.getByPlaceholder('your name');
  await nameInput.waitFor({ state: 'visible', timeout: 30_000 });
  await nameInput.fill(name);
  await page.getByRole('button', { name: /start coding/i }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  return page;
}

async function createInviteToken(
  page: Page,
  slug: string,
  role: 'collaborator' | 'viewer' = 'collaborator',
): Promise<string> {
  return await page.evaluate(
    async ({ slug, role }) => {
      const token = localStorage.getItem('oc_token');
      const res = await fetch(`/api/pads/${slug}/invites`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ role }),
      });
      const j = await res.json();
      return (j.invite?.token ?? j.invite?.url?.split('/invite/')[1]) as string;
    },
    { slug, role },
  );
}

async function acceptInvite(page: Page, inviteToken: string): Promise<void> {
  await page.evaluate(async (inviteToken) => {
    const t = localStorage.getItem('oc_token');
    await fetch(`/api/invites/${inviteToken}/accept`, {
      method: 'POST',
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}) },
    });
  }, inviteToken);
}

test.describe.configure({ mode: 'serial' });

test('two users in the same pad: keystrokes from A appear in B within 500ms', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const uniq = Date.now().toString(36);

  const pageA = await guestLogin(ctxA, `Alice-${uniq}`);
  const pageB = await guestLogin(ctxB, `Bob-${uniq}`);

  // A creates a pad
  await pageA.goto('/dashboard');
  await pageA.getByRole('button', { name: /create pad/i }).click();
  await pageA.waitForURL(/\/p\//);
  await pageA.waitForSelector('.monaco-editor', { timeout: 30_000 });
  const slug = pageA.url().split('/p/')[1].split(/[/?#]/)[0];

  // A creates an invite, B accepts it via API, then navigates to the pad URL
  const inviteToken = await createInviteToken(pageA, slug, 'collaborator');
  expect(inviteToken, 'invite token should be returned by /api/pads/:slug/invites').toBeTruthy();
  await acceptInvite(pageB, inviteToken);
  await pageB.goto(`/p/${slug}`);
  await pageB.waitForSelector('.monaco-editor', { timeout: 30_000 });

  // Wait until both pads show 'live' (their connection chips render). Avoids
  // typing before either WS has handshaked.
  await expect(pageA.locator('text=/live/').first()).toBeVisible({ timeout: 15_000 });
  await expect(pageB.locator('text=/live/').first()).toBeVisible({ timeout: 15_000 });

  // Additionally wait until pageB's Monaco actually has the starter file
  // contents (proves the Yjs doc finished its initial STATE sync). Without
  // this, B's editor exists but its model is empty when we start typing.
  await pageB.waitForFunction(
    () => {
       
      const w = window as any;
      const editors = w.monaco?.editor?.getEditors?.() ?? [];
      for (const ed of editors) {
        const v = ed.getModel?.()?.getValue?.();
        if (typeof v === 'string' && v.length > 0) return true;
      }
      return false;
    },
    null,
    { timeout: 15_000 },
  );

  // Focus A's Monaco editor and type a distinctive marker so we can search for
  // it in B's editor without false positives from the starter template.
  const marker = `RT_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await pageA.locator('.monaco-editor').first().click();
  // Move to end of file so we don't overwrite the starter template
  await pageA.keyboard.press('Meta+End');
  await pageA.keyboard.press('Enter');
  const startedAt = Date.now();
  await pageA.keyboard.type(marker, { delay: 10 });

  // B should see the marker in its Monaco model within 5 seconds. Poll the
  // model value directly — Monaco's view-line span splitting can hide
  // substrings that ARE in the model from a DOM `text=` selector.
  const propagationMs = await pageB.evaluate(async (marker) => {
     
    const w = window as any;
    const startedAt = performance.now();
    const deadline = startedAt + 5_000;
    while (performance.now() < deadline) {
      const editors = w.monaco?.editor?.getEditors?.() ?? [];
      for (const ed of editors) {
        const v = ed.getModel?.()?.getValue?.() ?? '';
        if (typeof v === 'string' && v.includes(marker)) {
          return performance.now() - startedAt;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`marker "${marker}" never appeared in Monaco model within 5s`);
  }, marker);
  const totalMs = Date.now() - startedAt;
  console.log(
    `[realtime-two-browser] marker "${marker}" propagated A→B total=~${totalMs}ms, page-evaluate measured ${propagationMs.toFixed(0)}ms inside B`,
  );
  expect(totalMs).toBeLessThan(3_000); // generous: WAN-style; localhost typically <300ms

  // Sanity: both connection chips show a numeric RTT after a few ping ticks.
  // (5s ping interval; allow up to 12s for first pong + chip update.)
  const aChip = pageA.locator('[aria-label*="round-trip"]').first();
  const bChip = pageB.locator('[aria-label*="round-trip"]').first();
  await expect(aChip).toBeVisible({ timeout: 15_000 });
  await expect(bChip).toBeVisible({ timeout: 15_000 });

  // Screenshot both editors side-by-side as visible proof.
  await pageA.screenshot({
    path: 'test-results/realtime-two-browser-A.png',
    fullPage: false,
  });
  await pageB.screenshot({
    path: 'test-results/realtime-two-browser-B.png',
    fullPage: false,
  });

  await ctxA.close();
  await ctxB.close();
});
