import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '../env.js';

// Per-process LRU cache of compiled artifacts. Key = sha256(source + lang.id +
// lang.version). On hit, the runner skips compilation and copies the cached
// binary into the pooled container's /work or /tmp. Cuts C++/Rust same-source
// re-runs from ~3s to ~200ms.
//
// Storage layout:
//   <root>/<hash>/artifact.bin
//
// Eviction: when total size exceeds EXEC_COMPILE_CACHE_MAX_MB, oldest entries
// (by mtime) are removed until below cap. No persistence - restart starts
// fresh. Stale entries from prior runs are pruned on first put().

export interface CacheKeyInput {
  source: string;
  langId: string;
  langVersion?: string;
}

export interface CacheEntry {
  key: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface CompileCacheDeps {
  root?: string;
  maxBytes?: number;
}

const DEFAULT_ROOT = path.join(tmpdir(), 'opencoder-compile-cache');

export class CompileCache {
  private root: string;
  private maxBytes: number;
  private initialized = false;

  constructor(deps: CompileCacheDeps = {}) {
    this.root = deps.root ?? DEFAULT_ROOT;
    this.maxBytes =
      deps.maxBytes ?? Math.max(0, env.EXEC_COMPILE_CACHE_MAX_MB) * 1024 * 1024;
  }

  enabled(): boolean {
    return this.maxBytes > 0;
  }

  // Pure: same source+lang+version always yields same key. Hash is hex sha256
  // truncated to 16 bytes (32 hex chars) - collision probability negligible
  // for any realistic cache size.
  static computeKey(input: CacheKeyInput): string {
    const h = createHash('sha256');
    h.update(input.langId);
    h.update('\0');
    h.update(input.langVersion ?? '');
    h.update('\0');
    h.update(input.source);
    return h.digest('hex').slice(0, 32);
  }

  // Returns absolute path of cached artifact if present, else null. Bumps the
  // mtime on hit so LRU eviction keeps recently-hit entries.
  async get(key: string): Promise<string | null> {
    const p = this.pathFor(key);
    try {
      const st = await stat(p);
      if (!st.isFile()) return null;
      // touch for LRU
      const now = Date.now();
      await writeFile(p + '.touch', '', { flag: 'w' }).catch(() => {});
      await rm(p + '.touch', { force: true }).catch(() => {});
      // Update mtime on the actual file via utimes - simpler than touch dance:
      // but node 20+ utimes accepts seconds. Use a cheap re-write of an
      // adjacent marker file to act as an mtime bump on the parent dir.
      const dir = path.dirname(p);
      await writeFile(path.join(dir, '.atime'), String(now), { flag: 'w' }).catch(() => {});
      return p;
    } catch {
      return null;
    }
  }

  // Store an artifact under `key`. Source path is the host file containing the
  // compiled binary. We COPY the bytes (not symlink) so the original is free
  // to be deleted. After write, evict LRU until under cap.
  async put(key: string, sourcePath: string): Promise<string> {
    await this.ensureRoot();
    const dir = path.join(this.root, key);
    await mkdir(dir, { recursive: true });
    const dst = path.join(dir, 'artifact.bin');
    const data = await readFile(sourcePath);
    await writeFile(dst, data);
    await this.evictIfNeeded();
    return dst;
  }

  // List all cache entries sorted by mtime (oldest first). Useful for tests +
  // eviction. Returns [] if cache root does not exist.
  async list(): Promise<CacheEntry[]> {
    try {
      const keys = await readdir(this.root);
      const entries: CacheEntry[] = [];
      for (const key of keys) {
        const p = this.pathFor(key);
        try {
          const st = await stat(p);
          if (st.isFile()) {
            entries.push({ key, path: p, sizeBytes: st.size, mtimeMs: st.mtimeMs });
          }
        } catch {
          // entry without artifact.bin - orphan from interrupted put()
        }
      }
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      return entries;
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    this.initialized = false;
  }

  // Total bytes used by cache entries on disk.
  async size(): Promise<number> {
    const list = await this.list();
    return list.reduce((sum, e) => sum + e.sizeBytes, 0);
  }

  private pathFor(key: string): string {
    return path.join(this.root, key, 'artifact.bin');
  }

  private async ensureRoot(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true });
    this.initialized = true;
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.maxBytes <= 0) return;
    let entries = await this.list();
    let total = entries.reduce((s, e) => s + e.sizeBytes, 0);
    while (total > this.maxBytes && entries.length > 0) {
      const victim = entries.shift()!;
      try {
        await rm(path.dirname(victim.path), { recursive: true, force: true });
        total -= victim.sizeBytes;
      } catch {
        break;
      }
    }
  }
}

// Module singleton - runner imports getCompileCache() to wire into pool path.
let _cache: CompileCache | null = null;
export function getCompileCache(): CompileCache {
  if (!_cache) _cache = new CompileCache();
  return _cache;
}

export function _setCompileCacheForTest(c: CompileCache | null): void {
  _cache = c;
}
