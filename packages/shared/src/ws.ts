export type WsChannel = 'collab' | 'chat' | 'terminal' | 'presence' | 'run';

export interface WsEnvelope<T = unknown> {
  channel: WsChannel;
  type: string;
  padId?: string;
  fileId?: string;
  data?: T;
  id?: string;
}

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  cursor?: { line: number; column: number };
  fileId?: string;
}
