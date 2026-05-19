import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPadRoutes } from './routes/pads.js';
import { registerExecRoutes } from './routes/exec.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFileRoutes } from './routes/files.js';
import { registerWebSocket } from './ws/index.js';

export type AppServer = FastifyInstance;

export interface BuildServerOptions {
  /** Skip rate-limit + heavy plugins for tests. */
  test?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<AppServer> {
  const isTest = opts.test ?? env.NODE_ENV === 'test';
  const server = Fastify({
    logger: isTest
      ? false
      : {
          transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } },
          level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        },
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });

  await server.register(cookie);
  await server.register(cors, { origin: true, credentials: true });
  await server.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: 'oc_token', signed: false },
  });
  if (!isTest) {
    await server.register(rateLimit, {
      max: env.RATE_LIMIT_PER_MINUTE,
      timeWindow: '1 minute',
    });
  }
  await server.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });
  await server.register(authPlugin);

  server.get('/health', async () => ({ ok: true, name: 'opencoder', version: '0.1.0' }));
  server.get('/api/health', async () => ({ ok: true }));

  await server.register(registerAuthRoutes, { prefix: '/api/auth' });
  await server.register(registerPadRoutes, { prefix: '/api/pads' });
  await server.register(registerExecRoutes, { prefix: '/api/pads' });
  await server.register(registerFileRoutes, { prefix: '/api/pads' });
  await server.register(registerChatRoutes, { prefix: '/api/pads' });
  await registerWebSocket(server);

  return server;
}
