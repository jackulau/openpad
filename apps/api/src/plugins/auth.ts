import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { readToken, type JwtPayload } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: JwtPayload;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

async function plugin(server: FastifyInstance): Promise<void> {
  server.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = readToken(req);
    if (!token) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    try {
      const decoded = server.jwt.verify<JwtPayload>(token);
      req.currentUser = decoded;
    } catch {
      reply.code(401).send({ error: 'invalid_token' });
    }
  });

  server.decorate('optionalAuth', async (req: FastifyRequest) => {
    const token = readToken(req);
    if (!token) return;
    try {
      req.currentUser = server.jwt.verify<JwtPayload>(token);
    } catch {
      // ignore
    }
  });
}

export const authPlugin = fp(plugin, { name: 'auth-plugin' });
