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
        meta: input.meta ? JSON.stringify(input.meta) : null,
        ip: req?.ip ?? null,
        userAgent: (req?.headers['user-agent'] as string | undefined) ?? null,
      },
    })
    .catch((err) => {
       
      console.error('audit log write failed', { action: input.action, err: String(err) });
    });
}
