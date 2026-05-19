import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { canView, getPadAccess } from '../lib/permissions.js';
import { buildTimeline } from '../services/playback.js';

export async function registerPlaybackRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/:slug/playback',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // Optional ?recording=<id> trims the timeline to one recording's window.
      const recordingId =
        typeof req.query === 'object' && req.query && 'recording' in req.query
          ? String((req.query as { recording?: string }).recording ?? '')
          : '';
      let from: Date | undefined;
      let to: Date | undefined;
      if (recordingId) {
        const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
        if (!rec || rec.padId !== access.pad.id) {
          return reply.code(404).send({ error: 'recording_not_found' });
        }
        from = rec.startedAt;
        to = rec.endedAt ?? undefined;
      }
      const timeline = await buildTimeline(access.pad.id, { from, to });
      return { ...timeline, recordingId: recordingId || null };
    },
  );
}
