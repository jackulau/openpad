import { WebSocket } from 'ws';
import {
  MSG,
  decodeBinaryWithFile,
  decodeJSON,
  encodeBinaryWithFile,
  encodeJSON,
  messageType,
  type MsgType,
} from './protocol.js';
import {
  addConn,
  applyUpdate,
  broadcast,
  ensureFile,
  getPresenceCounts,
  getStateAsUpdate,
  removeConn,
  type PadConn,
} from './hub.js';
import { prisma } from '../db.js';
import { canEdit, canView, getPadAccess } from '../lib/permissions.js';
import * as recording from '../services/recordings.js';

function countConns(padId: string): number {
  return getPresenceCounts()[padId] ?? 0;
}

const PRESENCE_BY_CONN = new WeakMap<WebSocket, Record<string, unknown>>();
// padId → userId → latest awareness payload. Replayed to late joiners on HELLO
// so they see existing cursors immediately (Google-Docs style) rather than
// waiting for the next keystroke from each peer.
const PRESENCE_BY_PAD = new Map<string, Map<string, { fileId: string; payload: Buffer }>>();

const COLORS = [
  '#f97316',
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  '#facc15',
  '#60a5fa',
  '#f472b6',
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export interface HandleOptions {
  ws: WebSocket;
  slug: string;
  user: { sub: string; email: string; name: string };
}

export async function handleCollabConn({ ws, slug, user }: HandleOptions): Promise<void> {
  // Attach message handler immediately to avoid losing messages
  // that arrive while we resolve pad access asynchronously.
  const pending: Buffer[] = [];
  let access: Awaited<ReturnType<typeof getPadAccess>> = null;
  const conn: PadConn = {
    ws,
    userId: user.sub,
    userName: user.name,
    padId: '',
    color: colorFor(user.sub),
    alive: true,
  };

  const earlyListener = (raw: Buffer): void => {
    pending.push(raw);
  };
  ws.on('message', earlyListener);

  access = await getPadAccess(slug, user.sub);
  if (!access || !canView(access.role)) {
    ws.send(encodeJSON(MSG.ERROR, { error: 'not_found' }));
    ws.close(4004, 'not_found');
    return;
  }
  conn.padId = access.pad.id;
  addConn(conn);
  void recording.onParticipantJoin(conn.padId, conn.userId, conn.userName);
  ws.removeListener('message', earlyListener);

  ws.on('pong', () => {
    conn.alive = true;
  });
  const keepalive = setInterval(() => {
    if (!conn.alive) {
      ws.terminate();
      clearInterval(keepalive);
      return;
    }
    conn.alive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }, 30_000);

  const onMessage = async (raw: Buffer): Promise<void> => {
    const type = messageType(raw) as MsgType;
    try {
      if (type === MSG.HELLO) {
        const hello = decodeJSON<{ fileId?: string }>(raw);
        if (hello.fileId) {
          const file = await prisma.padFile.findUnique({ where: { id: hello.fileId } });
          if (!file || file.padId !== access.pad.id) {
            ws.send(encodeJSON(MSG.ERROR, { error: 'file_not_found' }));
            return;
          }
          const state = await ensureFile(access.pad.id, hello.fileId);
          ws.send(encodeBinaryWithFile(MSG.STATE, hello.fileId, getStateAsUpdate(state.doc)));
        }
        // Replay cached awareness for this pad so the joiner sees existing
        // cursors immediately. Skip the joiner's own entry.
        const cached = PRESENCE_BY_PAD.get(access.pad.id);
        if (cached) {
          for (const [otherId, entry] of cached) {
            if (otherId === user.sub) continue;
            ws.send(encodeBinaryWithFile(MSG.AWARENESS, entry.fileId, entry.payload));
          }
        }
        return;
      }
      if (type === MSG.UPDATE) {
        if (!canEdit(access.role)) return; // viewers can't edit
        const { fileId, payload } = decodeBinaryWithFile(raw);
        await ensureFile(access.pad.id, fileId);
        applyUpdate(access.pad.id, fileId, new Uint8Array(payload));
        // persist the raw incremental update for playback
        prisma.editEvent
          .create({
            data: {
              padId: access.pad.id,
              fileId,
              kind: 'yjs',
              userId: user.sub,
              payload: Buffer.from(payload),
            },
          })
          .catch(() => {});
        broadcast(access.pad.id, ws, encodeBinaryWithFile(MSG.UPDATE, fileId, payload));
        return;
      }
      if (type === MSG.AWARENESS) {
        const { fileId, payload } = decodeBinaryWithFile(raw);
        // Stamp the server-authoritative identity into the payload so peers
        // can't spoof another user's name/color via crafted awareness frames.
        let stamped: Buffer = payload;
        try {
          const parsed = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
          const authoritative = {
            ...parsed,
            userId: user.sub,
            name: user.name,
            color: conn.color,
            fileId,
          };
          PRESENCE_BY_CONN.set(ws, authoritative);
          stamped = Buffer.from(JSON.stringify(authoritative));
          let padMap = PRESENCE_BY_PAD.get(access.pad.id);
          if (!padMap) {
            padMap = new Map();
            PRESENCE_BY_PAD.set(access.pad.id, padMap);
          }
          padMap.set(user.sub, { fileId, payload: stamped });
        } catch {
          /* ignore — relay the raw payload so legacy clients still work */
        }
        broadcast(access.pad.id, ws, encodeBinaryWithFile(MSG.AWARENESS, fileId, stamped));
        return;
      }
      if (type === MSG.PING) {
        ws.send(encodeJSON(MSG.PONG, {}));
        return;
      }
      if (type === MSG.CHAT) {
        await handleChat({ ws, conn, raw });
        return;
      }
    } catch (err) {
      ws.send(encodeJSON(MSG.ERROR, { error: 'bad_message', message: String((err as Error).message) }));
    }
  };
  ws.on('message', (raw: Buffer) => {
    void onMessage(raw);
  });
  // Drain any messages that arrived during async setup.
  for (const raw of pending) void onMessage(raw);
  pending.length = 0;

  ws.on('close', () => {
    clearInterval(keepalive);
    removeConn(conn);
    const remaining = countConns(access.pad.id);
    void recording.onParticipantLeave(access.pad.id, remaining);
    // Drop the user's cached awareness so a fresh join shows them only after
    // they re-broadcast presence.
    const padMap = PRESENCE_BY_PAD.get(access.pad.id);
    if (padMap) {
      padMap.delete(user.sub);
      if (padMap.size === 0) PRESENCE_BY_PAD.delete(access.pad.id);
    }
    // Use binary frame so client decodeBinaryWithFile parses correctly. Empty
    // fileId is fine; payload carries the leave marker as JSON.
    const leavePayload = Buffer.from(
      JSON.stringify({ type: 'leave', userId: user.sub }),
    );
    broadcast(
      access.pad.id,
      null,
      encodeBinaryWithFile(MSG.AWARENESS, '', leavePayload),
    );
  });
}

async function handleChat({
  ws,
  conn,
  raw,
}: {
  ws: WebSocket;
  conn: PadConn;
  raw: Buffer;
}): Promise<void> {
  // Lazy require to avoid circular import.
  const { handleChatMessage } = await import('./chat.js');
  await handleChatMessage({ ws, conn, raw });
}
