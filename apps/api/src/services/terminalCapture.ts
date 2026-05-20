import { prisma } from '../db.js';

// Per-recording terminal capture. Batches stdin/stdout fragments and writes a
// row to EditEvent (kind='terminal') so Playback can render the session.
//
// Batching strategy: flush whenever the in-memory buffer reaches FLUSH_BYTES,
// or 500ms passes since the first un-flushed fragment, whichever comes first.
// A hard SESSION_CAP_BYTES limit prevents a noisy terminal from ballooning
// the recording - once hit, capture stops and a "[…truncated]" marker is
// flushed with meta.truncated=true.

const FLUSH_INTERVAL_MS = 500;
const FLUSH_BUFFER_BYTES = 4 * 1024;
const SESSION_CAP_BYTES = 256 * 1024;

export interface TermFragment {
  s: 'i' | 'o';
  d: string;
  t: number;
}

interface CaptureOpts {
  /** Override for tests. */
  flushIntervalMs?: number;
  /** Override for tests. */
  flushBufferBytes?: number;
  /** Override for tests. */
  sessionCapBytes?: number;
  /** Test seam - bypass DB write. */
  persist?: (rows: TermFragment[], meta: { truncated: boolean }) => Promise<void>;
}

export class TerminalCapture {
  private padId: string;
  private userId: string | null;
  private buf: TermFragment[] = [];
  private bufBytes = 0;
  private totalBytes = 0;
  private capped = false;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly flushBufferBytes: number;
  private readonly sessionCapBytes: number;
  private readonly persistFn: (
    rows: TermFragment[],
    meta: { truncated: boolean },
  ) => Promise<void>;

  constructor(padId: string, userId: string | null, opts: CaptureOpts = {}) {
    this.padId = padId;
    this.userId = userId;
    this.flushIntervalMs = opts.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.flushBufferBytes = opts.flushBufferBytes ?? FLUSH_BUFFER_BYTES;
    this.sessionCapBytes = opts.sessionCapBytes ?? SESSION_CAP_BYTES;
    this.persistFn = opts.persist ?? ((rows, meta) => this.defaultPersist(rows, meta));
  }

  recordInput(data: string): void {
    this.append('i', data);
  }

  recordOutput(data: string): void {
    this.append('o', data);
  }

  private append(s: 'i' | 'o', d: string): void {
    if (this.closed || this.capped || d.length === 0) return;
    const len = Buffer.byteLength(d, 'utf8');
    if (this.totalBytes + len > this.sessionCapBytes) {
      // Last write: emit a truncation marker, then disable further capture.
      this.capped = true;
      this.buf.push({ s, d: '[…truncated]', t: Date.now() });
      this.bufBytes += 14;
      void this.flush({ truncated: true });
      return;
    }
    this.totalBytes += len;
    this.buf.push({ s, d, t: Date.now() });
    this.bufBytes += len;
    if (this.bufBytes >= this.flushBufferBytes) {
      void this.flush({ truncated: false });
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.flush({ truncated: false });
      }, this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buf.length > 0) {
      await this.flush({ truncated: false });
    }
  }

  private async flush(meta: { truncated: boolean }): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buf.length === 0) return;
    const batch = this.buf;
    this.buf = [];
    this.bufBytes = 0;
    try {
      await this.persistFn(batch, meta);
    } catch {
      // best-effort - capture errors must never disrupt the live terminal
    }
  }

  private async defaultPersist(
    rows: TermFragment[],
    meta: { truncated: boolean },
  ): Promise<void> {
    await prisma.editEvent.create({
      data: {
        padId: this.padId,
        userId: this.userId,
        kind: 'terminal',
        payload: Buffer.from(JSON.stringify(rows)),
        meta: meta.truncated ? JSON.stringify({ truncated: true }) : null,
      },
    });
  }

  // Test introspection.
  _bufferedFragments(): number {
    return this.buf.length;
  }

  _totalBytes(): number {
    return this.totalBytes;
  }

  _capped(): boolean {
    return this.capped;
  }
}
