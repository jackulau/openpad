import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function registerSetupRoutes(server: FastifyInstance): Promise<void> {
  server.get('/status', async () => {
    const count = await prisma.user.count();
    return {
      needsSetup: count === 0,
      userCount: count,
    };
  });
}
