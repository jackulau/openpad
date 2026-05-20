import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { clearToken, issueToken } from '../lib/auth.js';
import { hashPassword } from '../lib/password.js';
import { randomToken } from '../lib/slug.js';
import { recordAudit } from '../lib/audit.js';

// Rate limit for guest signup. Friction-free auth: open-source self-hosters
// want one button → name → in. No email, no password, no recovery flow.
const GUEST_RATE = { max: 10, timeWindow: '1 minute' };

export async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  // The ONLY signup path. Pick a name, get a token. The synthetic email + random
  // password kept under the hood satisfy the unique-email constraint without
  // exposing those concepts to the user.
  server.post('/guest', { config: { rateLimit: GUEST_RATE } }, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        // Optional stable email used by integration tests for cross-lookup.
        // Never sent by the UI - the user always sees a name-only form.
        email: z.string().email().max(254).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const lcEmail = parsed.data.email?.toLowerCase();
    if (lcEmail) {
      const existing = await prisma.user.findUnique({ where: { email: lcEmail } });
      if (existing) return reply.code(409).send({ error: 'email_taken' });
    }
    const handle = randomToken(10).toLowerCase();
    const email = lcEmail ?? `guest-${handle}@local`;
    const password = randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name: parsed.data.name, passwordHash },
    });
    const token = await issueToken(reply, { sub: user.id, email: user.email, name: user.name });
    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    });
  });

  server.post('/logout', async (_req, reply) => {
    clearToken(reply);
    return reply.send({ ok: true });
  });

  server.get('/me', { preHandler: server.requireAuth }, async (req, reply) => {
    if (!req.currentUser) return reply.code(401).send({ error: 'unauthenticated' });
    const user = await prisma.user.findUnique({ where: { id: req.currentUser.sub } });
    if (!user) return reply.code(401).send({ error: 'user_missing' });
    return {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    };
  });

  // PATCH /me - change display name. No password concept since auth is
  // name-only.
  server.patch('/me', { preHandler: server.requireAuth }, async (req, reply) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const userId = req.currentUser!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(401).send({ error: 'user_missing' });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name: parsed.data.name },
    });
    recordAudit({ action: 'user.name.change', userId, req });
    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        createdAt: updated.createdAt,
      },
    };
  });

  // DELETE /me - destroy the account and all owned content. Confirm-only;
  // there is no password to re-prompt with.
  server.delete('/me', { preHandler: server.requireAuth }, async (req, reply) => {
    const parsed = z
      .object({ confirm: z.literal('DELETE') })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const userId = req.currentUser!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(401).send({ error: 'user_missing' });
    await prisma.user.delete({ where: { id: userId } });
    recordAudit({ action: 'user.delete', userId, req, meta: { email: user.email } });
    clearToken(reply);
    return { ok: true };
  });
}
