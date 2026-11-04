import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { validateEnv } from '../config/env';
import { runSeed } from './seed';

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma, env);
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
