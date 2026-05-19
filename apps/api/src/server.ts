import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPadRoutes } from './routes/pads.js';
import { registerExecRoutes } from './routes/exec.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFileRoutes } from './routes/files.js';
import {
  registerInviteAcceptRoutes,
  registerInviteRoutes,
} from './routes/invites.js';
import { registerPlaybackRoutes } from './routes/playback.js';
import { registerQuestionRoutes } from './routes/questions.js';
import { registerInterviewRoutes } from './routes/interviews.js';
import { registerAIReviewRoutes } from './routes/aiReview.js';
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
  await server.register(registerInviteRoutes, { prefix: '/api/pads' });
  await server.register(registerInviteAcceptRoutes, { prefix: '/api/invites' });
  await server.register(registerPlaybackRoutes, { prefix: '/api/pads' });
  await server.register(registerQuestionRoutes, { prefix: '/api/questions' });
  await server.register(registerInterviewRoutes, { prefix: '/api/pads' });
  await server.register(registerAIReviewRoutes, { prefix: '/api/pads' });
  await registerWebSocket(server);

  // Serve the SPA bundle alongside the API when it has been built.
  await maybeRegisterStaticWeb(server);

  return server;
}

async function maybeRegisterStaticWeb(server: FastifyInstance): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // try common locations: bundled docker layout + dev layout
  const candidates = [
    path.resolve(here, '..', '..', '..', 'web-dist'), // docker layout
    path.resolve(here, '..', '..', '..', 'web', 'dist'), // monorepo dev
    path.resolve(here, '..', '..', '..', '..', 'apps', 'web', 'dist'),
  ];
  const root = candidates.find((p) => existsSync(p));
  if (!root) return;
  await server.register(staticPlugin, {
    root,
    prefix: '/',
    decorateReply: false,
  });
  server.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}
