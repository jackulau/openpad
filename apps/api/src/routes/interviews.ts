import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, canView, getPadAccess } from '../lib/permissions.js';

const rubricBody = z.object({
  correctness: z.number().int().min(0).max(5).optional(),
  style: z.number().int().min(0).max(5).optional(),
  communication: z.number().int().min(0).max(5).optional(),
  problemSolving: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(20_000).optional(),
  decision: z.enum(['hire', 'no_hire', 'maybe', 'pending']).optional(),
});

const attachBody = z.object({
  questionId: z.string().min(1).nullable(),
});

export async function registerInterviewRoutes(server: FastifyInstance): Promise<void> {
  // GET interview details — interviewer sees full; candidate only sees question
  server.get(
    '/:slug/interview',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
      if (access.pad.kind !== 'interview') {
        return reply.code(400).send({ error: 'not_interview_pad' });
      }
      const question = access.pad.questionId
        ? await prisma.question.findUnique({ where: { id: access.pad.questionId } })
        : null;
      if (canManage(access.role)) {
        const score = await prisma.interviewScore.findUnique({
          where: { padId: access.pad.id },
        });
        return {
          role: 'interviewer',
          question,
          score: score
            ? {
                correctness: score.correctness,
                style: score.style,
                communication: score.communication,
                problemSolving: score.problemSolving,
                notes: score.notes,
                decision: score.decision,
                updatedAt: score.updatedAt.toISOString(),
              }
            : null,
        };
      }
      // candidate / collaborator / viewer
      return {
        role: 'candidate',
        question: question
          ? {
              id: question.id,
              title: question.title,
              body: question.body,
              language: question.language,
              difficulty: question.difficulty,
            }
          : null,
      };
    },
  );

  // PATCH score — interviewer (owner) only
  server.patch(
    '/:slug/interview/score',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      if (access.pad.kind !== 'interview') {
        return reply.code(400).send({ error: 'not_interview_pad' });
      }
      const parsed = rubricBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const score = await prisma.interviewScore.upsert({
        where: { padId: access.pad.id },
        update: parsed.data,
        create: {
          padId: access.pad.id,
          interviewerId: userId,
          correctness: parsed.data.correctness ?? 0,
          style: parsed.data.style ?? 0,
          communication: parsed.data.communication ?? 0,
          problemSolving: parsed.data.problemSolving ?? 0,
          notes: parsed.data.notes ?? '',
          decision: parsed.data.decision ?? 'pending',
        },
      });
      return {
        score: {
          correctness: score.correctness,
          style: score.style,
          communication: score.communication,
          problemSolving: score.problemSolving,
          notes: score.notes,
          decision: score.decision,
          updatedAt: score.updatedAt.toISOString(),
        },
      };
    },
  );

  // Attach a question — interviewer (owner) only
  server.post(
    '/:slug/interview/attach',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      if (access.pad.kind !== 'interview') {
        return reply.code(400).send({ error: 'not_interview_pad' });
      }
      const parsed = attachBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const questionId = parsed.data.questionId;
      if (questionId) {
        const q = await prisma.question.findUnique({ where: { id: questionId } });
        if (!q) return reply.code(404).send({ error: 'question_not_found' });
      }
      await prisma.pad.update({
        where: { id: access.pad.id },
        data: { questionId },
      });
      return { ok: true };
    },
  );
}
