import { BookingStateMachine } from '../src/bookings/booking-state-machine';
import { abbreviateName } from '../src/reviews/reviews.dto';
import { fixtures, HOUR, MIN, User, UUID0 } from './fixtures';
import { createTestApp, get, post, resetDb, TestApp } from './helpers';

describe('reschedule + reviews (T5)', () => {
  let t: TestApp;
  let f: ReturnType<typeof fixtures>;
  let tutor: User;
  let student: User;

  const reschedule = (who: User, bookingId: string, newSlotId: string) =>
    post(t.app, `/bookings/${bookingId}/reschedule`, who.cookie).send({ newSlotId });

  const review = (who: User, bookingId: string, body: object = { rating: 5 }) =>
    post(t.app, `/bookings/${bookingId}/review`, who.cookie).send(body);

  const slotStatus = async (id: string) => (await t.prisma.slot.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    t = await createTestApp();
    f = fixtures(t);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.prisma);
    t.clock.set(new Date());
    tutor = await f.addTutor();
    student = await f.addUser('STUDENT', 'Nguyen Van An');
  });

  describe('authorization matrix (DoD)', () => {
    const endpoints: [string, string][] = [
      ['post', `/bookings/${UUID0}/reschedule`],
      ['post', `/bookings/${UUID0}/review`],
    ];
    const call = (path: string, cookie?: string) => post(t.app, path, cookie).send({ newSlotId: UUID0, rating: 5 });

    it.each(endpoints)('%s %s: no session -> 401, tutor/admin -> 403', async (_m, path) => {
      expect((await call(path)).status).toBe(401);
      expect((await call(path, tutor.cookie)).status).toBe(403);
      expect((await call(path, (await f.addUser('ADMIN')).cookie)).status).toBe(403);
    });

    it('IDOR: another student gets 404 for reschedule and review, and nothing changes', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const target = await f.addSlot(tutor.id);
      const other = await f.addUser('STUDENT');
      expect((await reschedule(other, booking.id, target.id)).status).toBe(404);
      expect((await review(other, booking.id)).status).toBe(404);
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).rescheduleCount).toBe(0);
      expect(await slotStatus(target.id)).toBe('AVAILABLE');
    });

    it('malformed ids are 400', async () => {
      expect((await post(t.app, '/bookings/nope/reschedule', student.cookie).send({ newSlotId: UUID0 })).status).toBe(400);
      expect((await post(t.app, '/bookings/nope/review', student.cookie).send({ rating: 5 })).status).toBe(400);
    });

    it('/tutor/reviews: anonymous 401, student 403', async () => {
      expect((await get(t.app, '/tutor/reviews')).status).toBe(401);
      expect((await get(t.app, '/tutor/reviews', student.cookie)).status).toBe(403);
    });
  });

  describe('POST /bookings/:id/reschedule', () => {
    it('moves to a free slot of the same tutor atomically', async () => {
      const { booking, slot: old, payment } = await f.confirmedBooking(student, tutor);
      const target = await f.addSlot(tutor.id, 96 * HOUR);
      const res = await reschedule(student, booking.id, target.id).expect(200);

      expect(res.body).toMatchObject({
        id: booking.id,
        status: 'CONFIRMED',
        slotId: target.id,
        startAt: target.startAt.toISOString(),
        endAt: target.endAt.toISOString(),
        rescheduleCount: 1,
        payment: { id: payment.id, status: 'PAID' },
        actions: { reschedule: { allowed: false, reasonCode: 'RESCHEDULE_LIMIT' } },
      });
      expect(await slotStatus(old.id)).toBe('AVAILABLE');
      expect(await slotStatus(target.id)).toBe('BOOKED');

      const history = await t.prisma.bookingHistory.findMany({ where: { bookingId: booking.id } });
      expect(history).toEqual([
        expect.objectContaining({ fromStatus: 'CONFIRMED', toStatus: 'CONFIRMED', fromSlotId: old.id, toSlotId: target.id, actorId: student.id, note: 'RESCHEDULED' }),
      ]);
      const mails = await t.prisma.emailOutbox.findMany({ orderBy: { template: 'asc' } });
      expect(mails.map((m) => m.template)).toEqual(['booking_rescheduled_student', 'booking_rescheduled_tutor']);
      expect(mails[0].payload).toMatchObject({ startAt: target.startAt.toISOString(), oldStartAt: old.startAt.toISOString() });
    });

    it('the vacated slot can be booked by someone else straight away', async () => {
      const { booking, slot: old } = await f.confirmedBooking(student, tutor);
      await reschedule(student, booking.id, (await f.addSlot(tutor.id, 96 * HOUR)).id).expect(200);
      const other = await f.addUser('STUDENT');
      await post(t.app, '/bookings', other.cookie).send({ slotId: old.id }).expect(201);
    });

    it('only once: the second attempt is 409 RESCHEDULE_LIMIT', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      await reschedule(student, booking.id, (await f.addSlot(tutor.id, 96 * HOUR)).id).expect(200);
      const again = await reschedule(student, booking.id, (await f.addSlot(tutor.id, 120 * HOUR)).id).expect(409);
      expect(again.body.error.code).toBe('RESCHEDULE_LIMIT');
    });

    it('24h window: exactly 24h before start is allowed, one second later is WINDOW_PASSED', async () => {
      const { booking, slot } = await f.confirmedBooking(student, tutor, 48 * HOUR);
      const target = await f.addSlot(tutor.id, 200 * HOUR);
      await f.jump(new Date(slot.startAt.getTime() - 24 * HOUR + 1000), [student]);
      const denied = await reschedule(student, booking.id, target.id).expect(409);
      expect(denied.body.error.code).toBe('WINDOW_PASSED');
      expect((await get(t.app, `/bookings/${booking.id}`, student.cookie)).body.actions.reschedule).toEqual({
        allowed: false,
        reasonCode: 'WINDOW_PASSED',
      });
      await f.jump(new Date(slot.startAt.getTime() - 24 * HOUR), [student]);
      await reschedule(student, booking.id, target.id).expect(200);
    });

    it('not for unpaid, cancelled or expired bookings: NOT_CONFIRMED', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const target = await f.addSlot(tutor.id, 96 * HOUR);
      for (const status of ['PENDING_PAYMENT', 'CANCELLED_BY_STUDENT', 'EXPIRED'] as const) {
        await t.prisma.booking.update({
          where: { id: booking.id },
          data: { status, holdExpiresAt: status === 'PENDING_PAYMENT' ? new Date(t.clock.now().getTime() + 10 * MIN) : null },
        });
        const res = await reschedule(student, booking.id, target.id).expect(409);
        expect(res.body.error.code).toBe('NOT_CONFIRMED');
      }
    });

    it('refuses targets that do not fit and leaves everything untouched', async () => {
      const { booking, slot: old } = await f.confirmedBooking(student, tutor);
      const otherTutor = await f.addTutor();
      const code = async (slotId: string, status: number) => {
        const res = await reschedule(student, booking.id, slotId).expect(status);
        return res.body.error?.code;
      };

      expect(await code((await f.addSlot(otherTutor.id, 96 * HOUR)).id, 409)).toBe('SLOT_UNAVAILABLE'); // other tutor
      expect(await code((await f.addSlot(tutor.id, 96 * HOUR, { durationMs: 2 * HOUR })).id, 409)).toBe('SLOT_UNAVAILABLE'); // other duration
      expect(await code((await f.addSlot(tutor.id, 96 * HOUR, { status: 'BOOKED' })).id, 409)).toBe('SLOT_UNAVAILABLE'); // taken
      expect(await code(old.id, 409)).toBe('SLOT_UNAVAILABLE'); // its own slot
      expect(await code((await f.addSlot(tutor.id, 100 * HOUR, { status: 'CLOSED' })).id, 404)).toBe('NOT_FOUND');
      expect(await code(UUID0, 404)).toBe('NOT_FOUND');
      const deleted = await f.addSlot(tutor.id, 104 * HOUR);
      await t.prisma.slot.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
      expect(await code(deleted.id, 404)).toBe('NOT_FOUND');

      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row).toMatchObject({ slotId: old.id, rescheduleCount: 0 });
      expect(await slotStatus(old.id)).toBe('BOOKED');
    });

    it('SLOT_TOO_SOON inside the booking lead time (a slot in the past included)', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const soon = await f.addSlot(tutor.id, 20 * MIN);
      expect((await reschedule(student, booking.id, soon.id).expect(409)).body.error.code).toBe('SLOT_TOO_SOON');
      const past = await f.addSlot(tutor.id, -5 * HOUR);
      expect((await reschedule(student, booking.id, past.id).expect(409)).body.error.code).toBe('SLOT_TOO_SOON');
    });

    it('TUTOR_NOT_ACCEPTING when the tutor was suspended', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const target = await f.addSlot(tutor.id, 96 * HOUR);
      await t.prisma.tutorProfile.update({ where: { userId: tutor.id }, data: { approvalStatus: 'SUSPENDED' } });
      expect((await reschedule(student, booking.id, target.id).expect(409)).body.error.code).toBe('TUTOR_NOT_ACCEPTING');
    });

    it('STUDENT_OVERLAP with another booking of the same student, with details', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const other = await f.addTutor({ name: 'Gia Su Binh' });
      const busy = await f.confirmedBooking(student, other, 96 * HOUR);
      const target = await f.addSlot(tutor.id, 96 * HOUR);
      expect(target.startAt.getTime()).toBe(busy.slot.startAt.getTime());
      const res = await reschedule(student, booking.id, target.id).expect(409);
      expect(res.body.error.code).toBe('STUDENT_OVERLAP');
      expect(res.body.error.details.conflictingBooking).toMatchObject({ id: busy.booking.id, tutorName: 'Gia Su Binh' });
    });

    it('validates the body (mass assignment, bad ids)', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      for (const body of [{}, { newSlotId: 'x' }, { newSlotId: UUID0, status: 'CONFIRMED' }, { newSlotId: UUID0, priceVnd: 1 }]) {
        expect((await post(t.app, `/bookings/${booking.id}/reschedule`, student.cookie).send(body)).status).toBe(400);
      }
    });

    it('any failure rolls everything back: the booking keeps its old slot (AC5)', async () => {
      const { booking, slot: old } = await f.confirmedBooking(student, tutor);
      const target = await f.addSlot(tutor.id, 96 * HOUR);
      const machine = t.app.get(BookingStateMachine);
      const spy = jest.spyOn(machine, 'enqueue').mockRejectedValueOnce(new Error('outbox down'));
      try {
        expect((await reschedule(student, booking.id, target.id)).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(await t.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ slotId: old.id, startAt: old.startAt, rescheduleCount: 0 });
      expect(await slotStatus(old.id)).toBe('BOOKED');
      expect(await slotStatus(target.id)).toBe('AVAILABLE');
      expect(await t.prisma.bookingHistory.count()).toBe(0);
      expect(await t.prisma.emailOutbox.count()).toBe(0);
    });

    it('two students racing for one target slot: exactly one wins', async () => {
      const other = await f.addUser('STUDENT');
      const a = await f.confirmedBooking(student, tutor, 72 * HOUR);
      const b = await f.confirmedBooking(other, tutor, 80 * HOUR);
      const target = await f.addSlot(tutor.id, 200 * HOUR);
      const results = await Promise.all([reschedule(student, a.booking.id, target.id), reschedule(other, b.booking.id, target.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await t.prisma.booking.count({ where: { slotId: target.id } })).toBe(1);
    });

    it('10 parallel reschedules of one booking: one 200, the rest RESCHEDULE_LIMIT, one slot booked', async () => {
      const { booking, slot: old } = await f.confirmedBooking(student, tutor, 72 * HOUR);
      const targets = await Promise.all(Array.from({ length: 10 }, (_, i) => f.addSlot(tutor.id, (100 + i * 2) * HOUR)));
      const results = await Promise.all(targets.map((s) => reschedule(student, booking.id, s.id)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) expect(r.body.error.code).toBe('RESCHEDULE_LIMIT');
      expect(await t.prisma.slot.count({ where: { tutorId: tutor.id, status: 'BOOKED' } })).toBe(1);
      expect(await slotStatus(old.id)).toBe('AVAILABLE');
    });

    it('reschedule racing with cancel ends consistent', async () => {
      const { booking } = await f.confirmedBooking(student, tutor, 72 * HOUR);
      const target = await f.addSlot(tutor.id, 100 * HOUR);
      await Promise.all([reschedule(student, booking.id, target.id), post(t.app, `/bookings/${booking.id}/cancel`, student.cookie).send({})]);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      const booked = await t.prisma.slot.count({ where: { tutorId: tutor.id, status: 'BOOKED' } });
      // Reschedule-then-cancel frees the new slot; cancel-then-reschedule is refused. Either way no slot stays BOOKED.
      expect(row.status).toBe('CANCELLED_BY_STUDENT');
      expect(booked).toBe(0);
    });
  });

  describe('POST /bookings/:id/review', () => {
    /** CONFIRMED booking whose session ended an hour ago. */
    const finished = async (who: User = student, withTutor: User = tutor) => {
      const made = await f.confirmedBooking(who, withTutor, -3 * HOUR);
      return made.booking;
    };

    it('creates the review after the session and updates the tutor rating in the same step', async () => {
      const b = await finished();
      const res = await review(student, b.id, { rating: 4, comment: '  Dạy rất dễ hiểu  ' }).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        bookingId: b.id,
        studentName: 'Nguyen V.',
        rating: 4,
        comment: 'Dạy rất dễ hiểu',
        hidden: false,
        createdAt: expect.any(String),
      });
      const profile = await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } });
      expect(Number(profile.ratingAvg)).toBe(4);
      expect(profile.ratingCount).toBe(1);

      const detail = (await get(t.app, `/bookings/${b.id}`, student.cookie).expect(200)).body;
      expect(detail.review).toMatchObject({ rating: 4 });
      expect(detail.actions.review).toEqual({ allowed: false, reasonCode: 'ALREADY_REVIEWED' });
    });

    it('one review per booking: second is 409 ALREADY_REVIEWED, rating unchanged', async () => {
      const b = await finished();
      await review(student, b.id, { rating: 5 }).expect(201);
      expect((await review(student, b.id, { rating: 1 }).expect(409)).body.error.code).toBe('ALREADY_REVIEWED');
      expect(Number((await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } })).ratingAvg)).toBe(5);
    });

    it('NOT_FINISHED before the session ends (boundary: endAt itself is allowed)', async () => {
      const { booking, slot } = await f.confirmedBooking(student, tutor, 2 * HOUR);
      expect((await review(student, booking.id).expect(409)).body.error.code).toBe('NOT_FINISHED');
      expect((await get(t.app, `/bookings/${booking.id}`, student.cookie)).body.actions.review).toEqual({ allowed: false, reasonCode: 'NOT_FINISHED' });
      await f.jump(new Date(slot.endAt.getTime() - 1000), [student]);
      await review(student, booking.id).expect(409);
      await f.jump(slot.endAt, [student]);
      await review(student, booking.id).expect(201);
    });

    it('NOT_CONFIRMED for cancelled and unpaid bookings', async () => {
      const b = await finished();
      for (const status of ['CANCELLED_BY_TUTOR', 'EXPIRED', 'PENDING_PAYMENT'] as const) {
        await t.prisma.booking.update({ where: { id: b.id }, data: { status } });
        expect((await review(student, b.id).expect(409)).body.error.code).toBe('NOT_CONFIRMED');
      }
    });

    it('validates rating and comment; rejects extra fields', async () => {
      const b = await finished();
      const bad = [{}, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: '5' }, { rating: 5, comment: 'x'.repeat(1001) }, { rating: 5, studentId: UUID0 }, { rating: 5, hidden: true }];
      for (const body of bad) expect((await review(student, b.id, body)).status).toBe(400);
      expect(await t.prisma.review.count()).toBe(0);
      await review(student, b.id, { rating: 5, comment: 'x'.repeat(1000) }).expect(201);
    });

    it('stores a blank comment as null', async () => {
      const b = await finished();
      expect((await review(student, b.id, { rating: 3, comment: '   ' }).expect(201)).body.comment).toBeNull();
    });

    it('parallel duplicates create one review', async () => {
      const b = await finished();
      const results = await Promise.all(Array.from({ length: 8 }, () => review(student, b.id, { rating: 5 })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('ALREADY_REVIEWED');
      expect((await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } })).ratingCount).toBe(1);
    });

    it('parallel reviews of one tutor from different students keep the average exact', async () => {
      const students = await Promise.all(Array.from({ length: 6 }, () => f.addUser('STUDENT')));
      const bookings = await Promise.all(students.map((s) => finished(s)));
      const ratings = [5, 4, 4, 3, 2, 1];
      await Promise.all(students.map((s, i) => review(s, bookings[i].id, { rating: ratings[i] }).expect(201)));
      const profile = await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } });
      expect(profile.ratingCount).toBe(6);
      expect(Number(profile.ratingAvg)).toBe(3.17);
    });
  });

  describe('review lists (PublicReview, A2)', () => {
    const seedReview = async (name: string, rating: number, comment: string | null = null, forTutor: User = tutor) => {
      const s = await f.addUser('STUDENT', name);
      const { booking } = await f.confirmedBooking(s, forTutor, -3 * HOUR);
      await review(s, booking.id, { rating, ...(comment ? { comment } : {}) }).expect(201);
      return (await t.prisma.review.findUniqueOrThrow({ where: { bookingId: booking.id } })).id;
    };

    it('public list: allow-listed fields only, abbreviated names, newest first, paginated', async () => {
      await seedReview('Nguyễn Văn An', 5, 'Tốt');
      t.clock.advance(MIN);
      await seedReview('Trần Thị Bình', 4);
      const res = await get(t.app, `/tutors/${tutor.id}/reviews?pageSize=1`).expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['comment', 'createdAt', 'id', 'rating', 'studentName']);
      const all = (await get(t.app, `/tutors/${tutor.id}/reviews`).expect(200)).body.items;
      expect(all.map((r: { studentName: string }) => r.studentName).sort()).toEqual(['Nguyễn A.', 'Trần B.']);
      expect(JSON.stringify(all)).not.toMatch(/bookingId|hidden|studentId|email/i);
    });

    it('hidden reviews and non-approved or unknown tutors are invisible', async () => {
      const id = await seedReview('Le Van Cuong', 1);
      await seedReview('Pham Van Dung', 5);
      await t.prisma.review.update({ where: { id }, data: { isHidden: true } });
      expect((await get(t.app, `/tutors/${tutor.id}/reviews`).expect(200)).body.total).toBe(1);
      await t.prisma.tutorProfile.update({ where: { userId: tutor.id }, data: { approvalStatus: 'SUSPENDED' } });
      await get(t.app, `/tutors/${tutor.id}/reviews`).expect(404);
      await get(t.app, `/tutors/${UUID0}/reviews`).expect(404);
      await get(t.app, '/tutors/nope/reviews').expect(400);
    });

    it('GET /tutor/reviews shows only the caller\'s own, whatever their approval status', async () => {
      await seedReview('Nguyen Van An', 5);
      const other = await f.addTutor({ status: 'PENDING_APPROVAL' });
      await seedReview('Tran Van Binh', 2, null, other);
      const mine = (await get(t.app, '/tutor/reviews', tutor.cookie).expect(200)).body;
      expect(mine.total).toBe(1);
      expect(mine.items[0].rating).toBe(5);
      expect((await get(t.app, '/tutor/reviews', other.cookie).expect(200)).body.items[0].rating).toBe(2);
    });
  });

  describe('abbreviateName', () => {
    it.each([
      ['Nguyễn Văn An', 'Nguyễn A.'],
      ['  Trần   thị bình ', 'Trần B.'],
      ['An', 'An'],
      ['', ''],
    ])('%j -> %j', (input, expected) => expect(abbreviateName(input)).toBe(expected));
  });
});
