import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canEdit, getPadAccess } from '../lib/permissions.js';
import { LANGUAGES } from '@opencoder/shared';
import { runCode } from '../exec/runner.js';
import { prisma } from '../db.js';

const body = z.object({
  language: z.string().refine((v) => v in LANGUAGES, 'unknown_language').optional(),
  source: z.string().max(256 * 1024),
  stdin: z.string().max(64 * 1024).optional(),
  filename: z.string().max(120).optional(),
  timeoutMs: z.number().int().min(250).max(15000).optional(),
});

export async function registerExecRoutes(server: FastifyInstance): Promise<void> {
  server.post('/:slug/run', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });

    const parsed = body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const language = parsed.data.language ?? access.pad.language;
    const result = await runCode({
      language,
      source: parsed.data.source,
      stdin: parsed.data.stdin,
      filename: parsed.data.filename,
      timeoutMs: parsed.data.timeoutMs,
    });

    // record run event for playback
    try {
      await prisma.editEvent.create({
        data: {
          padId: access.pad.id,
          kind: 'run',
          userId,
          payload: Buffer.from(
            JSON.stringify({
              language,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              durationMs: result.durationMs,
              stdoutLen: result.stdout.length,
              stderrLen: result.stderr.length,
            }),
          ),
        },
      });
    } catch {
      // best effort
    }

    return result;
  });
}
