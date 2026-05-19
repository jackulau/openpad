import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handleCollabConn } from './collab.js';
import { handleTerminalConn } from './terminal.js';
import { readToken } from '../lib/auth.js';
import type { JwtPayload } from '../lib/auth.js';

// Extract a bearer token from a WebSocket upgrade request.
// Priority: Authorization header / cookie (covered by readToken), then the
// `Sec-WebSocket-Protocol: oc.bearer.<jwt>` carrier (the only way browsers can
// send auth on the upgrade itself without exposing the token in the URL).
function readWsToken(req: FastifyRequest): string | undefined {
  const fromHeader = readToken(req);
  if (fromHeader) return fromHeader;
  const proto = req.headers['sec-websocket-protocol'];
  if (!proto) return undefined;
  const list = String(proto)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of list) {
    if (p.startsWith('oc.bearer.')) return p.slice('oc.bearer.'.length);
  }
  return undefined;
}

export async function registerWebSocket(server: FastifyInstance): Promise<void> {
  server.register(async (s) => {
    s.get('/ws/pad/:slug', { websocket: true }, async (socket, req) => {
      const slug = (req.params as { slug: string }).slug;
      const token = readWsToken(req);
      if (!token) {
        socket.close(4001, 'unauthenticated');
        return;
      }
      let user: JwtPayload;
      try {
        user = server.jwt.verify<JwtPayload>(token);
      } catch {
        socket.close(4002, 'invalid_token');
        return;
      }
      await handleCollabConn({ ws: socket, slug, user });
    });

    s.get('/ws/terminal/:slug', { websocket: true }, async (socket, req) => {
      const slug = (req.params as { slug: string }).slug;
      const token = readWsToken(req);
      if (!token) {
        socket.close(4001, 'unauthenticated');
        return;
      }
      let user: JwtPayload;
      try {
        user = server.jwt.verify<JwtPayload>(token);
      } catch {
        socket.close(4002, 'invalid_token');
        return;
      }
      await handleTerminalConn({ ws: socket, slug, user });
    });
  });
}
