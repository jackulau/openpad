import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { canView, getPadAccess } from '../lib/permissions.js';

// One whiteboard per pad, stored as a synthetic PadFile so the existing Yjs
// hub + WS protocol handles persistence / replay / fan-out for free. The
// stroke data lives in a Y.Array("strokes") inside that file's Y.Doc.
const WHITEBOARD_NAME = '_whiteboard.draw';
const WHITEBOARD_LANGUAGE = 'whiteboard';

export async function registerWhiteboardRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/pads/:slug/whiteboard - return the whiteboard fileId, creating
  // it lazily on first access. Idempotent.
  server.get(
    '/:slug/whiteboard',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });

      const existing = await prisma.padFile.findFirst({
        where: { padId: access.pad.id, name: WHITEBOARD_NAME },
        select: { id: true },
      });
      if (existing) return { fileId: existing.id };

      const created = await prisma.padFile.create({
        data: {
          padId: access.pad.id,
          name: WHITEBOARD_NAME,
          language: WHITEBOARD_LANGUAGE,
          content: '',
          sortOrder: 9999, // park it at the end so it doesn't clutter the file list
        },
      });
      return { fileId: created.id };
    },
  );
}

export const WHITEBOARD_FILE_NAME = WHITEBOARD_NAME;
export const WHITEBOARD_FILE_LANGUAGE = WHITEBOARD_LANGUAGE;
