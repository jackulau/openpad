import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  name: string;
}

const COOKIE_NAME = 'oc_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function issueToken(reply: FastifyReply, payload: JwtPayload): Promise<string> {
  const token = await reply.jwtSign(payload, { expiresIn: '7d' });
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    domain: env.COOKIE_DOMAIN,
    maxAge: COOKIE_MAX_AGE,
  });
  return token;
}

export function clearToken(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.cookies?.[COOKIE_NAME];
  return cookie ?? undefined;
}
