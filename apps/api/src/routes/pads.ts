import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { canManage, canView, getPadAccess } from '../lib/permissions.js';
import { generateSlug } from '../lib/slug.js';
import { LANGUAGES, langForFile } from '@opencoder/shared';

const createBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  language: z.string().refine((v) => v in LANGUAGES, 'unknown_language').optional(),
  kind: z.enum(['sandbox', 'interview']).optional(),
});

const patchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  language: z.string().refine((v) => v in LANGUAGES, 'unknown_language').optional(),
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
    const language = parsed.data.language ?? 'python';
    const kind = parsed.data.kind ?? 'sandbox';
    const title = parsed.data.title ?? `${capitalize(language)} pad`;

    // generate a unique slug (collision retry)
    let slug = generateSlug();
    for (let i = 0; i < 5; i++) {
      const existing = await prisma.pad.findUnique({ where: { slug } });
      if (!existing) break;
      slug = generateSlug();
    }
    const ext = LANGUAGES[language]?.fileExt ?? '.txt';
    const fileName = `main${ext}`;
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
            content: starterFor(language),
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

function starterFor(language: string): string {
  switch (language) {
    case 'python':
      return 'print("hello, friend!")\n';
    case 'javascript':
      return 'console.log("hello, friend!");\n';
    case 'typescript':
      return 'const greet = (who: string) => `hello, ${who}!`;\nconsole.log(greet("friend"));\n';
    case 'go':
      return 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello, friend!")\n}\n';
    case 'rust':
      return 'fn main() {\n    println!("hello, friend!");\n}\n';
    case 'java':
      return 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello, friend!");\n    }\n}\n';
    case 'cpp':
      return '#include <iostream>\nint main() {\n    std::cout << "hello, friend!\\n";\n}\n';
    case 'c':
      return '#include <stdio.h>\nint main() {\n    printf("hello, friend!\\n");\n    return 0;\n}\n';
    case 'ruby':
      return 'puts "hello, friend!"\n';
    case 'csharp':
      return 'Console.WriteLine("hello, friend!");\n';
    default:
      return '';
  }
}
