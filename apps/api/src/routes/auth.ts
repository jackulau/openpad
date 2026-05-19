import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { clearToken, issueToken } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

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
}
