import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const global_ = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  global_.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  global_.prisma = prisma;
}

export type DB = typeof prisma;
