import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { prisma } from '../db.js';
import { encodeJSON, MSG } from './protocol.js';

export interface PadConn {
  ws: WebSocket;
  userId: string;
  userName: string;
  padId: string;
  color: string;
  alive: boolean;
}

interface FileState {
  doc: Y.Doc;
  dirty: boolean;
  lastFlush: number;
}

interface PadRoom {
  padId: string;
  conns: Set<PadConn>;
  files: Map<string, FileState>; // fileId → state
}

const rooms = new Map<string, PadRoom>();
const PERSIST_INTERVAL_MS = 5_000;
const EVICT_EMPTY_AFTER_MS = 60_000;

let flushTimer: NodeJS.Timeout | null = null;
const emptySince = new Map<string, number>();

// Presence observers: anyone (SSE, REST) that wants live "who's in pad X"
// counts subscribes here. The callback fires on every connect/disconnect with
// the affected padId. Consumers call getPresenceCounts() to read state.
type PresenceObserver = (padId: string) => void;
const presenceObservers = new Set<PresenceObserver>();

function notifyPresence(padId: string): void {
  for (const cb of presenceObservers) {
    try {
      cb(padId);
    } catch {
      /* observer errors must not break the hub */
    }
  }
}

export function subscribePresence(cb: PresenceObserver): () => void {
  presenceObservers.add(cb);
  return () => presenceObservers.delete(cb);
}

export function getPresenceCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [padId, room] of rooms) {
    if (room.conns.size > 0) out[padId] = room.conns.size;
  }
  return out;
}

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

export function getPresenceUsers(padId: string): PresenceUser[] {
  const room = rooms.get(padId);
  if (!room) return [];
  const seen = new Map<string, PresenceUser>();
  for (const c of room.conns) {
    if (!seen.has(c.userId)) {
      seen.set(c.userId, { userId: c.userId, name: c.userName, color: c.color });
    }
  }
  return Array.from(seen.values());
}

function startFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushDirty();
    evictEmpty();
  }, PERSIST_INTERVAL_MS);
  flushTimer.unref?.();
}

export function getOrCreateRoom(padId: string): PadRoom {
  let r = rooms.get(padId);
  if (!r) {
    r = { padId, conns: new Set(), files: new Map() };
    rooms.set(padId, r);
    startFlushLoop();
  }
  return r;
}

// Coalesces concurrent first-touch loads of the same file. Without this, two
// clients opening a brand-new pad within the same DB round-trip window each seed
// their own Y.Doc (different clientIDs); the second overwrites the first in the
// cache, so the two clients get STATE from different docs and never converge.
// Keyed `${padId}:${fileId}`, cleared when the load settles.
const ensureInflight = new Map<string, Promise<FileState>>();

export async function ensureFile(padId: string, fileId: string): Promise<FileState> {
  const room = getOrCreateRoom(padId);
  const cached = room.files.get(fileId);
  if (cached) return cached;
  const key = `${padId}:${fileId}`;
  let p = ensureInflight.get(key);
  if (!p) {
    p = loadFileState(room, fileId).finally(() => ensureInflight.delete(key));
    ensureInflight.set(key, p);
  }
  return p;
}

async function loadFileState(room: PadRoom, fileId: string): Promise<FileState> {
  // A concurrent caller may have populated the cache while we awaited the DB.
  const existing = room.files.get(fileId);
  if (existing) return existing;
  const file = await prisma.padFile.findUnique({ where: { id: fileId } });
  const doc = new Y.Doc();
  let seededFromContent = false;
  if (file?.yjsState && file.yjsState.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(file.yjsState));
  } else if (file?.content) {
    // Seed Y.Text with content
    doc.getText('content').insert(0, file.content);
    seededFromContent = true;
  }
  const st: FileState = { doc, dirty: false, lastFlush: Date.now() };
  room.files.set(fileId, st);
  // Persist the freshly-seeded state right away. Otherwise the doc lives only in
  // memory (dirty=false ⇒ never flushed) and yjsState stays NULL; a server
  // restart then re-seeds from file.content with a NEW clientID, duplicating the
  // template on every client and stranding subsequent edits in pendingStructs.
  // Writing it now pins a stable doc identity across restarts.
  if (seededFromContent && file) {
    try {
      await prisma.padFile.update({
        where: { id: fileId },
        data: { yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)) },
      });
    } catch {
      /* best-effort; the next dirty flush will persist it */
    }
  }
  return st;
}

export function applyUpdate(padId: string, fileId: string, update: Uint8Array): void {
  const room = rooms.get(padId);
  if (!room) return;
  const st = room.files.get(fileId);
  if (!st) return;
  Y.applyUpdate(st.doc, update);
  st.dirty = true;
}

export function getStateAsUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function broadcast(
  padId: string,
  except: WebSocket | null,
  payload: Buffer,
): void {
  const room = rooms.get(padId);
  if (!room) return;
  for (const conn of room.conns) {
    if (conn.ws === except) continue;
    if (conn.ws.readyState !== WebSocket.OPEN) continue;
    conn.ws.send(payload);
  }
}

// Push a "Notes/problem changed" signal to everyone currently in the pad so
// their problem view refetches live (mirrors how editor updates propagate).
// Safe to call from REST handlers: broadcast is a no-op when the room is empty,
// so a save never depends on anyone being connected.
export function broadcastNotesChanged(padId: string): void {
  broadcast(padId, null, encodeJSON(MSG.NOTES, {}));
}

export function addConn(conn: PadConn): void {
  const room = getOrCreateRoom(conn.padId);
  room.conns.add(conn);
  emptySince.delete(conn.padId);
  notifyPresence(conn.padId);
}

export function removeConn(conn: PadConn): void {
  const room = rooms.get(conn.padId);
  if (!room) return;
  room.conns.delete(conn);
  if (room.conns.size === 0) emptySince.set(conn.padId, Date.now());
  notifyPresence(conn.padId);
}

export function listConns(padId: string): PadConn[] {
  const room = rooms.get(padId);
  if (!room) return [];
  return Array.from(room.conns);
}

async function flushDirty(): Promise<void> {
  for (const room of rooms.values()) {
    for (const [fileId, st] of room.files) {
      if (!st.dirty) continue;
      try {
        const state = Y.encodeStateAsUpdate(st.doc);
        const text = st.doc.getText('content').toString();
        await prisma.padFile.update({
          where: { id: fileId },
          data: { yjsState: Buffer.from(state), content: text },
        });
        await prisma.editEvent.create({
          data: {
            padId: room.padId,
            fileId,
            kind: 'snapshot',
            payload: Buffer.from(state),
          },
        });
        st.dirty = false;
        st.lastFlush = Date.now();
      } catch (err) {
        // ignore - flush is best-effort
        void err;
      }
    }
  }
}

function evictEmpty(): void {
  const now = Date.now();
  for (const [padId, since] of emptySince) {
    if (now - since < EVICT_EMPTY_AFTER_MS) continue;
    const room = rooms.get(padId);
    if (room && room.conns.size === 0) {
      rooms.delete(padId);
      emptySince.delete(padId);
    }
  }
}

export async function flushAllForTest(): Promise<void> {
  await flushDirty();
}

export function _resetForTest(): void {
  rooms.clear();
  emptySince.clear();
  ensureInflight.clear();
}
