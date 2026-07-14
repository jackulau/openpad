import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// Serves a problem-asset's bytes. Auth-required (cookie or bearer, via
// requireAuth) so assets aren't world-readable; ids are unguessable cuids. The
// frontend fetches these with the bearer token and renders them as blob URLs.
export async function registerAssetRoutes(server: FastifyInstance): Promise<void> {
  server.get('/:id', { preHandler: server.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('Content-Type', asset.mime)
      // nosniff + inline disposition: never let the browser reinterpret the type.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="${asset.filename.replace(/["\r\n]/g, '')}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .send(Buffer.from(asset.data));
  });
}
