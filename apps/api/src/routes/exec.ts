import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canEdit, getPadAccess } from '../lib/permissions.js';
import { resolveLanguage } from '@opencoder/shared';
import { runCode } from '../exec/runner.js';
import { incCounter, releaseRun, tryReserveRun } from '../exec/metrics.js';
import { prisma } from '../db.js';

const validLanguage = (v: string): boolean => resolveLanguage(v) !== undefined;

const body = z.object({
  language: z.string().refine(validLanguage, 'unknown_language').optional(),
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
    if (!tryReserveRun(access.pad.id)) {
      return reply.code(429).send({ error: 'too_many_runs' });
    }
    incCounter('totalRuns');
    const language = parsed.data.language ?? access.pad.language;
    let result;
    try {
      result = await runCode({
        language,
        source: parsed.data.source,
        stdin: parsed.data.stdin,
        filename: parsed.data.filename,
        timeoutMs: parsed.data.timeoutMs,
      });
      if (result.exitCode !== 0 || result.timedOut) incCounter('totalErrors');
      if (result.runner === 'docker-pool') incCounter('poolHits');
      else if (result.runner === 'docker') incCounter('poolMisses');
    } finally {
      releaseRun(access.pad.id);
    }

    // Record run event for playback. We persist truncated stdout/stderr so
    // recording playback can replay the actual output, not just the metadata.
    const STREAM_CAP = 64 * 1024; // 64 KB per stream
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
              stdout: result.stdout.slice(0, STREAM_CAP),
              stderr: result.stderr.slice(0, STREAM_CAP),
              stdoutTruncated: result.stdout.length > STREAM_CAP,
              stderrTruncated: result.stderr.length > STREAM_CAP,
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
