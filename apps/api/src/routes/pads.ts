import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, canView, getPadAccess } from '../lib/permissions.js';
import { generateSlug } from '../lib/slug.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { langForFile, resolveLanguage } from '@opencoder/shared';

const validLanguage = (v: string): boolean => resolveLanguage(v) !== undefined;

const createBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  language: z.string().refine(validLanguage, 'unknown_language').optional(),
  kind: z.enum(['sandbox', 'interview']).optional(),
  template: z.enum(['hello', 'leetcode']).optional(),
});

const patchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  language: z.string().refine(validLanguage, 'unknown_language').optional(),
  kind: z.enum(['sandbox', 'interview']).optional(),
});

function summarize(
  pad: {
    id: string;
    slug: string;
    title: string;
    language: string;
    kind: string;
    ownerId: string;
    passwordHash?: string | null;
    updatedAt: Date;
    createdAt: Date;
  },
  myRole: string,
) {
  return {
    id: pad.id,
    slug: pad.slug,
    title: pad.title,
    language: pad.language,
    kind: pad.kind,
    ownerId: pad.ownerId,
    hasPassword: !!pad.passwordHash,
    updatedAt: pad.updatedAt.toISOString(),
    createdAt: pad.createdAt.toISOString(),
    myRole,
  };
}

