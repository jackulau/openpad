import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { canEdit, getPadAccess } from '../lib/permissions.js';
import { runAIReview } from '../services/aiReview.js';

export async function registerAIReviewRoutes(server: FastifyInstance): Promise<void> {
  server.post(
    '/:slug/ai-review',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const files = await prisma.padFile.findMany({
        where: { padId: access.pad.id },
        orderBy: { sortOrder: 'asc' },
      });
      const question = access.pad.questionId
        ? await prisma.question.findUnique({
            where: { id: access.pad.questionId },
            select: { title: true, body: true },
          })
        : null;
      const result = await runAIReview({
        language: access.pad.language,
        files: files.map((f) => ({ name: f.name, language: f.language, content: f.content })),
        question: question ? { title: question.title, body: question.body } : null,
      });
      return result;
    },
  );
}
