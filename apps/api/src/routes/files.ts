import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canEdit, canManage, getPadAccess } from '../lib/permissions.js';
import { langForFile, resolveLanguage, templateFor } from '@opencoder/shared';

const validLanguage = (v: string): boolean => resolveLanguage(v) !== undefined;

const createBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^/\\]+$/, 'no_slashes'),
  language: z.string().refine(validLanguage, 'unknown_language').optional(),
  content: z.string().max(256 * 1024).optional(),
});

const renameBody = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/, 'no_slashes').optional(),
  language: z.string().refine(validLanguage, 'unknown_language').optional(),
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

  // Relanguage a file: rename it to the new language's default filename and
  // swap its contents to the matching template *only if* the current content
  // matches a known template (i.e. the user hasn't actually typed real code).
  // Otherwise just rename + change the language column so the user's work is
  // preserved. Also moves Yjs state forward by clearing yjsState - the editor
  // will reseed from `content` on next mount.
  server.patch(
    '/:slug/files/:fileId/relanguage',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, fileId } = req.params as { slug: string; fileId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canEdit(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = z
        .object({ language: z.string().refine(validLanguage, 'unknown_language') })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const existing = await prisma.padFile.findUnique({ where: { id: fileId } });
      if (!existing || existing.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const newSpec = resolveLanguage(parsed.data.language)!;
      const ext = newSpec.fileExt ?? '.txt';
      const baseName =
        ext === '.java' ? 'Main.java' : ext === '.hs' ? 'Main.hs' : `main${ext}`;
      // Avoid colliding with another file in this pad.
      let name = baseName;
      for (let i = 2; i < 50; i++) {
        const conflict = await prisma.padFile.findFirst({
          where: { padId: access.pad.id, name, NOT: { id: fileId } },
        });
        if (!conflict) break;
        const dot = baseName.lastIndexOf('.');
        name = dot > 0 ? `${baseName.slice(0, dot)}-${i}${baseName.slice(dot)}` : `${baseName}-${i}`;
      }
      // Decide whether to overwrite content. We replace only when the existing
      // content equals one of the known templates for the *old* language - that
      // way someone who hasn't edited the file gets a fresh starter, and someone
      // mid-implementation keeps their work.
      const helloOld = templateFor(existing.language, 'hello');
      const leetOld = templateFor(existing.language, 'leetcode');
      const currentContent = existing.content ?? '';
      const isPristine =
        currentContent === '' || currentContent === helloOld || currentContent === leetOld;
      const newContent = isPristine
        ? templateFor(parsed.data.language, 'hello')
        : currentContent;
      const updated = await prisma.padFile.update({
        where: { id: fileId },
        data: {
          name,
          language: parsed.data.language,
          content: newContent,
          // Drop the Yjs binary state so the editor re-seeds from `content`.
          // Clients re-open their Y.Doc against the new file id (same id, fresh state).
          yjsState: null,
        },
      });
      return {
        file: shape(updated),
        contentReplaced: isPristine,
      };
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
