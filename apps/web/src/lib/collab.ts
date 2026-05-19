import * as Y from 'yjs';

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

type MsgType = (typeof MSG)[keyof typeof MSG];

function encodeJSON(type: MsgType, payload: unknown): ArrayBuffer {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const buf = new Uint8Array(1 + body.length);
  buf[0] = type;
  buf.set(body, 1);
  return buf.buffer;
}

function encodeBinaryWithFile(type: MsgType, fileId: string, payload: Uint8Array): ArrayBuffer {
  const fid = new TextEncoder().encode(fileId);
  const buf = new Uint8Array(1 + 2 + fid.length + payload.length);
  buf[0] = type;
  const view = new DataView(buf.buffer);
  view.setUint16(1, fid.length, false);
  buf.set(fid, 3);
  buf.set(payload, 3 + fid.length);
  return buf.buffer;
}

function decodeBinaryWithFile(buf: Uint8Array): { fileId: string; payload: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fidLen = view.getUint16(1, false);
  const fileId = new TextDecoder().decode(buf.subarray(3, 3 + fidLen));
  const payload = buf.subarray(3 + fidLen);
  return { fileId, payload };
}

function decodeJSON<T>(buf: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(buf.subarray(1))) as T;
}

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  fileId?: string;
  cursor?: { line: number; column: number };
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface ChatMessage {
  id: string;
  padId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export type CollabStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export class CollabClient {
  private ws: WebSocket | null = null;
  private docs = new Map<string, Y.Doc>();
  private listeners = new Set<(s: CollabStatus) => void>();
  private chatListeners = new Set<(m: ChatMessage) => void>();
  private presenceListeners = new Set<(users: Record<string, PresenceUser>) => void>();
  private presence: Record<string, PresenceUser> = {};
  private currentSelfPresence: Partial<PresenceUser> = {};
  private status: CollabStatus = 'connecting';
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pendingHello: string[] = [];

  constructor(
    private slug: string,
    private token: string,
  ) {
    this.connect();
  }

  private url(): string {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/pad/${this.slug}`;
  }

  // Browsers can't send Authorization on a WS upgrade, so the bearer token
  // rides in the Sec-WebSocket-Protocol header. Keeps it out of URLs and logs.
  private subprotocols(): string[] {
    return [`oc.bearer.${this.token}`];
  }

  private setStatus(s: CollabStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  onStatus(cb: (s: CollabStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  onChat(cb: (m: ChatMessage) => void): () => void {
    this.chatListeners.add(cb);
    return () => this.chatListeners.delete(cb);
  }

  onPresence(cb: (users: Record<string, PresenceUser>) => void): () => void {
    this.presenceListeners.add(cb);
    cb(this.presence);
    return () => this.presenceListeners.delete(cb);
  }

  private connect(): void {
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    this.ws = new WebSocket(this.url(), this.subprotocols());
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      // re-bind all docs by re-sending HELLO
      for (const fileId of this.docs.keys()) {
        this.ws?.send(encodeJSON(MSG.HELLO, { fileId }));
      }
      for (const fileId of this.pendingHello) {
        this.ws?.send(encodeJSON(MSG.HELLO, { fileId }));
      }
      this.pendingHello = [];
    };

    this.ws.onmessage = (e: MessageEvent) => {
      const raw = new Uint8Array(e.data as ArrayBuffer);
      const type = raw[0] as MsgType;
      if (type === MSG.STATE) {
        const { fileId, payload } = decodeBinaryWithFile(raw);
        const doc = this.getDoc(fileId);
        Y.applyUpdate(doc, payload, 'remote');
      } else if (type === MSG.UPDATE) {
        const { fileId, payload } = decodeBinaryWithFile(raw);
        const doc = this.getDoc(fileId);
        Y.applyUpdate(doc, payload, 'remote');
      } else if (type === MSG.AWARENESS) {
        const { payload } = decodeBinaryWithFile(raw);
        try {
          const p = JSON.parse(new TextDecoder().decode(payload)) as PresenceUser & {
            type?: string;
          };
          if ((p as { type?: string }).type === 'leave' && p.userId) {
            delete this.presence[p.userId];
          } else if (p.userId) {
            this.presence[p.userId] = p;
          }
          this.presenceListeners.forEach((l) => l({ ...this.presence }));
        } catch {
          /* ignore */
        }
      } else if (type === MSG.CHAT) {
        try {
          const msg = decodeJSON<ChatMessage>(raw);
          this.chatListeners.forEach((l) => l(msg));
        } catch {
          /* ignore */
        }
      } else if (type === MSG.ERROR) {
        try {
          console.warn('[collab] error', decodeJSON<unknown>(raw));
        } catch {
          /* ignore */
        }
      }
    };

    this.ws.onclose = () => {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      // onclose will follow
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 8000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  getDoc(fileId: string): Y.Doc {
    let doc = this.docs.get(fileId);
    if (doc) return doc;
    doc = new Y.Doc();
    this.docs.set(fileId, doc);
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(encodeBinaryWithFile(MSG.UPDATE, fileId, update));
      }
    });
    // request initial state from server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeJSON(MSG.HELLO, { fileId }));
    } else {
      this.pendingHello.push(fileId);
    }
    return doc;
  }

  sendChat(body: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeJSON(MSG.CHAT, { body }));
    }
  }

  setSelfPresence(partial: Partial<PresenceUser> & { fileId?: string }): void {
    this.currentSelfPresence = { ...this.currentSelfPresence, ...partial };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const fileId = partial.fileId ?? this.currentSelfPresence.fileId ?? '';
      this.ws.send(
        encodeBinaryWithFile(
          MSG.AWARENESS,
          fileId,
          new TextEncoder().encode(JSON.stringify(this.currentSelfPresence)),
        ),
      );
    }
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }
}
