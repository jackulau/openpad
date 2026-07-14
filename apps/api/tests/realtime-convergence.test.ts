import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { ensureFile, getStateAsUpdate, _resetForTest } from '../src/ws/hub.js';
import { truncateAll } from './helpers/testServer.js';

// Regressions for the two silent data-loss paths in the hand-rolled Yjs sync:
//   D3 - concurrent first-touch of a fresh file seeded two independent docs, so
//        the two clients never converged.
//   D2 - a server restart re-seeded a never-edited file from its template with a
//        fresh clientID, duplicating the starter code on every connected client.

let server: AppServer;
let padId: string;
let fileId: string;
let template: string;

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  _resetForTest();
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/guest',
    payload: { email: 'conv@b.com', name: 'C' },
  });
  const token = r.json().token as string;
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: { authorization: `Bearer ${token}` },
    payload: { language: 'python' },
  });
  const slug = p.json().pad.slug as string;
  const pad = await prisma.pad.findUnique({ where: { slug } });
  padId = pad!.id;
  const file = (await prisma.padFile.findMany({ where: { padId } }))[0];
  fileId = file.id;
  template = file.content;
});

describe('realtime convergence', () => {
  it('coalesces concurrent first-touch loads into one shared doc (D3)', async () => {
    _resetForTest();
    const [a, b] = await Promise.all([ensureFile(padId, fileId), ensureFile(padId, fileId)]);
    // Same FileState object ⇒ one seed, one clientID ⇒ both clients converge.
    expect(a).toBe(b);
    expect(a.doc.getText('content').toString()).toBe(template);
  });

  it('persists the seeded state so a restart does not duplicate the template (D2)', async () => {
    _resetForTest();
    // First open seeds the doc and must persist it immediately.
    const first = await ensureFile(padId, fileId);
    const s1 = getStateAsUpdate(first.doc);
    const persisted = await prisma.padFile.findUnique({ where: { id: fileId } });
    expect(persisted?.yjsState).toBeTruthy();

    // A client that already applied the first STATE.
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, s1);
    expect(clientDoc.getText('content').toString()).toBe(template);

    // Simulate an API restart: in-memory rooms are gone, the client re-HELLOs.
    _resetForTest();
    const second = await ensureFile(padId, fileId);
    const s2 = getStateAsUpdate(second.doc);

    // Applying the post-restart STATE must be idempotent (same clientID), not a
    // second independent insert that doubles the starter code.
    Y.applyUpdate(clientDoc, s2);
    expect(clientDoc.getText('content').toString()).toBe(template);
  });
});
