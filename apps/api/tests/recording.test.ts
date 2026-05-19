import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import {
  _activeForTest,
  onParticipantJoin,
  onParticipantLeave,
  closeAllOpen,
  reconcileOnBoot,
} from '../src/services/recordings.js';

let server: AppServer;
let userId: string;
let token: string;
let slug: string;
let padId: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.recording.deleteMany();
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: `rec-${Date.now()}@example.com`, name: 'Rec', password: 'password1234' },
  });
  token = r.json().token;
  userId = r.json().user.id;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  slug = p.json().pad.slug;
  const d = await server.inject({
    method: 'GET',
    url: `/api/pads/${slug}`,
    headers: { authorization: `Bearer ${token}` },
  });
  padId = d.json().pad.id;
});

async function enableAutoRecord(): Promise<void> {
  await prisma.pad.update({ where: { id: padId }, data: { autoRecord: true } });
}

describe('recording lifecycle', () => {
  it('does nothing when autoRecord is off', async () => {
    await onParticipantJoin(padId, userId, 'Rec');
    expect(_activeForTest().size).toBe(0);
    const rows = await prisma.recording.findMany();
    expect(rows).toHaveLength(0);
  });

  it('starts a Recording row on first join when autoRecord is on', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'Rec');
    expect(_activeForTest().size).toBe(1);
    const rows = await prisma.recording.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].padId).toBe(padId);
    expect(rows[0].endedAt).toBeNull();
    expect(rows[0].autoStarted).toBe(true);
  });

  it('adds a second participant to the same recording, not a new row', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'Rec');
    await onParticipantJoin(padId, 'second-user', 'Bob');
    const rows = await prisma.recording.findMany();
    expect(rows).toHaveLength(1);
    const parts = JSON.parse(rows[0].participants) as Array<{ userId: string }>;
    expect(parts.map((p) => p.userId).sort()).toEqual(['second-user', userId].sort());
  });

  it('schedules idle close on last leave but stays open during the window', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'Rec');
    await onParticipantLeave(padId, 0);
    const rows = await prisma.recording.findMany();
    expect(rows[0].endedAt).toBeNull();
    expect(_activeForTest().get(padId)?.idleTimer).not.toBeNull();
  });

  it('does not idle-close while participants remain', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'A');
    await onParticipantJoin(padId, 'u2', 'B');
    await onParticipantLeave(padId, 1);
    expect(_activeForTest().get(padId)?.idleTimer).toBeNull();
  });

  it('closeAllOpen() finalises in-flight recordings with durationMs', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'A');
    await closeAllOpen();
    const rows = await prisma.recording.findMany();
    expect(rows[0].endedAt).not.toBeNull();
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(_activeForTest().size).toBe(0);
  });

  it('writes audit rows for start and stop', async () => {
    await enableAutoRecord();
    await onParticipantJoin(padId, userId, 'A');
    await closeAllOpen();
    await new Promise((r) => setTimeout(r, 30));
    const start = await prisma.auditLog.findFirst({ where: { action: 'recording.start' } });
    const stop = await prisma.auditLog.findFirst({ where: { action: 'recording.stop' } });
    expect(start).toBeTruthy();
    expect(stop).toBeTruthy();
  });

  it('reconcileOnBoot closes orphaned recordings from prior crash', async () => {
    // Simulate a recording that was open when the server died: row exists with
    // endedAt=null and no in-memory state.
    const startedAt = new Date(Date.now() - 60_000);
    const orphan = await prisma.recording.create({
      data: {
        padId,
        autoStarted: true,
        startedAt,
        participants: JSON.stringify([{ userId, name: 'Ghost' }]),
      },
    });
    // Drop an EditEvent so reconcile has a "last activity" timestamp to use.
    const lastEvAt = new Date(Date.now() - 30_000);
    await prisma.editEvent.create({
      data: {
        padId,
        kind: 'yjs',
        payload: Buffer.from([1, 2, 3]),
        createdAt: lastEvAt,
      },
    });

    await reconcileOnBoot();

    const after = await prisma.recording.findUnique({ where: { id: orphan.id } });
    expect(after?.endedAt).not.toBeNull();
    expect(after?.durationMs).toBeGreaterThan(0);
    const meta = JSON.parse(after?.meta ?? '{}') as { closedBy?: string };
    expect(meta.closedBy).toBe('reconcile');
  });

  it('reconcileOnBoot is a no-op when no orphaned recordings exist', async () => {
    await reconcileOnBoot();
    const rows = await prisma.recording.findMany();
    expect(rows).toHaveLength(0);
  });
});
