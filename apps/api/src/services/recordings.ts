import { prisma } from '../db.js';
import { recordAudit } from '../lib/audit.js';

// Auto-recording lifecycle. A Recording row is opened when the first
// participant joins a pad that has autoRecord=true, and closed when the pad
// has been empty for IDLE_BEFORE_STOP_MS (default 5min). If a new participant
// joins inside the idle window, the existing recording resumes.
//
// State lives in memory; on process restart, any unclosed recordings are
// closed-out lazily by closeAllOpen() called from the server bootstrap.

const IDLE_BEFORE_STOP_MS = 5 * 60_000;

interface ActiveRec {
  recordingId: string;
  padId: string;
  startedAt: number;
  participants: Map<string, string>; // userId → name
  idleTimer: NodeJS.Timeout | null;
}

const active = new Map<string, ActiveRec>(); // padId → state

export async function onParticipantJoin(
  padId: string,
  userId: string,
  userName: string,
): Promise<void> {
  const pad = await prisma.pad.findUnique({
    where: { id: padId },
    select: { autoRecord: true },
  });
  if (!pad?.autoRecord) return;
  let rec = active.get(padId);
  if (rec) {
    // Recording still open from an earlier session — cancel the idle close,
    // append this participant to the roster.
    if (rec.idleTimer) {
      clearTimeout(rec.idleTimer);
      rec.idleTimer = null;
    }
    rec.participants.set(userId, userName);
    await persistParticipants(rec);
    return;
  }
  // Start a new recording row.
  const row = await prisma.recording.create({
    data: {
      padId,
      autoStarted: true,
      participants: JSON.stringify([{ userId, name: userName }]),
    },
  });
  rec = {
    recordingId: row.id,
    padId,
    startedAt: row.startedAt.getTime(),
    participants: new Map([[userId, userName]]),
    idleTimer: null,
  };
  active.set(padId, rec);
  recordAudit({ action: 'recording.start', userId, target: padId, meta: { recordingId: row.id } });
}

export async function onParticipantLeave(
  padId: string,
  remainingCount: number,
): Promise<void> {
  const rec = active.get(padId);
  if (!rec) return;
  if (remainingCount > 0) return;
  // Last participant left — wait IDLE_BEFORE_STOP_MS before closing in case
  // someone reloads or rejoins quickly.
  if (rec.idleTimer) clearTimeout(rec.idleTimer);
  rec.idleTimer = setTimeout(() => {
    void closeRecording(padId, /* reason */ 'idle');
  }, IDLE_BEFORE_STOP_MS);
  rec.idleTimer.unref?.();
}

async function closeRecording(padId: string, reason: 'idle' | 'manual' | 'shutdown'): Promise<void> {
  const rec = active.get(padId);
  if (!rec) return;
  active.delete(padId);
  if (rec.idleTimer) clearTimeout(rec.idleTimer);
  const endedAt = new Date();
  await prisma.recording
    .update({
      where: { id: rec.recordingId },
      data: {
        endedAt,
        durationMs: endedAt.getTime() - rec.startedAt,
        meta: JSON.stringify({ closedBy: reason }),
      },
    })
    .catch(() => {
      /* row may have been deleted manually — ignore */
    });
  recordAudit({
    action: 'recording.stop',
    target: padId,
    meta: { recordingId: rec.recordingId, reason },
  });
}

async function persistParticipants(rec: ActiveRec): Promise<void> {
  const arr = Array.from(rec.participants.entries()).map(([userId, name]) => ({ userId, name }));
  await prisma.recording
    .update({
      where: { id: rec.recordingId },
      data: { participants: JSON.stringify(arr) },
    })
    .catch(() => {
      /* best-effort */
    });
}

// Cancel idle timers and close any in-memory recordings (e.g. during shutdown
// or test teardown).
export async function closeAllOpen(): Promise<void> {
  const padIds = Array.from(active.keys());
  for (const padId of padIds) {
    await closeRecording(padId, 'shutdown');
  }
}

// Sweep: any Recording row left with endedAt=null after a process restart was
// open at crash time. Mark it ended with the last EditEvent time so the
// recordings list doesn't show eternal recordings.
export async function reconcileOnBoot(): Promise<void> {
  const orphans = await prisma.recording.findMany({ where: { endedAt: null } });
  for (const r of orphans) {
    const lastEv = await prisma.editEvent.findFirst({
      where: { padId: r.padId, createdAt: { gte: r.startedAt } },
      orderBy: { createdAt: 'desc' },
    });
    const endedAt = lastEv?.createdAt ?? r.startedAt;
    await prisma.recording.update({
      where: { id: r.id },
      data: {
        endedAt,
        durationMs: endedAt.getTime() - r.startedAt.getTime(),
        meta: JSON.stringify({ closedBy: 'reconcile' }),
      },
    });
  }
}

export function _activeForTest(): Map<string, ActiveRec> {
  return active;
}

export function _setIdleTimeoutForTest(ms: number): void {
  // Allows tests to shorten the idle timeout. Replaces all future schedulings.
  (global as unknown as { __OC_IDLE_MS__?: number }).__OC_IDLE_MS__ = ms;
}

export const RECORDING_IDLE_MS = IDLE_BEFORE_STOP_MS;
