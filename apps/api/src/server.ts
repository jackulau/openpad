import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPadRoutes } from './routes/pads.js';
import { registerExecRoutes } from './routes/exec.js';
import { registerExecStreamRoutes } from './routes/exec-stream.js';
import { registerExecMetricsRoutes } from './routes/exec-metrics.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFileRoutes } from './routes/files.js';
import {
  registerInviteAcceptRoutes,
  registerInviteRoutes,
} from './routes/invites.js';
import { registerPlaybackRoutes } from './routes/playback.js';
import { registerPresenceRoutes } from './routes/presence.js';
import { registerRecordingsRoutes } from './routes/recordings.js';
import { registerWhiteboardRoutes } from './routes/whiteboard.js';
import { registerQuestionRoutes } from './routes/questions.js';
import { registerInterviewRoutes } from './routes/interviews.js';
import { registerNotesRoutes } from './routes/notes.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerSetupRoutes } from './routes/setup.js';
import { reconcileOnBoot } from './services/recordings.js';
import { registerWebSocket } from './ws/index.js';

export type AppServer = FastifyInstance;

// SHA-256 of the inline theme-bootstrap script in apps/web/index.html. That
// script runs synchronously before React mounts to apply the saved light/dark
// theme and avoid a flash-of-wrong-theme; under our no-unsafe-inline CSP it must
// be allow-listed by content hash. Regenerate if the inline script ever changes:
//   node -e 'const c=require("crypto"),f=require("fs");const h=f.readFileSync("apps/web/dist/index.html","utf8").match(/<script>([\s\S]*?)<\/script>/)[1];console.log("sha256-"+c.createHash("sha256").update(h).digest("base64"))'
const INDEX_INLINE_SCRIPT_HASH =
  "'sha256-HHFjouLOqRxV7dk23cVQNfPy4c5zE6qAywjao03pTI4='";

// CSP is tuned so Monaco (bundled + WebWorkers via blob:) and xterm (WASM + blob
// workers) still load. Scripts are self-hosted — no CDN — so script-src stays
// 'self' + blob: (worker bootstrap) plus the single hashed theme script above.
// HSTS is preload-friendly but only emitted when behind HTTPS - the dev server is
// HTTP and operators terminating TLS at a reverse proxy can flip it on with
// ENABLE_HSTS=1.
function buildHelmetOptions(): Parameters<typeof helmet>[1] {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'blob:', INDEX_INLINE_SCRIPT_HASH],
        scriptSrcAttr: ["'none'"],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: process.env.ENABLE_HSTS === '1'
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
    frameguard: { action: 'deny' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xssFilter: true,
    noSniff: true,
    hidePoweredBy: true,
  };
}

// CORS allow-list. Defaults are permissive for dev; production / LAN deployments
// should set ALLOWED_ORIGINS to a comma-separated list of allowed origins.
function buildCorsOptions(): Parameters<typeof cors>[1] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) {
    // Reflect the request origin so local dev + LAN both work without config.
    // Operators who want a strict allow-list must set ALLOWED_ORIGINS.
    return { origin: true, credentials: true };
  }
  const allowList = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    origin: (origin, cb) => {
      // Same-origin / non-browser requests (no Origin header) are allowed.
      if (!origin) return cb(null, true);
      if (allowList.includes(origin)) return cb(null, true);
      return cb(new Error('origin_not_allowed'), false);
    },
    credentials: true,
  };
}

