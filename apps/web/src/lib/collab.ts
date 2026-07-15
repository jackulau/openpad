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
  NOTES: 9,
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
  // Server-stamped per-connection id. Lets one user open multiple tabs without
  // each tab's presence stomping the previous one. Optional for backwards
  // compat with old server builds.
  connId?: string;
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
  // World-coordinate position of this user's pointer over the whiteboard
  // canvas. Cleared when the pointer leaves the canvas. See WhiteboardCanvas
  // for the throttled broadcast.
  canvasCursor?: { x: number; y: number } | null;
}

// `presence` is keyed by `${userId}:${connId}` so multiple tabs from the same
// account each get their own entry. Use `presenceUserId(entry)` if you need
// "which user is this", or aggregate via Object.values when you want one
// avatar per human.
export function presenceMapKey(p: Pick<PresenceUser, 'userId' | 'connId'>): string {
  return `${p.userId}:${p.connId ?? 'legacy'}`;
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

const PING_INTERVAL_MS = 5000;
const RTT_EMA_ALPHA = 0.3;

export class CollabClient {
  private ws: WebSocket | null = null;
  private docs = new Map<string, Y.Doc>();
  private listeners = new Set<(s: CollabStatus) => void>();
  private chatListeners = new Set<(m: ChatMessage) => void>();
  private presenceListeners = new Set<(users: Record<string, PresenceUser>) => void>();
  private notesListeners = new Set<() => void>();
  private rttListeners = new Set<(ms: number) => void>();
  private presence: Record<string, PresenceUser> = {};
  private currentSelfPresence: Partial<PresenceUser> = {};
  private status: CollabStatus = 'connecting';
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pendingHello: string[] = [];
  // Local edits made while the socket was down, keyed by fileId. Replayed on
  // reconnect so a wifi blip mid-typing doesn't silently drop the user's work.
  private pendingUpdates = new Map<string, Uint8Array[]>();
  private pingTimer: number | null = null;
  private lastPingSentAt: number | null = null;
  private rttEma: number | null = null;

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

  // Fires when a peer changes the pad's Notes/problem (save, image upload, or
  // delete). Carries no payload — the subscriber refetches the notes query so
  // everyone in the pad sees the update live, like editor text and cursors.
  onNotes(cb: () => void): () => void {
    this.notesListeners.add(cb);
    return () => this.notesListeners.delete(cb);
  }

  onPresence(cb: (users: Record<string, PresenceUser>) => void): () => void {
    this.presenceListeners.add(cb);
    cb(this.presence);
    return () => this.presenceListeners.delete(cb);
  }

  onRtt(cb: (ms: number) => void): () => void {
    this.rttListeners.add(cb);
    if (this.rttEma != null) cb(this.rttEma);
    return () => this.rttListeners.delete(cb);
  }

  getRtt(): number | null {
    return this.rttEma;
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.lastPingSentAt = performance.now();
    this.ws.send(encodeJSON(MSG.PING, {}));
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.sendPing();
    this.pingTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.lastPingSentAt = null;
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
      // Re-broadcast our presence so peers see us after a reconnect (and so
      // the server's per-pad cache gets repopulated for any late joiners).
      if (this.currentSelfPresence.userId) {
        const fileId = this.currentSelfPresence.fileId ?? '';
        this.ws?.send(
          encodeBinaryWithFile(
            MSG.AWARENESS,
            fileId,
            new TextEncoder().encode(JSON.stringify(this.currentSelfPresence)),
          ),
        );
      }
      // Replay edits buffered while the socket was down. Sent after HELLO so the
      // server has (re)loaded the doc before our updates land on it.
      this.flushPendingUpdates();
      this.startPingLoop();
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
            if (p.connId) {
              delete this.presence[presenceMapKey(p)];
            } else {
              // legacy server: no connId — drop every entry for that user
              for (const key of Object.keys(this.presence)) {
                if (this.presence[key].userId === p.userId) delete this.presence[key];
              }
            }
          } else if (p.userId) {
            this.presence[presenceMapKey(p)] = p;
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
      } else if (type === MSG.NOTES) {
        this.notesListeners.forEach((l) => l());
      } else if (type === MSG.PONG) {
        if (this.lastPingSentAt != null) {
          const sample = performance.now() - this.lastPingSentAt;
          this.lastPingSentAt = null;
          this.rttEma =
            this.rttEma == null ? sample : RTT_EMA_ALPHA * sample + (1 - RTT_EMA_ALPHA) * this.rttEma;
          const value = this.rttEma;
          this.rttListeners.forEach((l) => l(value));
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
      this.stopPingLoop();
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      // onclose will follow
    };
  }

  private flushPendingUpdates(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const [fileId, updates] of this.pendingUpdates) {
      if (updates.length === 0) continue;
      const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
      this.ws.send(encodeBinaryWithFile(MSG.UPDATE, fileId, merged));
    }
    this.pendingUpdates.clear();
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
      } else {
        // Socket is down (reconnecting). Buffer the edit instead of dropping it.
        const list = this.pendingUpdates.get(fileId) ?? [];
        list.push(update);
        // Coalesce a long offline burst so memory + the eventual replay stay
        // bounded; Yjs updates merge losslessly.
        this.pendingUpdates.set(fileId, list.length > 256 ? [Y.mergeUpdates(list)] : list);
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
    this.stopPingLoop();
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
