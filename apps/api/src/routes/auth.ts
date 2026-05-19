import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { clearToken, issueToken } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { randomToken } from '../lib/slug.js';

const registerBody = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(200),
});

const loginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  // Friction-free signup: just pick a name. Returns a token immediately.
  // Use this for the friends-only flow. /register stays for users who want
  // an email + password they can log back in with.
  server.post('/guest', async (req, reply) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    // Stable, opaque email so the unique-on-email constraint doesn't collide.
    const handle = randomToken(10).toLowerCase();
    const email = `guest-${handle}@local`;
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

  server.post('/register', async (req, reply) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const { email, name, password } = parsed.data;
    const lcEmail = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: lcEmail } });
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email: lcEmail, name, passwordHash },
    });
    const token = await issueToken(reply, { sub: user.id, email: user.email, name: user.name });
    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    });
  });

  server.post('/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    const token = await issueToken(reply, { sub: user.id, email: user.email, name: user.name });
    return reply.send({
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

  // PATCH /me — change name and/or password.
  server.patch('/me', { preHandler: server.requireAuth }, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        currentPassword: z.string().min(1).max(200).optional(),
        newPassword: z.string().min(8).max(200).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const userId = req.currentUser!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(401).send({ error: 'user_missing' });
    const data: { name?: string; passwordHash?: string } = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.newPassword) {
      if (!parsed.data.currentPassword) {
        return reply.code(400).send({ error: 'current_password_required' });
      }
      const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: 'wrong_current_password' });
      data.passwordHash = await hashPassword(parsed.data.newPassword);
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'no_changes' });
    const updated = await prisma.user.update({ where: { id: userId }, data });
    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        createdAt: updated.createdAt,
      },
    };
  });

  // DELETE /me — destroy the account and all owned content.
  server.delete('/me', { preHandler: server.requireAuth }, async (req, reply) => {
    const parsed = z
      .object({ confirm: z.literal('DELETE'), password: z.string().min(1).max(200) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const userId = req.currentUser!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(401).send({ error: 'user_missing' });
    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'wrong_password' });
    await prisma.user.delete({ where: { id: userId } });
    clearToken(reply);
    return { ok: true };
  });
}
