import type { FastifyInstance } from 'fastify';
import { handleCollabConn } from './collab.js';
import { handleTerminalConn } from './terminal.js';
import { readToken } from '../lib/auth.js';
import type { JwtPayload } from '../lib/auth.js';

export async function registerWebSocket(server: FastifyInstance): Promise<void> {
  server.register(async (s) => {
    s.get('/ws/pad/:slug', { websocket: true }, async (socket, req) => {
      const slug = (req.params as { slug: string }).slug;
      const tokenFromHeader = readToken(req);
      const tokenFromQuery =
        typeof req.query === 'object' && req.query && 'token' in req.query
          ? String((req.query as { token?: string }).token ?? '')
          : '';
      const token = tokenFromHeader || tokenFromQuery;
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
      const tokenFromHeader = readToken(req);
      const tokenFromQuery =
        typeof req.query === 'object' && req.query && 'token' in req.query
          ? String((req.query as { token?: string }).token ?? '')
          : '';
      const token = tokenFromHeader || tokenFromQuery;
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
