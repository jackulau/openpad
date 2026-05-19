import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, canView, getPadAccess } from '../lib/permissions.js';
import { recordAudit } from '../lib/audit.js';
import { onParticipantJoin, onParticipantLeave } from '../services/recordings.js';
import { buildTimeline } from '../services/playback.js';

const toggleBody = z.object({ autoRecord: z.boolean() });

export async function registerRecordingsRoutes(server: FastifyInstance): Promise<void> {
  // List recordings for a pad.
  server.get('/:slug/recordings', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
    const rows = await prisma.recording.findMany({
      where: { padId: access.pad.id },
      orderBy: { startedAt: 'desc' },
    });
    return {
      recordings: rows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        autoStarted: r.autoStarted,
        participants: safeJSON(r.participants, [] as Array<{ userId: string; name: string }>),
      })),
    };
  });

  // Toggle the autoRecord flag on the pad.
  server.patch(
    '/:slug/auto-record',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = toggleBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      await prisma.pad.update({
        where: { id: access.pad.id },
        data: { autoRecord: parsed.data.autoRecord },
      });
      return { ok: true, autoRecord: parsed.data.autoRecord };
    },
  );

  // Manually start a recording (independent of the autoRecord flag). Useful
  // when participants want one specific stretch captured.
  server.post(
    '/:slug/recordings',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
      // Force-start by temporarily marking the pad autoRecord on, calling join,
      // then restoring. Simpler than duplicating the start logic.
      const padId = access.pad.id;
      const wasAuto = access.pad.autoRecord ?? false;
      if (!wasAuto) {
        await prisma.pad.update({ where: { id: padId }, data: { autoRecord: true } });
      }
      try {
        await onParticipantJoin(padId, userId, req.currentUser!.name);
      } finally {
        if (!wasAuto) {
          await prisma.pad.update({ where: { id: padId }, data: { autoRecord: false } });
        }
      }
      const latest = await prisma.recording.findFirst({
        where: { padId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!latest) return reply.code(500).send({ error: 'failed_to_start' });
      return reply.code(201).send({ recordingId: latest.id, startedAt: latest.startedAt });
    },
  );

  // Stop a specific recording. Allowed for anyone who can manage the pad.
  server.post(
    '/:slug/recordings/:id/stop',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const rec = await prisma.recording.findUnique({ where: { id } });
      if (!rec || rec.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (rec.endedAt) return { ok: true, alreadyEnded: true };
      // Force the idle path to fire by reporting zero remaining + zero wait.
      await onParticipantLeave(access.pad.id, 0);
      const endedAt = new Date();
      await prisma.recording.update({
        where: { id },
        data: {
          endedAt,
          durationMs: endedAt.getTime() - rec.startedAt.getTime(),
          meta: JSON.stringify({ closedBy: 'manual', stoppedBy: userId }),
        },
      });
      recordAudit({
        action: 'recording.stop',
        userId,
        target: slug,
        req,
        meta: { recordingId: id, reason: 'manual' },
      });
      return { ok: true };
    },
  );

  // Export a recording as a self-contained JSON bundle (recording metadata +
  // the time-windowed playback timeline). Suitable for offline review or
  // forwarding to an interviewer pool.
  server.get(
    '/:slug/recordings/:id/export',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });
      const rec = await prisma.recording.findUnique({ where: { id } });
      if (!rec || rec.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const timeline = await buildTimeline(access.pad.id, {
        from: rec.startedAt,
        to: rec.endedAt ?? undefined,
      });
      const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        pad: {
          slug: access.pad.slug,
          title: access.pad.title,
          language: access.pad.language,
          kind: access.pad.kind,
        },
        recording: {
          id: rec.id,
          startedAt: rec.startedAt.toISOString(),
          endedAt: rec.endedAt?.toISOString() ?? null,
          durationMs: rec.durationMs,
          autoStarted: rec.autoStarted,
          participants: safeJSON(rec.participants, [] as Array<{ userId: string; name: string }>),
        },
        timeline,
      };
      reply.header('content-type', 'application/json');
      reply.header(
        'content-disposition',
        `attachment; filename="recording-${access.pad.slug}-${id}.json"`,
      );
      return bundle;
    },
  );

  // Delete a recording row entirely.
  server.delete(
    '/:slug/recordings/:id',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const rec = await prisma.recording.findUnique({ where: { id } });
      if (!rec || rec.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await prisma.recording.delete({ where: { id } });
      recordAudit({
        action: 'recording.delete',
        userId,
        target: slug,
        req,
        meta: { recordingId: id },
      });
      return { ok: true };
    },
  );
}

function safeJSON<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
