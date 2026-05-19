// Minimal binary envelope for the multiplexed /ws endpoint.
//
// Frame layout:
//   byte 0       : message type (uint8)
//   bytes 1..N   : payload (variable)
//
// Types:
//   0 = hello (client → server: { padId, fileId?, channels[] })
//   1 = state (server → client: full Yjs state snapshot, prefixed with 4-byte fileId length + fileId)
//   2 = update (bi-directional: Yjs update, fileId-prefixed)
//   3 = awareness (bi-directional: presence JSON, fileId-prefixed)
//   4 = chat (bi-directional: JSON {body})
//   5 = terminal (bi-directional: terminal data — wrapped JSON in payload)
//   6 = error (server → client: JSON {error, message})
//   7 = ping (bi-directional: empty)
//   8 = pong (bi-directional: empty)

export const MSG = {
  HELLO: 0,
  STATE: 1,
  UPDATE: 2,
  AWARENESS: 3,
  CHAT: 4,
  TERMINAL: 5,
  ERROR: 6,
  PING: 7,
  PONG: 8,
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export function encodeJSON(type: MsgType, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload));
  const buf = Buffer.alloc(1 + body.length);
  buf[0] = type;
  body.copy(buf, 1);
  return buf;
}

export function encodeBinaryWithFile(
  type: MsgType,
  fileId: string,
  payload: Uint8Array,
): Buffer {
  const fid = Buffer.from(fileId, 'utf8');
  const buf = Buffer.alloc(1 + 2 + fid.length + payload.length);
  buf[0] = type;
  buf.writeUInt16BE(fid.length, 1);
  fid.copy(buf, 3);
  Buffer.from(payload).copy(buf, 3 + fid.length);
  return buf;
}

export function decodeBinaryWithFile(buf: Buffer): { fileId: string; payload: Buffer } {
  const fidLen = buf.readUInt16BE(1);
  const fileId = buf.slice(3, 3 + fidLen).toString('utf8');
  const payload = buf.slice(3 + fidLen);
  return { fileId, payload };
}

export function decodeJSON<T = unknown>(buf: Buffer): T {
  return JSON.parse(buf.slice(1).toString('utf8')) as T;
}

export function messageType(buf: Buffer): MsgType {
  return buf[0] as MsgType;
}
