import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canEdit, canManage, getPadAccess } from '../lib/permissions.js';
import { LANGUAGES, langForFile } from '@opencoder/shared';

const createBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^/\\]+$/, 'no_slashes'),
  language: z.string().refine((v) => v in LANGUAGES, 'unknown_language').optional(),
  content: z.string().max(256 * 1024).optional(),
});

const renameBody = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/, 'no_slashes').optional(),
  language: z.string().refine((v) => v in LANGUAGES, 'unknown_language').optional(),
  sortOrder: z.number().int().optional(),
});

export async function registerFileRoutes(server: FastifyInstance): Promise<void> {
  server.post(
    '/:slug/files',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const { name, content = '' } = parsed.data;
      const inferred = langForFile(name);
      const language = parsed.data.language ?? (inferred === 'plaintext' ? access.pad.language : inferred);
      const max = await prisma.padFile.findFirst({
        where: { padId: access.pad.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      try {
        const file = await prisma.padFile.create({
          data: {
            padId: access.pad.id,
            name,
            language,
            content,
            sortOrder: (max?.sortOrder ?? 0) + 1,
          },
        });
        return reply.code(201).send({ file: shape(file) });
      } catch (err) {
        if (String((err as Error).message).includes('Unique')) {
          return reply.code(409).send({ error: 'name_taken' });
        }
        throw err;
      }
    },
  );

  server.patch(
    '/:slug/files/:fileId',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, fileId } = req.params as { slug: string; fileId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = renameBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const existing = await prisma.padFile.findUnique({ where: { id: fileId } });
      if (!existing || existing.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const data: { name?: string; language?: string; sortOrder?: number } = {};
      if (parsed.data.name && parsed.data.name !== existing.name) {
        data.name = parsed.data.name;
        if (!parsed.data.language) {
          const inferred = langForFile(parsed.data.name);
          if (inferred !== 'plaintext') data.language = inferred;
        }
      }
      if (parsed.data.language) data.language = parsed.data.language;
      if (parsed.data.sortOrder != null) data.sortOrder = parsed.data.sortOrder;
      const updated = await prisma.padFile.update({ where: { id: fileId }, data });
      return { file: shape(updated) };
    },
  );

  server.delete(
    '/:slug/files/:fileId',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, fileId } = req.params as { slug: string; fileId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const existing = await prisma.padFile.findUnique({ where: { id: fileId } });
      if (!existing || existing.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const remaining = await prisma.padFile.count({ where: { padId: access.pad.id } });
      if (remaining <= 1 && !canManage(access.role)) {
        return reply.code(400).send({ error: 'cannot_delete_last_file' });
      }
      if (remaining <= 1) {
        return reply.code(400).send({ error: 'cannot_delete_last_file' });
      }
      await prisma.padFile.delete({ where: { id: fileId } });
      return { ok: true };
    },
  );
}

function shape(f: {
  id: string;
  name: string;
  language: string;
  content: string;
  sortOrder: number;
  updatedAt: Date;
  createdAt: Date;
}) {
  return {
    id: f.id,
    name: f.name,
    language: f.language,
    sortOrder: f.sortOrder,
    updatedAt: f.updatedAt.toISOString(),
    createdAt: f.createdAt.toISOString(),
  };
}
