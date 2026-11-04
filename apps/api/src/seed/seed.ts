import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import type { Env } from '../config/env';

const SUBJECTS = [
  { name: 'Toán', slug: 'toan' },
  { name: 'Vật lý', slug: 'vat-ly' },
  { name: 'Hoá học', slug: 'hoa-hoc' },
  { name: 'Tiếng Anh', slug: 'tieng-anh' },
  { name: 'Ngữ văn', slug: 'ngu-van' },
  { name: 'Lập trình', slug: 'lap-trinh' },
];

const hash = (password: string): Promise<string> => argon2.hash(password, { type: argon2.argon2id });

/**
 * Idempotent. Always: subjects (catalogue) + the Admin from SEED_ADMIN_PASSWORD with
 * must_change_password (C6). Demo accounts/slots only when SEED_DEMO_DATA=true.
 * An existing account is never modified, so re-running never resets a password.
 */
export async function runSeed(
  prisma: PrismaClient,
  env: Pick<Env, 'SEED_ADMIN_EMAIL' | 'SEED_ADMIN_PASSWORD' | 'SEED_DEMO_DATA'>,
  now: Date = new Date(),
): Promise<void> {
  for (const subject of SUBJECTS) {
    await prisma.subject.upsert({ where: { slug: subject.slug }, update: {}, create: subject });
  }

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(env.SEED_ADMIN_PASSWORD),
        fullName: 'Quản trị viên',
        role: 'ADMIN',
        mustChangePassword: true,
      },
    });
  }

  if (env.SEED_DEMO_DATA === 'true') await seedDemo(prisma, env.SEED_ADMIN_PASSWORD, now);
}

/** Demo accounts share the SEED_ADMIN_PASSWORD value (no password literal in code). */
async function seedDemo(prisma: PrismaClient, password: string, now: Date): Promise<void> {
  const passwordHash = await hash(password);
  const subjects = await prisma.subject.findMany();
  const subjectId = (slug: string): number => {
    const found = subjects.find((s) => s.slug === slug);
    if (!found) throw new Error(`seed subject missing: ${slug}`);
    return found.id;
  };

  const tutors = [
    { email: 'gia-su-toan@demo.local', fullName: 'Nguyễn Văn An', price: 200_000, subjects: ['toan', 'vat-ly'] },
    { email: 'gia-su-anh@demo.local', fullName: 'Trần Thị Bình', price: 250_000, subjects: ['tieng-anh'] },
  ];

  if (!(await prisma.user.findUnique({ where: { email: 'hoc-vien@demo.local' } }))) {
    await prisma.user.create({
      data: { email: 'hoc-vien@demo.local', passwordHash, fullName: 'Lê Học Viên', role: 'STUDENT' },
    });
  }

  for (const t of tutors) {
    if (await prisma.user.findUnique({ where: { email: t.email } })) continue;
    const user = await prisma.user.create({
      data: {
        email: t.email,
        passwordHash,
        fullName: t.fullName,
        role: 'TUTOR',
        tutorProfile: {
          create: {
            bio: 'Gia sư demo.',
            experience: '5 năm kinh nghiệm.',
            pricePerSessionVnd: t.price,
            approvalStatus: 'APPROVED',
            subjects: { create: t.subjects.map((slug) => ({ subjectId: subjectId(slug) })) },
          },
        },
      },
    });
    // Two 1-hour slots a day for the next 7 days at 09:00 and 14:00 Asia/Ho_Chi_Minh (UTC+7).
    const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let d = 1; d <= 7; d++) {
      for (const hourUtc of [2, 7]) {
        const startAt = new Date(day0 + d * 86_400_000 + hourUtc * 3_600_000);
        await prisma.slot.create({
          data: { tutorId: user.id, startAt, endAt: new Date(startAt.getTime() + 3_600_000) },
        });
      }
    }
  }
}
