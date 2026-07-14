import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { buildTimeline } from '../src/services/playback.js';
import { truncateAll } from './helpers/testServer.js';

// Regression for D7: windowed (recording) playback replayed the first in-window
// incremental Yjs update onto an empty doc, whose base state predated the window,
// leaving the editor blank. buildTimeline must prepend a full-state baseline that
// captures the exact document state at the window start.

let server: AppServer;
let padId: string;
let fileId: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: 'base@b.com', name: 'B' },
  });
  const token = r.json().token as string;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python' },
  });
  const slug = p.json().pad.slug as string;
  padId = (await prisma.pad.findUnique({ where: { slug } }))!.id;
  fileId = (await prisma.padFile.findMany({ where: { padId } }))[0].id;
});

function reconstruct(events: Array<{ kind: string; fileId: string | null; payload?: string }>): string {
  const doc = new Y.Doc();
  for (const e of events) {
    if ((e.kind === 'yjs' || e.kind === 'snapshot') && e.fileId === fileId && e.payload) {
      Y.applyUpdate(doc, new Uint8Array(Buffer.from(e.payload, 'base64')));
    }
  }
  return doc.getText('content').toString();
}

describe('playback windowed baseline', () => {
  it('reconstructs the full document from a mid-history recording window', async () => {
    // Build a document history and capture each incremental update.
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u) => updates.push(u));
    doc.getText('content').insert(0, 'AAA'); // updates[0]
    const snapshot = Y.encodeStateAsUpdate(doc); // full state = "AAA"
    doc.getText('content').insert(3, 'BBB'); // updates[1] - the pre-window gap edit
    doc.getText('content').insert(6, 'CCC'); // updates[2] - the in-window edit

    const t = (ms: number): Date => new Date(1_700_000_000_000 + ms);
    await prisma.editEvent.create({
      data: { padId, fileId, kind: 'snapshot', payload: Buffer.from(snapshot), createdAt: t(100) },
    });
    await prisma.editEvent.create({
      data: { padId, fileId, kind: 'yjs', payload: Buffer.from(updates[1]), createdAt: t(200) },
    });
    await prisma.editEvent.create({
      data: { padId, fileId, kind: 'yjs', payload: Buffer.from(updates[2]), createdAt: t(300) },
    });

    // Recording window opens at t=250, after the gap edit but before the last one.
    const windowed = await buildTimeline(padId, { from: t(250) });
    // The in-window slice alone (no baseline) would only contain updates[2].
    expect(windowed.events.some((e) => e.id === `baseline:${fileId}`)).toBe(true);
    expect(reconstruct(windowed.events)).toBe('AAABBBCCC');
  });
});
