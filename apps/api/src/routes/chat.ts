import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canView, getPadAccess } from '../lib/permissions.js';

const query = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function registerChatRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/:slug/messages',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
      const parsed = query.safeParse(req.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const where = {
        padId: access.pad.id,
        ...(parsed.data.before
          ? { createdAt: { lt: new Date(parsed.data.before) } }
          : {}),
      };
      const rows = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.limit,
        include: { user: { select: { id: true, name: true } } },
      });
      const messages = rows
        .map((r) => ({
          id: r.id,
          padId: r.padId,
          userId: r.userId,
          userName: r.user.name,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
        }))
        .reverse();
      return { messages };
    },
  );
}