export async function registerPadRoutes(server: FastifyInstance): Promise<void> {
  // List pads I own or am a member of
  server.get('/', { preHandler: server.requireAuth }, async (req) => {
    const userId = req.currentUser!.sub;
    const memberships = await prisma.padMember.findMany({
      where: { userId },
      include: { pad: true },
      orderBy: { pad: { updatedAt: 'desc' } },
    });
    return {
      pads: memberships.map((m) => summarize(m.pad, m.role)),
    };
  });

  // Create pad
  server.post('/', { preHandler: server.requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.sub;
    const parsed = createBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const language = parsed.data.language ?? 'python312';
    const langSpec = resolveLanguage(language)!;
    const kind = parsed.data.kind ?? 'sandbox';
    const title = parsed.data.title ?? `${capitalize(langSpec.label)} pad`;

    // generate a unique slug (collision retry)
    let slug = generateSlug();
    for (let i = 0; i < 5; i++) {
      const existing = await prisma.pad.findUnique({ where: { slug } });
      if (!existing) break;
      slug = generateSlug();
    }
    const ext = langSpec.fileExt ?? '.txt';
    const fileName = ext === '.java' ? 'Main.java' : ext === '.hs' ? 'Main.hs' : `main${ext}`;
    const template = parsed.data.template ?? 'hello';
    const { templateFor } = await import('@opencoder/shared');
    const content = templateFor(language, template);
    const pad = await prisma.pad.create({
      data: {
        slug,
        title,
        language,
        kind,
        ownerId: userId,
        members: { create: { userId, role: 'owner' } },
        files: {
          create: {
            name: fileName,
            language: langForFile(fileName) === 'plaintext' ? language : langForFile(fileName),
            content,
          },
        },
      },
    });
    return reply.code(201).send({ pad: summarize(pad, 'owner') });
  });

  // Read pad
  server.get('/:slug', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });

    const [files, members] = await Promise.all([
      prisma.padFile.findMany({
        where: { padId: access.pad.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          language: true,
          sortOrder: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      prisma.padMember.findMany({
        where: { padId: access.pad.id },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    return {
      pad: summarize(access.pad, access.role),
      files: files.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString(), createdAt: f.createdAt.toISOString() })),
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        name: m.user.name,
        email: m.user.email,
      })),
    };
  });

  // Patch pad
  server.patch('/:slug', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });

    const parsed = patchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const updated = await prisma.pad.update({
      where: { id: access.pad.id },
      data: parsed.data,
    });
    return { pad: summarize(updated, access.role) };
  });

  // Public-ish preview: returns minimal info (title, hasPassword) for the
  // unlock flow. Requires auth but not membership.
  server.get(
    '/:slug/preview',
    { preHandler: server.requireAuth },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const pad = await prisma.pad.findUnique({
        where: { slug },
        select: { slug: true, title: true, kind: true, passwordHash: true },
      });
      if (!pad) return reply.code(404).send({ error: 'not_found' });
      return {
        slug: pad.slug,
        title: pad.title,
        kind: pad.kind,
        hasPassword: !!pad.passwordHash,
      };
    },
  );

  // Set/clear pad password
  server.patch('/:slug/password', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z
      .object({
        password: z.string().min(0).max(200).nullable().optional(),
        role: z.enum(['collaborator', 'viewer', 'candidate']).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const data: { passwordHash: string | null; passwordRole?: string } = {
      passwordHash: parsed.data.password
        ? await hashPassword(parsed.data.password)
        : null,
    };
    if (parsed.data.role) data.passwordRole = parsed.data.role;
    await prisma.pad.update({ where: { id: access.pad.id }, data });
    return { ok: true, hasPassword: !!data.passwordHash };
  });

  // Unlock pad with password — joins the calling user as the pad's passwordRole
  server.post('/:slug/unlock', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const pad = await prisma.pad.findUnique({ where: { slug } });
    if (!pad) return reply.code(404).send({ error: 'not_found' });
    if (!pad.passwordHash) return reply.code(400).send({ error: 'no_password' });
    const ok = await verifyPassword(parsed.data.password, pad.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'wrong_password' });
    if (pad.ownerId !== userId) {
      await prisma.padMember.upsert({
        where: { padId_userId: { padId: pad.id, userId } },
        update: {},
        create: { padId: pad.id, userId, role: pad.passwordRole },
      });
    }
    return { ok: true, slug, role: pad.passwordRole };
  });

  // Fork pad — copy all files into a new pad owned by the caller.
  server.post('/:slug/fork', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access || !canView(access.role)) return reply.code(404).send({ error: 'not_found' });

    const files = await prisma.padFile.findMany({
      where: { padId: access.pad.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const packages = await prisma.pad.findUnique({
      where: { id: access.pad.id },
      select: { packages: true },
    });
    let newSlug = generateSlug();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.pad.findUnique({ where: { slug: newSlug } });
      if (!exists) break;
      newSlug = generateSlug();
    }
    const fork = await prisma.pad.create({
      data: {
        slug: newSlug,
        title: `${access.pad.title} (fork)`,
        language: access.pad.language,
        kind: 'sandbox',
        ownerId: userId,
        packages: packages?.packages ?? null,
        members: { create: { userId, role: 'owner' } },
        files: {
          create: files.map((f, i) => ({
            name: f.name,
            language: f.language,
            content: f.content,
            sortOrder: i,
          })),
        },
      },
    });
    return reply.code(201).send({ pad: summarize(fork, 'owner') });
  });

  // Patch packages config — owner only.
  server.patch('/:slug/packages', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z
      .object({
        pip: z.array(z.string().max(120)).max(60).optional(),
        npm: z.array(z.string().max(120)).max(60).optional(),
        cargo: z.array(z.string().max(120)).max(60).optional(),
        gem: z.array(z.string().max(120)).max(60).optional(),
        apt: z.array(z.string().max(120)).max(60).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    await prisma.pad.update({
      where: { id: access.pad.id },
      data: { packages: JSON.stringify(parsed.data) },
    });
    return { ok: true, packages: parsed.data };
  });

  // Delete pad
  server.delete('/:slug', { preHandler: server.requireAuth }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const userId = req.currentUser!.sub;
    const access = await getPadAccess(slug, userId);
    if (!access) return reply.code(404).send({ error: 'not_found' });
    if (!canManage(access.role)) return reply.code(403).send({ error: 'forbidden' });
    await prisma.pad.delete({ where: { id: access.pad.id } });
    return reply.send({ ok: true });
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
