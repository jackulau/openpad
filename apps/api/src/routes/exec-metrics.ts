import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { getExecCounters } from '../exec/metrics.js';
import { getPool } from '../exec/pool.js';

// GET /api/admin/exec-metrics - returns process-wide exec counters + pool
// state. Access gate: caller must be the owner of at least one pad. This is a
// lightweight auth check, NOT a real admin system - the metrics are not
// sensitive (counts only, no payloads) but we don't expose them anonymously.

export async function registerExecMetricsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/exec-metrics', { preHandler: server.requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.sub;
    const ownsAny = await prisma.padMember.findFirst({
      where: { userId, role: 'owner' },
      select: { id: true },
    });
    if (!ownsAny) return reply.code(403).send({ error: 'forbidden' });

    return {
      counters: getExecCounters(),
      pool: getPool().stats(),
    };
  });
}
