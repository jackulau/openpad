import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('demo1234', 10);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@opencoder.local' },
    update: {},
    create: {
      email: 'demo@opencoder.local',
      name: 'Demo',
      passwordHash,
    },
  });

  const pad = await prisma.pad.upsert({
    where: { slug: 'welcome' },
    update: {},
    create: {
      slug: 'welcome',
      title: 'Welcome to opencoder',
      language: 'python',
      kind: 'sandbox',
      ownerId: demo.id,
      members: {
        create: { userId: demo.id, role: 'owner' },
      },
      files: {
        create: {
          name: 'main.py',
          language: 'python',
          content: 'print("hello, friend!")\n',
        },
      },
    },
  });

  await prisma.question.upsert({
    where: { id: 'seed-q-fizzbuzz' },
    update: {},
    create: {
      id: 'seed-q-fizzbuzz',
      title: 'FizzBuzz',
      body: 'Print numbers 1..100. Multiples of 3 → Fizz, of 5 → Buzz, of both → FizzBuzz.',
      language: 'python',
      difficulty: 'easy',
      tags: 'classic,warmup',
      createdBy: demo.id,
    },
  });

  console.log('seeded:', { user: demo.email, pad: pad.slug });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
