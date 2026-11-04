import { Prisma, PrismaClient } from '@prisma/client';
import { insertUser, resetDb } from './helpers';

/** Postgres error code carried by a Prisma raw/known error (23P01 exclusion, 23505 unique, 23514 check). */
async function pgCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return '23505';
    // Prisma surfaces constraint types it does not model (exclusion, check) as an unknown request error whose text carries the SQLSTATE.
    return /code: "(\w{5})"/.exec((error as Error).message)?.[1] ?? 'unknown';
  }
}

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2030, 0, 1, hour, minute));

describe('DB constraints (architecture §3.3)', () => {
  const prisma = new PrismaClient();
  let tutorA: string;
  let tutorB: string;
  let student: string;

  const slot = (tutorId: string, from: Date, to: Date, status: 'AVAILABLE' | 'CLOSED' = 'AVAILABLE', deletedAt?: Date) =>
    prisma.slot.create({ data: { tutorId, startAt: from, endAt: to, status, deletedAt } });

  const booking = (slotId: string, tutorId: string, from: Date, to: Date, status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'EXPIRED' = 'CONFIRMED', studentId = student) =>
    prisma.booking.create({
      data: { studentId, tutorId, slotId, startAt: from, endAt: to, priceVnd: 100000, status },
    });

  beforeAll(async () => {
    await resetDb(prisma);
    tutorA = (await insertUser(prisma, 'TUTOR')).id;
    tutorB = (await insertUser(prisma, 'TUTOR')).id;
    student = (await insertUser(prisma, 'STUDENT')).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('constraints and indexes exist in the catalogue', async () => {
    const constraints = await prisma.$queryRaw<{ conname: string; contype: string }[]>`
      SELECT conname, contype FROM pg_constraint WHERE conname IN ('slots_no_overlap', 'bookings_student_no_overlap')`;
    expect(constraints.map((c) => c.conname).sort()).toEqual(['bookings_student_no_overlap', 'slots_no_overlap']);
    expect(constraints.every((c) => c.contype === 'x')).toBe(true);

    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'bookings_one_active_per_slot'`;
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(/UNIQUE/);
    expect(indexes[0].indexdef).toMatch(/PENDING_PAYMENT/);
  });

  it('users.email is case-insensitive unique (citext)', async () => {
    await prisma.user.create({
      data: { email: 'Mixed.Case@Example.com', passwordHash: 'x', fullName: 'A', role: 'STUDENT' },
    });
    const code = await pgCode(
      prisma.user.create({ data: { email: 'mixed.case@example.com', passwordHash: 'x', fullName: 'B', role: 'STUDENT' } }),
    );
    expect(code).toBe('23505');
  });

  describe('slots_no_overlap', () => {
    it('rejects an overlapping slot of the same tutor (23P01)', async () => {
      await slot(tutorA, at(9), at(10));
      expect(await pgCode(slot(tutorA, at(9, 30), at(10, 30)))).toBe('23P01');
    });

    it('allows back-to-back slots ([start, end) half-open)', async () => {
      await slot(tutorA, at(10), at(11));
      expect(await pgCode(slot(tutorA, at(11), at(12)))).toBeNull();
    });

    it('allows the same time for a different tutor', async () => {
      expect(await pgCode(slot(tutorB, at(9), at(10)))).toBeNull();
    });

    it('ignores CLOSED and soft-deleted slots', async () => {
      await slot(tutorA, at(13), at(14), 'CLOSED');
      expect(await pgCode(slot(tutorA, at(13), at(14)))).toBeNull();
      await slot(tutorB, at(15), at(16), 'AVAILABLE', new Date());
      expect(await pgCode(slot(tutorB, at(15), at(16)))).toBeNull();
    });

    it('rejects end <= start (CHECK)', async () => {
      expect(await pgCode(slot(tutorA, at(20), at(20)))).toBe('23514');
    });
  });

  describe('bookings', () => {
    it('allows only one active booking per slot (partial unique)', async () => {
      const s = await slot(tutorA, at(1), at(2));
      const other = (await insertUser(prisma, 'STUDENT')).id;
      await booking(s.id, tutorA, at(1), at(2), 'PENDING_PAYMENT');
      expect(await pgCode(booking(s.id, tutorA, at(1), at(2), 'CONFIRMED', other))).toBe('23505');
    });

    it('allows a new booking once the previous one is no longer active', async () => {
      const s = await slot(tutorA, at(3), at(4));
      await booking(s.id, tutorA, at(3), at(4), 'EXPIRED');
      expect(await pgCode(booking(s.id, tutorA, at(3), at(4), 'PENDING_PAYMENT'))).toBeNull();
    });

    it('stops a student holding two overlapping active bookings with different tutors (23P01)', async () => {
      const s1 = await slot(tutorA, at(5), at(6));
      const s2 = await slot(tutorB, at(5, 30), at(6, 30));
      await booking(s1.id, tutorA, at(5), at(6));
      expect(await pgCode(booking(s2.id, tutorB, at(5, 30), at(6, 30)))).toBe('23P01');
    });

    it('does not count inactive bookings for student overlap', async () => {
      const s1 = await slot(tutorA, at(7), at(8));
      const s2 = await slot(tutorB, at(7), at(8));
      await booking(s1.id, tutorA, at(7), at(8), 'EXPIRED');
      expect(await pgCode(booking(s2.id, tutorB, at(7), at(8)))).toBeNull();
    });

    it('rejects student = tutor and reschedule_count out of range (CHECK)', async () => {
      const s = await slot(tutorA, at(21), at(22));
      expect(await pgCode(booking(s.id, tutorA, at(21), at(22), 'CONFIRMED', tutorA))).toBe('23514');
      const s2 = await slot(tutorA, at(22), at(23));
      expect(
        await pgCode(
          prisma.booking.create({
            data: { studentId: student, tutorId: tutorA, slotId: s2.id, startAt: at(22), endAt: at(23), priceVnd: 1, status: 'CONFIRMED', rescheduleCount: 2 },
          }),
        ),
      ).toBe('23514');
    });
  });

  it('20 concurrent bookings of one slot yield exactly one winner', async () => {
    const s = await slot(tutorA, at(17), at(18));
    const students = await Promise.all(Array.from({ length: 20 }, () => insertUser(prisma, 'STUDENT')));
    const results = await Promise.all(
      students.map((u) => pgCode(booking(s.id, tutorA, at(17), at(18), 'PENDING_PAYMENT', u.id))),
    );
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === '23505')).toHaveLength(19);
  });
});
