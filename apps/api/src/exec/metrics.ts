// Process-wide exec metrics + per-pad concurrency tracking. Plain in-memory
// counters — no Prometheus dependency, no histograms. Exposed via
// /api/admin/exec-metrics for ad-hoc inspection.

import { env } from '../env.js';

export interface ExecCounters {
  totalRuns: number;
  totalErrors: number;
  poolHits: number;
  poolMisses: number;
  compileCacheHits: number;
  compileCacheMisses: number;
  streamRuns: number;
  rejected429: number;
}

const counters: ExecCounters = {
  totalRuns: 0,
  totalErrors: 0,
  poolHits: 0,
  poolMisses: 0,
  compileCacheHits: 0,
  compileCacheMisses: 0,
  streamRuns: 0,
  rejected429: 0,
};

const inFlightPerPad = new Map<string, number>();

export function getExecCounters(): ExecCounters {
  return { ...counters };
}

export function getInFlight(padId: string): number {
  return inFlightPerPad.get(padId) ?? 0;
}

// Returns true if the request was admitted and the counter incremented; false
// if the pad has reached EXEC_PER_PAD_CONCURRENCY. Caller MUST call
// releaseRun() exactly once when the run finishes (success or failure).
export function tryReserveRun(padId: string): boolean {
  const cur = inFlightPerPad.get(padId) ?? 0;
  if (cur >= env.EXEC_PER_PAD_CONCURRENCY) {
    counters.rejected429++;
    return false;
  }
  inFlightPerPad.set(padId, cur + 1);
  return true;
}

export function releaseRun(padId: string): void {
  const cur = inFlightPerPad.get(padId) ?? 0;
  if (cur <= 1) inFlightPerPad.delete(padId);
  else inFlightPerPad.set(padId, cur - 1);
}

export function incCounter(key: keyof ExecCounters, by = 1): void {
  counters[key] += by;
}

// Test helper: reset to zero. Not exported in production index, only consumed
// by tests + the test-fixture truncate path.
export function _resetMetricsForTest(): void {
  counters.totalRuns = 0;
  counters.totalErrors = 0;
  counters.poolHits = 0;
  counters.poolMisses = 0;
  counters.compileCacheHits = 0;
  counters.compileCacheMisses = 0;
  counters.streamRuns = 0;
  counters.rejected429 = 0;
  inFlightPerPad.clear();
}
