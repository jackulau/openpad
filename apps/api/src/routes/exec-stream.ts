import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import { z } from 'zod';
import { resolveLanguage } from '@opencoder/shared';
import { canEdit, getPadAccess } from '../lib/permissions.js';
import { readToken, type JwtPayload } from '../lib/auth.js';
import { makeSandbox } from '../exec/sandbox.js';
import { isDockerAvailable, buildDockerArgs } from '../exec/docker.js';
import { env } from '../env.js';

// Streaming exec over WebSocket. Same payload shape as POST /:slug/run but the
// client receives stdout/stderr chunks as they arrive instead of waiting for
// the process to finish.
//
// Wire protocol:
//   client → server (once): {language?, source, stdin?, filename?, timeoutMs?}
//   server → client (many): {kind:'start', runId}
//                            {kind:'stdout', chunk:string}
//                            {kind:'stderr', chunk:string}
//                            {kind:'end', exitCode, durationMs, timedOut}
//                            {kind:'error', error:string}
// Then the server closes the socket.

function readWsToken(req: FastifyRequest): string | undefined {
  const fromHeader = readToken(req);
  if (fromHeader) return fromHeader;
  const proto = req.headers['sec-websocket-protocol'];
  if (!proto) return undefined;
  const list = String(proto).split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of list) if (p.startsWith('oc.bearer.')) return p.slice('oc.bearer.'.length);
  return undefined;
}

const payloadSchema = z.object({
  language: z.string().optional(),
  source: z.string().max(256 * 1024),
  stdin: z.string().max(64 * 1024).optional(),
  filename: z.string().max(120).optional(),
  timeoutMs: z.number().int().min(250).max(15000).optional(),
});

export async function registerExecStreamRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/:slug/run-stream',
    { websocket: true },
    async (socket: WebSocket, req: FastifyRequest) => {
      const slug = (req.params as { slug: string }).slug;

      // Buffer the first message that may arrive before async auth completes.
      const pending: RawData[] = [];
      const earlyListener = (raw: RawData): void => {
        pending.push(raw);
      };
      socket.on('message', earlyListener);

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
      const access = await getPadAccess(slug, user.sub);
      if (!access) {
        socket.close(4004, 'not_found');
        return;
      }
      if (!canEdit(access.role)) {
        socket.close(4003, 'forbidden');
        return;
      }

      let child: ChildProcess | null = null;
      let reap: (() => void) | null = null;
      socket.on('close', () => {
        if (child) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        // Killing the `docker run` client leaves the container running; reap it
        // by name so a client that disconnects mid-run doesn't leak a container.
        reap?.();
      });

      const process = (raw: RawData): void => {
        socket.off('message', earlyListener);
        void handlePayload({
          socket,
          raw,
          defaultLang: access.pad.language,
          onChild: (c, reapFn) => {
            child = c;
            reap = reapFn ?? null;
          },
        });
      };

      if (pending.length > 0) {
        process(pending[0]!);
      } else {
        socket.once('message', process);
      }
    },
  );
}

interface HandlePayloadArgs {
  socket: WebSocket;
  raw: RawData;
  defaultLang: string;
  onChild: (c: ChildProcess, reap?: () => void) => void;
}

async function handlePayload({
  socket,
  raw,
  defaultLang,
  onChild,
}: HandlePayloadArgs): Promise<void> {
  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(JSON.parse(raw.toString()));
  } catch {
    safeSend(socket, { kind: 'error', error: 'invalid_payload' });
    safeClose(socket, 1003, 'invalid_payload');
    return;
  }
  const language = parsed.language ?? defaultLang;
  const lang = resolveLanguage(language);
  if (!lang) {
    safeSend(socket, { kind: 'error', error: 'unknown_language' });
    safeClose(socket, 1003, 'unknown_language');
    return;
  }
  const filename = parsed.filename ?? `main${lang.fileExt}`;
  const timeoutMs = Math.min(
    Math.max(parsed.timeoutMs ?? env.EXEC_DEFAULT_TIMEOUT_MS, 250),
    env.EXEC_MAX_TIMEOUT_MS,
  );
  const sandbox = await makeSandbox(filename, parsed.source);
  const started = Date.now();
  const runId = randomUUID();
  safeSend(socket, { kind: 'start', runId });

  try {
    const docker = await isDockerAvailable();
    let child: ChildProcess;
    let reap: (() => void) | undefined;
    if (docker && lang.docker) {
      // Name the container so a timeout / disconnect can reap it (SIGKILL of the
      // docker CLI leaves the container running).
      const containerName = `oc-exec-${randomUUID()}`;
      reap = () => {
        try {
          spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' }).on('error', () => {});
        } catch {
          /* ignore */
        }
      };
      child = spawn('docker', buildDockerArgs(lang, sandbox.dir, filename, { name: containerName }), {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else if (lang.local) {
      const [cmd, ...rest] = lang.local.runCmd(filename);
      child = spawn(cmd!, rest, {
        cwd: sandbox.dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/tmp' },
      });
    } else {
      safeSend(socket, {
        kind: 'end',
        exitCode: 127,
        durationMs: 0,
        timedOut: false,
        error: 'no_runner',
      });
      safeClose(socket);
      return;
    }
    onChild(child, reap);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reap?.();
    }, timeoutMs);

    // Decoders hold back partial multibyte codepoints that straddle two chunks,
    // so streamed text is never corrupted mid-character.
    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    child.stdout?.on('data', (chunk: Buffer) => {
      const s = outDec.write(chunk);
      if (s) safeSend(socket, { kind: 'stdout', chunk: s });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const s = errDec.write(chunk);
      if (s) safeSend(socket, { kind: 'stderr', chunk: s });
    });
    // Unhandled stdin EPIPE would crash the whole API process.
    child.stdin?.on('error', () => {});
    try {
      if (parsed.stdin !== undefined) child.stdin?.write(parsed.stdin);
      child.stdin?.end();
    } catch {
      /* stdin already destroyed */
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(127);
      });
    });

    // Flush any bytes the decoders were holding for a straddling codepoint.
    const outTail = outDec.end();
    if (outTail) safeSend(socket, { kind: 'stdout', chunk: outTail });
    const errTail = errDec.end();
    if (errTail) safeSend(socket, { kind: 'stderr', chunk: errTail });

    safeSend(socket, {
      kind: 'end',
      exitCode,
      durationMs: Date.now() - started,
      timedOut,
    });
    safeClose(socket);
  } finally {
    await sandbox.cleanup();
  }
}

function safeSend(socket: WebSocket, msg: object): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* socket may have closed mid-flight */
  }
}

function safeClose(socket: WebSocket, code = 1000, reason = ''): void {
  try {
    socket.close(code, reason);
  } catch {
    /* already closed */
  }
}
