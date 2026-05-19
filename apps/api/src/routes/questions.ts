import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { resolveLanguage } from '@opencoder/shared';

const validLanguage = (v: string): boolean => resolveLanguage(v) !== undefined;

const upsertBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000),
  language: z.string().refine(validLanguage, 'unknown_language').default('python312'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  tags: z.string().max(500).default(''),
});

export async function registerQuestionRoutes(server: FastifyInstance): Promise<void> {
  server.get('/', { preHandler: server.requireAuth }, async (req) => {
    const userId = req.currentUser!.sub;
    const qs = await prisma.question.findMany({
      where: { createdBy: userId },
      orderBy: { updatedAt: 'desc' },
    });
    return { questions: qs };
  });

  server.post('/', { preHandler: server.requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.sub;
    const parsed = upsertBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const q = await prisma.question.create({
      data: { ...parsed.data, createdBy: userId },
    });
    return reply.code(201).send({ question: q });
  });

  server.get('/:id', { preHandler: server.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = await prisma.question.findUnique({ where: { id } });
    if (!q) return reply.code(404).send({ error: 'not_found' });
    return { question: q };
  });

  server.patch('/:id', { preHandler: server.requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.sub;
    const { id } = req.params as { id: string };
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.createdBy !== userId) return reply.code(403).send({ error: 'forbidden' });
    const parsed = upsertBody.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const q = await prisma.question.update({ where: { id }, data: parsed.data });
    return { question: q };
  });

  server.delete('/:id', { preHandler: server.requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.sub;
    const { id } = req.params as { id: string };
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.createdBy !== userId) return reply.code(403).send({ error: 'forbidden' });
    await prisma.question.delete({ where: { id } });
    return { ok: true };
  });
}
