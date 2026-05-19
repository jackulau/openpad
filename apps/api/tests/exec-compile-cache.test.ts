import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompileCache } from '../src/exec/compile-cache.js';

let scratchRoot: string;
let cacheRoot: string;

beforeEach(async () => {
  scratchRoot = await mkdtemp(path.join(tmpdir(), 'cc-test-'));
  cacheRoot = path.join(scratchRoot, 'cache');
});

afterEach(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

async function writeBlob(name: string, sizeBytes: number): Promise<string> {
  const p = path.join(scratchRoot, name);
  await writeFile(p, Buffer.alloc(sizeBytes, 0xab));
  return p;
}

describe('exec/compile-cache: computeKey', () => {
  it('is deterministic for identical input', () => {
    const k1 = CompileCache.computeKey({
      source: 'int main(){return 42;}',
      langId: 'cpp20',
      langVersion: 'C++20',
    });
    const k2 = CompileCache.computeKey({
      source: 'int main(){return 42;}',
      langId: 'cpp20',
      langVersion: 'C++20',
    });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[a-f0-9]{32}$/);
  });

  it('changes when source changes', () => {
    const k1 = CompileCache.computeKey({ source: 'a', langId: 'cpp20' });
    const k2 = CompileCache.computeKey({ source: 'b', langId: 'cpp20' });
    expect(k1).not.toBe(k2);
  });

  it('changes when lang version changes', () => {
    const k1 = CompileCache.computeKey({ source: 'a', langId: 'cpp', langVersion: 'C++17' });
    const k2 = CompileCache.computeKey({ source: 'a', langId: 'cpp', langVersion: 'C++20' });
    expect(k1).not.toBe(k2);
  });

  it('changes when langId changes', () => {
    const k1 = CompileCache.computeKey({ source: 'main(){}', langId: 'cpp20' });
    const k2 = CompileCache.computeKey({ source: 'main(){}', langId: 'c' });
    expect(k1).not.toBe(k2);
  });
});

describe('exec/compile-cache: get/put round-trip', () => {
  it('put then get returns the stored artifact path', async () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 1024 * 1024 });
    const src = await writeBlob('mybin', 1024);
    const key = 'abc123';
    const stored = await cache.put(key, src);
    expect(stored).toContain(key);

    const hit = await cache.get(key);
    expect(hit).not.toBeNull();
    expect(hit).toBe(stored);
  });

  it('get returns null on miss', async () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 1024 * 1024 });
    expect(await cache.get('nonexistent')).toBeNull();
  });

  it('put then list shows the entry', async () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 1024 * 1024 });
    const src = await writeBlob('artifact', 2048);
    await cache.put('key1', src);
    const entries = await cache.list();
    expect(entries.length).toBe(1);
    expect(entries[0].key).toBe('key1');
    expect(entries[0].sizeBytes).toBe(2048);
  });
});

describe('exec/compile-cache: LRU eviction', () => {
  it('evicts oldest entries when total exceeds cap', async () => {
    // cap = 4KB; put 3 × 2KB → exceeds → evict oldest
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 4 * 1024 });
    const b1 = await writeBlob('b1', 2048);
    const b2 = await writeBlob('b2', 2048);
    const b3 = await writeBlob('b3', 2048);

    await cache.put('k1', b1);
    await new Promise((r) => setTimeout(r, 20));
    await cache.put('k2', b2);
    await new Promise((r) => setTimeout(r, 20));
    await cache.put('k3', b3);

    const after = await cache.list();
    // k1 should be evicted (oldest), k2 and k3 remain
    expect(after.length).toBe(2);
    expect(after.map((e) => e.key).sort()).toEqual(['k2', 'k3']);
    expect(await cache.size()).toBeLessThanOrEqual(4 * 1024);
  });

  it('keeps all entries when total under cap', async () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 100 * 1024 });
    for (let i = 0; i < 5; i++) {
      const b = await writeBlob(`b${i}`, 1024);
      await cache.put(`k${i}`, b);
    }
    const all = await cache.list();
    expect(all.length).toBe(5);
  });
});

describe('exec/compile-cache: enabled flag', () => {
  it('disabled when maxBytes=0', () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 0 });
    expect(cache.enabled()).toBe(false);
  });

  it('enabled when maxBytes>0', () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 1024 });
    expect(cache.enabled()).toBe(true);
  });
});

describe('exec/compile-cache: clear', () => {
  it('removes all entries', async () => {
    const cache = new CompileCache({ root: cacheRoot, maxBytes: 1024 * 1024 });
    const b = await writeBlob('b', 512);
    await cache.put('k1', b);
    expect((await cache.list()).length).toBe(1);
    await cache.clear();
    expect((await cache.list()).length).toBe(0);
  });
});
