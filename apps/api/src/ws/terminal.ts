// Stub — implemented in D8. Closes the socket cleanly until then.
import type { WebSocket } from 'ws';
import { MSG, encodeJSON } from './protocol.js';
import type { JwtPayload } from '../lib/auth.js';

export async function handleTerminalConn({
  ws,
}: {
  ws: WebSocket;
  slug: string;
  user: JwtPayload;
}): Promise<void> {
  ws.send(encodeJSON(MSG.ERROR, { error: 'not_implemented', message: 'terminal coming in D8' }));
  ws.close(4099, 'not_implemented');
}
