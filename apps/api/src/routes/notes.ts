import type { FastifyInstance } from 'fastify';
import type { Pad } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, canView, getPadAccess } from '../lib/permissions.js';
import { broadcastNotesChanged } from '../ws/hub.js';

// Problem "Notes": a markdown description plus attached images that an
// interviewer (pad owner) surfaces in the pad's expandable Notes panel. The
// description is stored on the pad's linked Question; images are Assets hung off
// that question. Everything here is pad-scoped and permission-checked through
// getPadAccess so it stays inside the pad's tenancy boundary.

const saveBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(50_000),
});

// Rendered via <img>, so only raster formats a browser can't execute. SVG is
// excluded on purpose - it can carry inline script if ever opened directly.
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

function assetUrl(id: string): string {
  return `/api/assets/${id}`;
}

// Lazily create the pad's problem Question the first time an owner saves notes or
// uploads an asset, so the Notes panel works on any pad (not just interview pads
// pre-attached to a question). Returns the existing question when present.
async function ensureQuestion(pad: Pad, userId: string, title?: string) {
  if (pad.questionId) {
    const existing = await prisma.question.findUnique({ where: { id: pad.questionId } });
    if (existing) return existing;
  }
  const created = await prisma.question.create({
    data: {
      title: title?.trim() || pad.title,
      body: '',
      language: pad.language,
      createdBy: userId,
    },
  });
  await prisma.pad.update({ where: { id: pad.id }, data: { questionId: created.id } });
  return created;
}

async function serializeQuestion(questionId: string) {
  const q = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      assets: {
        select: { id: true, filename: true, mime: true, size: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!q) return null;
  return {
    id: q.id,
    title: q.title,
    body: q.body,
    language: q.language,
    difficulty: q.difficulty,
    assets: q.assets.map((a) => ({ ...a, url: assetUrl(a.id) })),
  };
}

export async function registerNotesRoutes(server: FastifyInstance): Promise<void> {
  // Read notes - any pad member. canEdit gates the edit affordances client-side.
  server.get('/:slug/notes', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
    const question = access.pad.questionId ? await serializeQuestion(access.pad.questionId) : null;
    return { canEdit: canManage(access.role), kind: access.pad.kind, question };
  });

  // Save the markdown description - owner only. Creates + attaches a question if
  // the pad has none yet.
  server.put('/:slug/notes', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = saveBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const question = await ensureQuestion(access.pad, userId, parsed.data.title);
    await prisma.question.update({
      where: { id: question.id },
      data: {
        body: parsed.data.body,
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
      },
    });
    broadcastNotesChanged(access.pad.id);
    return { question: await serializeQuestion(question.id) };
  });

  // Upload an image asset - owner only. multipart/form-data, field "file".
  server.post('/:slug/notes/assets', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });

    let file;
    try {
      file = await req.file();
    } catch {
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    if (!file) return reply.code(400).send({ error: 'no_file' });
    if (!IMAGE_MIME.has(file.mimetype)) {
      return reply.code(415).send({ error: 'unsupported_type' });
    }
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      // @fastify/multipart throws once the per-file byte cap is exceeded.
      return reply.code(413).send({ error: 'file_too_large' });
    }
    if (file.file.truncated || buf.length > MAX_ASSET_BYTES) {
      return reply.code(413).send({ error: 'file_too_large' });
    }

    const question = await ensureQuestion(access.pad, userId);
    const asset = await prisma.asset.create({
      data: {
        questionId: question.id,
        filename: (file.filename || 'image').slice(0, 200),
        mime: file.mimetype,
        size: buf.length,
        data: buf,
        createdBy: userId,
      },
      select: { id: true, filename: true, mime: true, size: true },
    });
    broadcastNotesChanged(access.pad.id);
    return reply.code(201).send({ asset: { ...asset, url: assetUrl(asset.id) } });
  });

  // Delete an asset - owner only. Scoped to this pad's question.
  server.delete(
    '/:slug/notes/assets/:assetId',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, assetId } = req.params as { slug: string; assetId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const asset = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset || !access.pad.questionId || asset.questionId !== access.pad.questionId) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await prisma.asset.delete({ where: { id: assetId } });
      broadcastNotesChanged(access.pad.id);
      return { ok: true };
    },
  );
}
