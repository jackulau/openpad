import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

export type AuditAction =
  | 'pad.delete'
  | 'pad.password.set'
  | 'pad.password.clear'
  | 'pad.fork'
  | 'member.kick'
  | 'member.invite'
  | 'user.password.change'
  | 'user.name.change'
  | 'user.delete'
  | 'login.fail'
  | 'recording.start'
  | 'recording.stop'
  | 'recording.delete';

interface AuditInput {
  action: AuditAction;
  userId?: string | null;
  target?: string | null;
  meta?: Record<string, unknown>;
  req?: FastifyRequest;
}

// Keys whose VALUES we wipe before persisting. The audit log goes to a
// long-lived SQLite row that operators may grep for debugging; a stray
// password or token in here is a credential leak.
const SECRET_KEY_RE = /password|token|secret|jwt|api[_-]?key|authorization|cookie/i;
const META_MAX = 4096;

export function redactMeta(meta: unknown): unknown {
  if (Array.isArray(meta)) return meta.map(redactMeta);
  if (meta && typeof meta === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && v !== null && v !== undefined && v !== '') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactMeta(v);
      }
    }
    return out;
  }
  return meta;
}

export function serializeMeta(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const safe = redactMeta(meta);
  const json = JSON.stringify(safe);
  if (json.length <= META_MAX) return json;
  return json.slice(0, META_MAX - 14) + '…[truncated]';
}

// Best-effort: never block the request on logging failures. SQLite write errors
// or constraint violations get swallowed and printed to stderr.
export function recordAudit(input: AuditInput): void {
  const { req } = input;
  prisma.auditLog
    .create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        target: input.target ?? null,
        meta: serializeMeta(input.meta),
        ip: req?.ip ?? null,
        userAgent: (req?.headers['user-agent'] as string | undefined) ?? null,
      },
    })
    .catch((err) => {

      console.error('audit log write failed', { action: input.action, err: String(err) });
    });
}
