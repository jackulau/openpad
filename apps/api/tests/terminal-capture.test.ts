import { describe, expect, it } from 'vitest';
import { TerminalCapture, type TermFragment } from '../src/services/terminalCapture.js';

interface PersistedBatch {
  rows: TermFragment[];
  meta: { truncated: boolean };
}

function makeCapture(opts: {
  flushIntervalMs?: number;
  flushBufferBytes?: number;
  sessionCapBytes?: number;
}): { cap: TerminalCapture; persisted: PersistedBatch[] } {
  const persisted: PersistedBatch[] = [];
  const cap = new TerminalCapture('pad_x', 'user_x', {
    ...opts,
    persist: async (rows, meta) => {
      persisted.push({ rows, meta });
    },
  });
  return { cap, persisted };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TerminalCapture', () => {
  it('buffers small writes and flushes them on close()', async () => {
    const { cap, persisted } = makeCapture({ flushIntervalMs: 5_000, flushBufferBytes: 4096 });
    cap.recordInput('ls\n');
    cap.recordOutput('a.txt b.txt\n');
    expect(persisted).toHaveLength(0);
    await cap.close();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].rows).toHaveLength(2);
    expect(persisted[0].rows[0]).toMatchObject({ s: 'i', d: 'ls\n' });
    expect(persisted[0].rows[1]).toMatchObject({ s: 'o', d: 'a.txt b.txt\n' });
    expect(persisted[0].meta.truncated).toBe(false);
  });

  it('flushes when the byte threshold is reached without waiting for the timer', async () => {
    const { cap, persisted } = makeCapture({
      flushIntervalMs: 60_000,
      flushBufferBytes: 16,
    });
    cap.recordOutput('1234567890');
    expect(persisted).toHaveLength(0);
    cap.recordOutput('abcdef'); // total 16 bytes — flush
    // flush is fire-and-forget; let the microtask settle.
    await wait(10);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].rows.map((r) => r.d).join('')).toBe('1234567890abcdef');
  });

  it('flushes on the timer when bytes stay below threshold', async () => {
    const { cap, persisted } = makeCapture({
      flushIntervalMs: 30,
      flushBufferBytes: 1024,
    });
    cap.recordOutput('hi');
    expect(persisted).toHaveLength(0);
    await wait(80);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].rows[0].d).toBe('hi');
  });

  it('stops capturing once the session cap is exceeded and marks truncated=true', async () => {
    const { cap, persisted } = makeCapture({
      flushIntervalMs: 5_000,
      flushBufferBytes: 4096,
      sessionCapBytes: 20,
    });
    cap.recordOutput('aaaaaaaa'); // 8 bytes
    cap.recordOutput('bbbbbbbb'); // total 16
    cap.recordOutput('cccccccccc'); // would overflow 20 → truncated flush
    await wait(10);
    expect(cap._capped()).toBe(true);
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    const last = persisted[persisted.length - 1];
    expect(last.meta.truncated).toBe(true);
    expect(last.rows.some((r) => r.d.includes('truncated'))).toBe(true);
    // Further writes are no-ops.
    cap.recordOutput('ignored');
    await cap.close();
    expect(persisted[persisted.length - 1].rows.every((r) => r.d !== 'ignored')).toBe(true);
  });

  it('records both input and output streams distinctly', async () => {
    const { cap, persisted } = makeCapture({ flushIntervalMs: 5_000, flushBufferBytes: 4096 });
    cap.recordInput('hello');
    cap.recordOutput('world');
    await cap.close();
    expect(persisted[0].rows.map((r) => r.s)).toEqual(['i', 'o']);
  });

  it('close() is idempotent', async () => {
    const { cap, persisted } = makeCapture({ flushIntervalMs: 5_000, flushBufferBytes: 4096 });
    cap.recordOutput('x');
    await cap.close();
    await cap.close();
    expect(persisted).toHaveLength(1);
  });
});
