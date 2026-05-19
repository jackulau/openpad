import { describe, expect, it } from 'vitest';
import { generateSlug, randomToken } from '../src/lib/slug.js';

describe('slug + token generation', () => {
  it('produces unique slugs across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateSlug());
    // 2000 trials should produce 2000 distinct slugs unless the PRNG repeats.
    expect(seen.size).toBe(2000);
  });

  it('produces slugs of the adjective-noun-suffix shape', () => {
    for (let i = 0; i < 50; i++) {
      const s = generateSlug();
      expect(s).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{5}$/);
    }
  });

  it('does not call Math.random in the slug code path', async () => {
    // Static check: ensure we use the crypto-backed `randomInt` instead of Math.random.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/lib/slug.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toContain('randomInt');
  });

  it('randomToken returns the requested length with allowed alphabet', () => {
    const t = randomToken(32);
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]+$/);
  });
});