export interface BuildServerOptions {
  /** Skip rate-limit + heavy plugins for tests. */
  test?: boolean;
  /**
   * When true, enables per-route rate limits even in test mode.
   * Used by rate-limit tests; normal tests leave it false to avoid interference.
   */
  enableRateLimitInTests?: boolean;
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
  await server.register(helmet, buildHelmetOptions());
  await server.register(cors, buildCorsOptions());
  await server.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: 'oc_token', signed: false },
  });
  // Always register rate-limit so per-route overrides on auth endpoints take effect.
  // In tests we bypass via allowList so unrelated tests don't trip into 429s. e2e
  // runs in development mode (NODE_ENV=development) but still needs the bypass —
  // a single IP does many guest signups per run — so RATE_LIMIT_DISABLED opts in
  // without flipping NODE_ENV (which would also silence the logger + skip plugins).
  // Never honored in production: a stray env must not strip a live deployment's limits.
  const rateLimitDisabled =
    (isTest && opts.enableRateLimitInTests !== true) ||
    (env.RATE_LIMIT_DISABLED && env.NODE_ENV !== 'production');
  await server.register(rateLimit, {
    global: !rateLimitDisabled,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: rateLimitDisabled ? () => true : undefined,
  });
  // Problem-asset (image) uploads for interview Notes. 5MB/file cap sits under
  // the 8MB global body limit; one file per request.
  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 8 },
  });
  await server.register(websocket, {
    options: {
      maxPayload: 4 * 1024 * 1024,
      // Browser WebSocket can't send custom headers; we pass the bearer token
      // through Sec-WebSocket-Protocol as "oc.bearer.<jwt>". Accept it here so
      // the handshake completes; the route handler verifies the JWT.
      handleProtocols: (protocols: Set<string>) => {
        for (const p of protocols) {
          if (p.startsWith('oc.bearer.')) return p;
        }
        return false;
      },
    },
  });
  await server.register(authPlugin);

  server.get('/health', async () => ({ ok: true, name: 'opencoder', version: '0.1.0' }));
  server.get('/api/health', async () => ({ ok: true }));

  await server.register(registerAuthRoutes, { prefix: '/api/auth' });
  await server.register(registerPadRoutes, { prefix: '/api/pads' });
  await server.register(registerExecRoutes, { prefix: '/api/pads' });
  await server.register(registerExecStreamRoutes, { prefix: '/api/pads' });
  await server.register(registerExecMetricsRoutes, { prefix: '/api/admin' });
  await server.register(registerFileRoutes, { prefix: '/api/pads' });
  await server.register(registerChatRoutes, { prefix: '/api/pads' });
  await server.register(registerInviteRoutes, { prefix: '/api/pads' });
  await server.register(registerInviteAcceptRoutes, { prefix: '/api/invites' });
  await server.register(registerPlaybackRoutes, { prefix: '/api/pads' });
  await server.register(registerPresenceRoutes, { prefix: '/api/pads' });
  await server.register(registerRecordingsRoutes, { prefix: '/api/pads' });
  await server.register(registerWhiteboardRoutes, { prefix: '/api/pads' });
  await server.register(registerQuestionRoutes, { prefix: '/api/questions' });
  await server.register(registerInterviewRoutes, { prefix: '/api/pads' });
  await server.register(registerNotesRoutes, { prefix: '/api/pads' });
  await server.register(registerAssetRoutes, { prefix: '/api/assets' });
  await server.register(registerSetupRoutes, { prefix: '/api/setup' });
  await registerWebSocket(server);

  // Serve the SPA bundle alongside the API when it has been built.
  await maybeRegisterStaticWeb(server);

  // Close any Recording row left orphaned by a previous crash. Skipped under
  // test mode so per-test fixtures aren't disturbed; the production index.ts
  // entrypoint flows through here with isTest=false.
  if (!isTest) {
    await reconcileOnBoot().catch((err: unknown) => {
      server.log.warn({ err }, 'reconcileOnBoot failed at startup');
    });
  }

  return server;
}

async function maybeRegisterStaticWeb(server: FastifyInstance): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // try common locations for the built SPA:
  //   - docker image layout (web-dist next to api dist)
  //   - dev via tsx (apps/api/src → ../../web/dist)
  //   - dev via compiled output (apps/api/dist/src → ../../../web/dist)
  //   - monorepo from root (.../apps/web/dist)
  const candidates = [
    path.resolve(here, '..', '..', '..', 'web-dist'),
    path.resolve(here, '..', '..', 'web', 'dist'),
    path.resolve(here, '..', '..', '..', 'web', 'dist'),
    path.resolve(here, '..', '..', '..', '..', 'apps', 'web', 'dist'),
    path.resolve(here, '..', '..', '..', 'apps', 'web', 'dist'),
  ];
  const root = candidates.find((p) => existsSync(p));
  if (!root) return;
  await server.register(staticPlugin, {
    root,
    prefix: '/',
    // decorateReply must be true so the SPA-fallback handler below can call
    // reply.sendFile('index.html') without crashing.
    decorateReply: true,
  });
  server.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}
