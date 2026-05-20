import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { getPresenceCounts, subscribePresence } from '../ws/hub.js';

// SSE stream of { padId: count } updates. Used by the Dashboard to badge
// pads with their live participant count. The handler keeps the connection
// open until the client disconnects; updates are pushed on every hub change
// plus a heartbeat every 25s to keep proxies from idling out.
//
// We filter to only pads the requesting user can see (owns or is a member of).
// That keeps the stream cheap on busy servers and avoids leaking pad ids
// across users.
export async function registerPresenceRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/presence',
    { preHandler: server.requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.currentUser!.sub;
      const visiblePadIds = await loadVisiblePadIds(userId);

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const snapshot = () => {
        const all = getPresenceCounts();
        const filtered: Record<string, number> = {};
        for (const padId of visiblePadIds) {
          if (all[padId]) filtered[padId] = all[padId];
        }
        return filtered;
      };

      send('snapshot', snapshot());

      let dirty = false;
      let scheduled: NodeJS.Timeout | null = null;
      const unsubscribe = subscribePresence((padId) => {
        if (!visiblePadIds.has(padId)) return;
        dirty = true;
        if (scheduled) return;
        // Coalesce bursts (e.g. server restart with 50 reconnects) into a
        // single message per 250ms.
        scheduled = setTimeout(() => {
          scheduled = null;
          if (!dirty) return;
          dirty = false;
          send('snapshot', snapshot());
        }, 250);
        scheduled.unref?.();
      });

      const heartbeat = setInterval(() => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`: ping\n\n`);
      }, 25_000);
      heartbeat.unref?.();

      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        if (scheduled) clearTimeout(scheduled);
      };
      req.raw.on('close', cleanup);
      req.raw.on('error', cleanup);

      // Hold the connection open. Fastify's reply lifecycle wants a return
      // value; an unresolved promise keeps it from finalising the response.
      return new Promise<void>(() => {
        /* never resolves - connection ends on client close */
      });
    },
  );
}

async function loadVisiblePadIds(userId: string): Promise<Set<string>> {
  const memberships = await prisma.padMember.findMany({
    where: { userId },
    select: { padId: true },
  });
  return new Set(memberships.map((m) => m.padId));
}
