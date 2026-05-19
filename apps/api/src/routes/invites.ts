import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, getPadAccess, type Role } from '../lib/permissions.js';
import { randomToken } from '../lib/slug.js';
import { env } from '../env.js';

const roleEnum = z.enum(['collaborator', 'viewer', 'candidate']);

const createBody = z.object({
  email: z.string().email().max(254).optional(),
  role: roleEnum.default('collaborator'),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
});

const shareBody = z.object({
  role: roleEnum.default('collaborator'),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});

function inviteUrl(token: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/invite/${token}`;
}

function shape(inv: {
  id: string;
  email: string | null;
  token: string;
  role: string;
  expiresAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: inv.id,
    email: inv.email,
    token: inv.token,
    role: inv.role,
    url: inviteUrl(inv.token),
    expiresAt: inv.expiresAt?.toISOString() ?? null,
    usedAt: inv.usedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

export async function registerInviteRoutes(server: FastifyInstance): Promise<void> {
  server.post(
    '/:slug/invites',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const expiresAt = parsed.data.expiresInHours
        ? new Date(Date.now() + parsed.data.expiresInHours * 3600 * 1000)
        : null;
      const inv = await prisma.invite.create({
        data: {
          padId: access.pad.id,
          email: parsed.data.email?.toLowerCase() ?? null,
          token: randomToken(32),
          role: parsed.data.role,
          createdBy: userId,
          expiresAt,
        },
      });
      return reply.code(201).send({ invite: shape(inv) });
    },
  );

  server.post(
    '/:slug/share',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = shareBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const inv = await prisma.invite.create({
        data: {
          padId: access.pad.id,
          email: null,
          token: randomToken(32),
          role: parsed.data.role,
          createdBy: userId,
          expiresAt: new Date(Date.now() + parsed.data.expiresInHours * 3600 * 1000),
        },
      });
      return reply.code(201).send({ invite: shape(inv) });
    },
  );

  server.get(
    '/:slug/invites',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const invs = await prisma.invite.findMany({
        where: { padId: access.pad.id },
        orderBy: { createdAt: 'desc' },
      });
      return { invites: invs.map(shape) };
    },
  );

  server.delete(
    '/:slug/invites/:inviteId',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, inviteId } = req.params as { slug: string; inviteId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const inv = await prisma.invite.findUnique({ where: { id: inviteId } });
      if (!inv || inv.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await prisma.invite.delete({ where: { id: inviteId } });
      return { ok: true };
    },
  );

  server.delete(
    '/:slug/members/:memberId',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug, memberId } = req.params as { slug: string; memberId: string };
      const userId = req.currentUser!.sub;
      const access = await getPadAccess(slug, userId);
      if (!access) return reply.code(404).send({ error: 'not_found' });
      if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
      const m = await prisma.padMember.findUnique({ where: { id: memberId } });
      if (!m || m.padId !== access.pad.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (m.userId === access.pad.ownerId) {
        return reply.code(400).send({ error: 'cannot_remove_owner' });
      }
      await prisma.padMember.delete({ where: { id: memberId } });
      return { ok: true };
    },
  );
}

export async function registerInviteAcceptRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/invites/:token — preview (no auth needed; returns sanitized info)
  server.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const inv = await prisma.invite.findUnique({
      where: { token },
      include: { pad: { select: { slug: true, title: true } } },
    });
    if (!inv) return reply.code(404).send({ error: 'not_found' });
    if (inv.usedAt) return reply.code(410).send({ error: 'already_used' });
    if (inv.expiresAt && inv.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'expired' });
    }
    return {
      invite: {
        token: inv.token,
        role: inv.role as Role,
        emailRestricted: inv.email !== null,
        padSlug: inv.pad.slug,
        padTitle: inv.pad.title,
        expiresAt: inv.expiresAt?.toISOString() ?? null,
      },
    };
  });

  server.post('/:token/accept', { preHandler: server.requireAuth }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const userId = req.currentUser!.sub;
    const inv = await prisma.invite.findUnique({
      where: { token },
      include: { pad: true },
    });
    if (!inv) return reply.code(404).send({ error: 'not_found' });
    if (inv.usedAt) return reply.code(410).send({ error: 'already_used' });
    if (inv.expiresAt && inv.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'expired' });
    }
    if (inv.email) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.email !== inv.email) {
        return reply.code(403).send({ error: 'wrong_email' });
      }
    }
    await prisma.padMember.upsert({
      where: { padId_userId: { padId: inv.padId, userId } },
      update: {},
      create: { padId: inv.padId, userId, role: inv.role },
    });
    if (inv.email) {
      // Email-bound invites are single-use.
      await prisma.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    }
    return { ok: true, slug: inv.pad.slug };
  });
}
