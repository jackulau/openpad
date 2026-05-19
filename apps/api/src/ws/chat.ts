import type { WebSocket } from 'ws';
import { MSG, decodeJSON, encodeJSON } from './protocol.js';
import { broadcast, type PadConn } from './hub.js';
import { prisma } from '../db.js';

interface ChatPayload {
  body: string;
}

const MAX_BODY = 4000;
const MIN_INTERVAL_MS = 250;
const last = new WeakMap<WebSocket, number>();

export async function handleChatMessage({
  ws,
  conn,
  raw,
}: {
  ws: WebSocket;
  conn: PadConn;
  raw: Buffer;
}): Promise<void> {
  const now = Date.now();
  const prev = last.get(ws) ?? 0;
  if (now - prev < MIN_INTERVAL_MS) return;
  last.set(ws, now);

  let payload: ChatPayload;
  try {
    payload = decodeJSON<ChatPayload>(raw);
  } catch {
    return;
  }
  const body = (payload.body ?? '').slice(0, MAX_BODY).trim();
  if (!body) return;
  const msg = await prisma.chatMessage.create({
    data: { padId: conn.padId, userId: conn.userId, body },
  });
  const out = encodeJSON(MSG.CHAT, {
    id: msg.id,
    padId: msg.padId,
    userId: msg.userId,
    userName: conn.userName,
    body: msg.body,
    createdAt: msg.createdAt.toISOString(),
  });
  broadcast(conn.padId, null, out);
}
