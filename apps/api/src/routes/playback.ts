import type { FastifyInstance } from 'fastify';
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
      const timeline = await buildTimeline(access.pad.id);
      return timeline;
    },
  );
}
