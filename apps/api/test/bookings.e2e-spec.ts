import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BookingExpiryService } from '../src/bookings/booking-expiry.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../src/payments/payment-provider';
import { signMockWebhook } from '../src/payments/mock-signature';
import { API, createTestApp, get, insertUser, loginCookie, post, randomIp, resetDb, TestApp } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const UUID0 = '00000000-0000-4000-8000-000000000000';

describe('bookings + mock payment (T4)', () => {
  let t: TestApp;
  let tutor: User;
  let student: User;
  let price: number;

  interface User {
    id: string;
    email: string;
    cookie: string;
  }

  const addUser = async (role: 'STUDENT' | 'TUTOR' | 'ADMIN', name?: string): Promise<User> => {
    const user = await insertUser(t.prisma, role);
    if (name) await t.prisma.user.update({ where: { id: user.id }, data: { fullName: name } });
    return { id: user.id, email: user.email, cookie: await loginCookie(t.app, user.email) };
  };

  const addTutor = async (opts: { status?: 'APPROVED' | 'SUSPENDED'; price?: number | null; name?: string } = {}) => {
    const user = await addUser('TUTOR', opts.name ?? 'Gia Su An');
    await t.prisma.tutorProfile.create({
      data: {
        userId: user.id,
        approvalStatus: opts.status ?? 'APPROVED',
        pricePerSessionVnd: opts.price === undefined ? 300_000 : opts.price,
      },
    });
    return user;
  };

  /** Slot starting `inMs` after the fake clock's now (default 48h ahead, well past the 24h window). */
  const addSlot = (tutorId: string, inMs = 48 * HOUR, status: 'AVAILABLE' | 'CLOSED' = 'AVAILABLE') => {
    const startAt = new Date(Math.ceil((t.clock.now().getTime() + inMs) / HOUR) * HOUR);
    return t.prisma.slot.create({ data: { tutorId, startAt, endAt: new Date(startAt.getTime() + HOUR), status } });
  };

  const book = (who: User, slotId: string, key?: string) => {
    const req = post(t.app, '/bookings', who.cookie);
    return (key ? req.set('Idempotency-Key', key) : req).send({ slotId });
  };

  const bookOk = async (who: User, slotId: string) => (await book(who, slotId).expect(201)).body;

  const state = async (bookingId: string) => {
    const b = await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payment: true, slot: true } });
    return { booking: b.status, payment: b.payment!.status, reason: b.payment!.failureReason, slot: b.slot.status };
  };

  const paymentOf = (bookingId: string) => t.prisma.payment.findUniqueOrThrow({ where: { bookingId } });

  const WEBHOOK_SECRET = () => process.env.PAYMENT_WEBHOOK_SECRET as string;

  const event = (providerRef: string, outcome: 'SUCCEEDED' | 'FAILED', amountVnd = price, eventId = `evt_${randomUUID()}`) => ({
    eventId,
    providerRef,
    outcome,
    amountVnd,
    occurredAt: t.clock.now().toISOString(),
  });

  /** Signed webhook call straight at the endpoint (the gateway path is covered separately). */
  const hook = (body: object | string, opts: { signature?: string | null; at?: Date; secret?: string } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const signature =
      opts.signature === undefined
        ? signMockWebhook(opts.secret ?? WEBHOOK_SECRET(), opts.at ?? t.clock.now(), Buffer.from(raw))
        : opts.signature;
    const req = request(t.app.getHttpServer())
      .post(`${API}/payments/webhooks/mock`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', randomIp());
    return (signature ? req.set('X-Mock-Signature', signature) : req).send(raw);
  };

  const complete = (who: User, paymentId: string, result: 'SUCCESS' | 'FAILURE') =>
    post(t.app, `/mock-gateway/payments/${paymentId}/complete`, who.cookie).send({ result });

  /** Booking confirmed through the real gateway -> signed webhook path. */
  const confirmed = async (who: User, slotId: string) => {
    const created = await bookOk(who, slotId);
    await complete(who, created.booking.payment.id, 'SUCCESS').expect(200);
    return created.booking.id as string;
  };

  /** Moves the fake clock far ahead; sessions are clock-bound (8h), so the actors log in again. */
  const jump = async (to: Date) => {
    t.clock.set(to);
    for (const who of [student, tutor]) who.cookie = await loginCookie(t.app, who.email);
  };

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.prisma);
    t.clock.set(new Date());
    price = 300_000;
    tutor = await addTutor();
    student = await addUser('STUDENT', 'Hoc Vien Binh');
  });

  describe('authorization matrix (DoD)', () => {
    const studentEndpoints: [string, string][] = [
      ['post', '/bookings'],
      ['get', '/bookings'],
      ['get', `/bookings/${UUID0}`],
      ['post', `/bookings/${UUID0}/checkout`],
      ['post', `/bookings/${UUID0}/cancel`],
      ['get', `/mock-gateway/payments/${UUID0}`],
      ['post', `/mock-gateway/payments/${UUID0}/complete`],
    ];
    const tutorEndpoints: [string, string][] = [
      ['get', '/tutor/bookings'],
      ['get', `/tutor/bookings/${UUID0}`],
      ['post', `/tutor/bookings/${UUID0}/cancel`],
    ];
    const call = (method: string, path: string, cookie?: string) =>
      (method === 'get' ? get(t.app, path, cookie) : post(t.app, path, cookie)).send({});

    it.each([...studentEndpoints, ...tutorEndpoints])('%s %s: no session -> 401', async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });

    it.each(studentEndpoints)('%s %s: tutor and admin -> 403', async (method, path) => {
      const admin = await addUser('ADMIN');
      expect((await call(method, path, tutor.cookie)).status).toBe(403);
      expect((await call(method, path, admin.cookie)).status).toBe(403);
    });

    it.each(tutorEndpoints)('%s %s: student and admin -> 403', async (method, path) => {
      const admin = await addUser('ADMIN');
      expect((await call(method, path, student.cookie)).status).toBe(403);
      expect((await call(method, path, admin.cookie)).status).toBe(403);
    });

    it('rejects writes without a matching Origin (CSRF)', async () => {
      await request(t.app.getHttpServer())
        .post(`${API}/bookings`)
        .set('Cookie', student.cookie)
        .set('X-Forwarded-For', randomIp())
        .send({ slotId: UUID0 })
        .expect(403);
    });

    it('IDOR: another student sees 404 on every booking and payment endpoint', async () => {
      const intruder = await addUser('STUDENT');
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      const bookingId = created.booking.id;
      const paymentId = created.booking.payment.id;
      await get(t.app, `/bookings/${bookingId}`, intruder.cookie).expect(404);
      await post(t.app, `/bookings/${bookingId}/checkout`, intruder.cookie).send({}).expect(404);
      await post(t.app, `/bookings/${bookingId}/cancel`, intruder.cookie).send({}).expect(404);
      await get(t.app, `/mock-gateway/payments/${paymentId}`, intruder.cookie).expect(404);
      await complete(intruder, paymentId, 'SUCCESS').expect(404);
      expect((await get(t.app, '/bookings', intruder.cookie).expect(200)).body.total).toBe(0);
      // nothing changed for the owner
      expect(await state(bookingId)).toMatchObject({ booking: 'PENDING_PAYMENT', payment: 'PENDING' });
    });

    it('IDOR: another tutor sees 404 on tutor booking endpoints; PENDING_PAYMENT is invisible to the tutor', async () => {
      const intruder = await addTutor({ name: 'Gia Su Khac' });
      const pendingId = (await bookOk(student, (await addSlot(tutor.id)).id)).booking.id;
      await get(t.app, `/tutor/bookings/${pendingId}`, tutor.cookie).expect(404);
      const id = await confirmed(student, (await addSlot(tutor.id, 72 * HOUR)).id);
      await get(t.app, `/tutor/bookings/${id}`, tutor.cookie).expect(200);
      await get(t.app, `/tutor/bookings/${id}`, intruder.cookie).expect(404);
      await post(t.app, `/tutor/bookings/${id}/cancel`, intruder.cookie).send({ reason: 'x' }).expect(404);
      expect((await get(t.app, '/tutor/bookings', intruder.cookie).expect(200)).body.total).toBe(0);
      expect(await state(id)).toMatchObject({ booking: 'CONFIRMED' });
    });

    it('malformed ids are a 400, not a 500', async () => {
      await get(t.app, '/bookings/not-a-uuid', student.cookie).expect(400);
      await get(t.app, '/mock-gateway/payments/not-a-uuid', student.cookie).expect(400);
      await get(t.app, '/tutor/bookings/not-a-uuid', tutor.cookie).expect(400);
    });
  });

  describe('POST /bookings', () => {
    it('creates PENDING_PAYMENT holding the slot for 15 minutes with a frozen price', async () => {
      const slot = await addSlot(tutor.id);
      const res = await book(student, slot.id).expect(201);
      const { booking, checkoutUrl, serverTime } = res.body;
      expect(booking).toMatchObject({
        status: 'PENDING_PAYMENT',
        priceVnd: price,
        slotId: slot.id,
        rescheduleCount: 0,
        tutor: { id: tutor.id, fullName: 'Gia Su An' },
        student: { id: student.id },
        payment: { status: 'PENDING', amountVnd: price, provider: 'mock' },
      });
      expect(booking.code).toMatch(/^#BK-\d+$/);
      expect(new Date(booking.holdExpiresAt).getTime() - new Date(serverTime).getTime()).toBe(15 * MIN);
      expect(checkoutUrl).toBe(`/cong-thanh-toan-gia-lap/${booking.payment.id}`);
      expect(booking.actions.cancel).toEqual({ allowed: true, reasonCode: null });
      expect(booking.actions.review).toEqual({ allowed: false, reasonCode: 'NOT_CONFIRMED' });
      expect(await state(booking.id)).toMatchObject({ booking: 'PENDING_PAYMENT', payment: 'PENDING', slot: 'HELD' });
      const history = await t.prisma.bookingHistory.findMany({ where: { bookingId: booking.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'PENDING_PAYMENT', actorId: student.id, actorType: 'USER' });

      // price changes afterwards do not touch the booking
      await t.prisma.tutorProfile.update({ where: { userId: tutor.id }, data: { pricePerSessionVnd: 999_000 } });
      expect((await get(t.app, `/bookings/${booking.id}`, student.cookie).expect(200)).body.priceVnd).toBe(price);
    });

    it('stores a random provider reference, never exposed to the client', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      const payment = await paymentOf(created.booking.id);
      expect(payment.providerRef).toMatch(/^mock_[0-9a-f]{32}$/);
      expect(JSON.stringify(created)).not.toContain(payment.providerRef);
    });

    it('validates input (mass assignment, bad ids)', async () => {
      const slot = await addSlot(tutor.id);
      for (const body of [{}, { slotId: 'nope' }, { slotId: slot.id, status: 'CONFIRMED' }, { slotId: slot.id, priceVnd: 1 }, { slotId: slot.id, studentId: tutor.id }]) {
        const res = await post(t.app, '/bookings', student.cookie).send(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      await book(student, slot.id, 'bad key with spaces!').expect(400);
      expect(await t.prisma.booking.count()).toBe(0);
    });

    it('404 for unknown, closed and soft-deleted slots', async () => {
      await book(student, UUID0).expect(404);
      await book(student, (await addSlot(tutor.id, 48 * HOUR, 'CLOSED')).id).expect(404);
      const deleted = await addSlot(tutor.id, 72 * HOUR);
      await t.prisma.slot.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
      await book(student, deleted.id).expect(404);
    });

    it('409 SLOT_UNAVAILABLE when held or booked, SLOT_TOO_SOON inside the lead time', async () => {
      const slot = await addSlot(tutor.id);
      await bookOk(student, slot.id);
      const other = await addUser('STUDENT');
      expect((await book(other, slot.id).expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE');

      const startAt = new Date(t.clock.now().getTime() + 30 * MIN);
      const soon = await t.prisma.slot.create({ data: { tutorId: tutor.id, startAt, endAt: new Date(startAt.getTime() + HOUR) } });
      expect((await book(other, soon.id).expect(409)).body.error.code).toBe('SLOT_TOO_SOON');
    });

    it('409 TUTOR_NOT_ACCEPTING for suspended tutors, tutors without price or locked users', async () => {
      const suspended = await addTutor({ status: 'SUSPENDED' });
      const noPrice = await addTutor({ price: null });
      const locked = await addTutor();
      await t.prisma.user.update({ where: { id: locked.id }, data: { status: 'LOCKED' } });
      for (const tt of [suspended, noPrice, locked]) {
        const res = await book(student, (await addSlot(tt.id)).id).expect(409);
        expect(res.body.error.code).toBe('TUTOR_NOT_ACCEPTING');
      }
    });

    it('409 STUDENT_OVERLAP with the conflicting booking, but adjacent hours are fine', async () => {
      const tutor2 = await addTutor({ name: 'Gia Su Binh' });
      const first = await addSlot(tutor.id);
      const created = await bookOk(student, first.id);
      const clash = await t.prisma.slot.create({
        data: { tutorId: tutor2.id, startAt: first.startAt, endAt: first.endAt },
      });
      const res = await book(student, clash.id).expect(409);
      expect(res.body.error.code).toBe('STUDENT_OVERLAP');
      expect(res.body.error.details.conflictingBooking).toMatchObject({
        id: created.booking.id,
        code: created.booking.code,
        tutorName: 'Gia Su An',
        startAt: first.startAt.toISOString(),
      });
      expect((await t.prisma.slot.findUniqueOrThrow({ where: { id: clash.id } })).status).toBe('AVAILABLE');
      const next = await t.prisma.slot.create({
        data: { tutorId: tutor2.id, startAt: first.endAt, endAt: new Date(first.endAt.getTime() + HOUR) },
      });
      await book(student, next.id).expect(201);
    });

    it('Idempotency-Key returns the same booking within the hold window, and is released after it', async () => {
      const slot = await addSlot(tutor.id);
      const a = await book(student, slot.id, 'key-1').expect(201);
      const b = await book(student, slot.id, 'key-1').expect(201);
      expect(b.body.booking.id).toBe(a.body.booking.id);
      expect(await t.prisma.booking.count()).toBe(1);
      // another student using the same key is unrelated
      const other = await addUser('STUDENT');
      const slot2 = await addSlot(tutor.id, 72 * HOUR);
      expect((await book(other, slot2.id, 'key-1').expect(201)).body.booking.id).not.toBe(a.body.booking.id);
      // after the window the key can be reused for a new booking
      t.clock.advance(16 * MIN);
      const slot3 = await addSlot(tutor.id, 96 * HOUR);
      const c = await book(student, slot3.id, 'key-1').expect(201);
      expect(c.body.booking.id).not.toBe(a.body.booking.id);
    });

    it('is throttled to 10 per minute per user', async () => {
      const slot = await addSlot(tutor.id);
      let limited = 0;
      for (let i = 0; i < 12; i += 1) {
        if ((await book(student, slot.id)).status === 429) limited += 1;
      }
      expect(limited).toBeGreaterThanOrEqual(2);
    });
  });

  describe('concurrency (architecture §3.3)', () => {
    it('20 parallel bookings of the same slot: exactly one 201, nineteen 409', async () => {
      const slot = await addSlot(tutor.id);
      const students = await Promise.all(Array.from({ length: 20 }, () => addUser('STUDENT')));
      const results = await Promise.all(students.map((s) => book(s, slot.id)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await t.prisma.booking.count({ where: { slotId: slot.id, status: 'PENDING_PAYMENT' } })).toBe(1);
      expect(await t.prisma.payment.count()).toBe(1);
      expect((await t.prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('HELD');
    });

    it('one student racing for two overlapping slots of two tutors: exactly one succeeds', async () => {
      const tutor2 = await addTutor({ name: 'Gia Su Binh' });
      const a = await addSlot(tutor.id);
      const b = await t.prisma.slot.create({ data: { tutorId: tutor2.id, startAt: a.startAt, endAt: a.endAt } });
      const results = await Promise.all([book(student, a.id), book(student, b.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('STUDENT_OVERLAP');
      expect(await t.prisma.booking.count()).toBe(1);
      // the loser's slot stayed free
      expect(await t.prisma.slot.count({ where: { status: 'HELD' } })).toBe(1);
      expect(await t.prisma.slot.count({ where: { status: 'AVAILABLE' } })).toBe(1);
    });

    it('parallel Idempotency-Key requests create one booking', async () => {
      const slot = await addSlot(tutor.id);
      const results = await Promise.all(Array.from({ length: 6 }, () => book(student, slot.id, 'same-key')));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.booking.id)).size).toBe(1);
      expect(await t.prisma.booking.count()).toBe(1);
    });
  });

  describe('mock gateway (S-08) and signed webhook', () => {
    it('GET shows booking code, amount and completable; no-store headers', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      const res = await get(t.app, `/mock-gateway/payments/${created.booking.payment.id}`, student.cookie).expect(200);
      expect(res.body).toEqual({
        paymentId: created.booking.payment.id,
        bookingId: created.booking.id,
        bookingCode: created.booking.code,
        amountVnd: price,
        status: 'PENDING',
        holdExpired: false,
        completable: true,
      });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('SUCCESS -> signed webhook over HTTP -> CONFIRMED, PAID, slot BOOKED, mails queued', async () => {
      const slot = await addSlot(tutor.id);
      const created = await bookOk(student, slot.id);
      const res = await complete(student, created.booking.payment.id, 'SUCCESS').expect(200);
      expect(res.body).toEqual({ redirectUrl: `/thanh-toan/${created.booking.id}/ket-qua` });
      expect(res.headers['cache-control']).toBe('no-store');

      expect(await state(created.booking.id)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID', slot: 'BOOKED' });
      const booking = (await get(t.app, `/bookings/${created.booking.id}`, student.cookie).expect(200)).body;
      expect(booking).toMatchObject({ status: 'CONFIRMED', holdExpiresAt: null, payment: { status: 'PAID' } });
      expect(booking.actions.cancel.allowed).toBe(true);
      const events = await t.prisma.paymentEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ provider: 'mock', outcome: 'SUCCEEDED', rejectedReason: null });
      expect(JSON.stringify(events[0].payload)).not.toContain((await paymentOf(created.booking.id)).providerRef);
      const mails = await t.prisma.emailOutbox.findMany({ orderBy: { template: 'asc' } });
      expect(mails.map((m) => [m.template, m.toEmail])).toEqual([
        ['booking_confirmed_student', student.email],
        ['booking_confirmed_tutor', tutor.email],
      ]);
      const history = await t.prisma.bookingHistory.findMany({ where: { bookingId: created.booking.id }, orderBy: { id: 'asc' } });
      expect(history.map((h) => h.toStatus)).toEqual(['PENDING_PAYMENT', 'CONFIRMED']);
    });

    it('FAILURE -> EXPIRED, payment FAILED(DECLINED), slot released and bookable again', async () => {
      const slot = await addSlot(tutor.id);
      const created = await bookOk(student, slot.id);
      await complete(student, created.booking.payment.id, 'FAILURE').expect(200);
      expect(await state(created.booking.id)).toEqual({ booking: 'EXPIRED', payment: 'FAILED', reason: 'DECLINED', slot: 'AVAILABLE' });
      expect(await t.prisma.emailOutbox.count()).toBe(0);
      await book(await addUser('STUDENT'), slot.id).expect(201);
    });

    it('the gateway completes a payment only once', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      await complete(student, created.booking.payment.id, 'SUCCESS').expect(200);
      const again = await complete(student, created.booking.payment.id, 'SUCCESS').expect(409);
      expect(again.body.error.code).toBe('GATEWAY_ALREADY_COMPLETED');
      const flipped = await complete(student, created.booking.payment.id, 'FAILURE').expect(409);
      expect(flipped.body.error.code).toBe('GATEWAY_ALREADY_COMPLETED');
      expect(await state(created.booking.id)).toMatchObject({ booking: 'CONFIRMED' });
      const view = await get(t.app, `/mock-gateway/payments/${created.booking.payment.id}`, student.cookie).expect(200);
      expect(view.body.completable).toBe(false);
    });

    it('double click: parallel completes dispatch exactly one webhook', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      const results = await Promise.all(Array.from({ length: 5 }, () => complete(student, created.booking.payment.id, 'SUCCESS')));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await t.prisma.paymentEvent.count()).toBe(1);
    });

    it('rejects completion of a payment that is no longer payable (cancelled hold)', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      await post(t.app, `/bookings/${created.booking.id}/cancel`, student.cookie).send({}).expect(200);
      const res = await complete(student, created.booking.payment.id, 'SUCCESS').expect(409);
      expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    });

    it('late success after expiry: booking stays EXPIRED, money auto-refunded, audit-logged (AC8)', async () => {
      const slot = await addSlot(tutor.id);
      const created = await bookOk(student, slot.id);
      t.clock.advance(15 * MIN + 1000);
      const view = await get(t.app, `/mock-gateway/payments/${created.booking.payment.id}`, student.cookie).expect(200);
      expect(view.body).toMatchObject({ holdExpired: true, completable: true });
      await complete(student, created.booking.payment.id, 'SUCCESS').expect(200);

      expect(await state(created.booking.id)).toEqual({ booking: 'EXPIRED', payment: 'REFUNDED', reason: null, slot: 'AVAILABLE' });
      const payment = await paymentOf(created.booking.id);
      expect(payment.paidAt).not.toBeNull();
      expect(payment.refundedAt).not.toBeNull();
      expect(payment.refundRef).toMatch(/^mock_refund_/);
      const audit = await t.prisma.auditLog.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'LATE_PAYMENT_AUTO_REFUND', entityType: 'payment', entityId: payment.id });
      expect(await t.prisma.emailOutbox.count()).toBe(0);
      // result page data
      const b = (await get(t.app, `/bookings/${created.booking.id}`, student.cookie).expect(200)).body;
      expect(b).toMatchObject({ status: 'EXPIRED', payment: { status: 'REFUNDED' } });
      // and it is single-use
      expect((await complete(student, created.booking.payment.id, 'SUCCESS').expect(409)).body.error.code).toBe('GATEWAY_ALREADY_COMPLETED');
    });

    it('late failure after expiry just records the outcome', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      t.clock.advance(20 * MIN);
      await complete(student, created.booking.payment.id, 'FAILURE').expect(200);
      expect(await state(created.booking.id)).toEqual({ booking: 'EXPIRED', payment: 'FAILED', reason: 'HOLD_EXPIRED', slot: 'AVAILABLE' });
      expect(await t.prisma.auditLog.count()).toBe(0);
    });

    it('a slot freed by a lapsed hold is not re-bookable until it lapses, and then immediately (lazy expiry, job not run)', async () => {
      const slot = await addSlot(tutor.id);
      await bookOk(student, slot.id);
      const other = await addUser('STUDENT');
      await book(other, slot.id).expect(409);
      t.clock.advance(15 * MIN);
      await book(other, slot.id).expect(201);
    });

    it('MOCK_GATEWAY_ENABLED=false: every /mock-gateway route is 404, even without a session', async () => {
      const off = await createTestApp({ env: { MOCK_GATEWAY_ENABLED: 'false' } });
      try {
        await get(off.app, `/mock-gateway/payments/${UUID0}`).expect(404);
        await post(off.app, `/mock-gateway/payments/${UUID0}/complete`).send({ result: 'SUCCESS' }).expect(404);
        const res = await get(off.app, '/config/public').expect(200);
        expect(res.body.mockGatewayEnabled).toBe(false);
      } finally {
        await off.close();
      }
    });

    it('/config/public exposes the business rules', async () => {
      const res = await get(t.app, '/config/public').expect(200);
      expect(res.body).toEqual({
        cancellationWindowHours: 24,
        holdMinutes: 15,
        slotDurationMinutes: 60,
        minBookingLeadMinutes: 60,
        timezone: 'Asia/Ho_Chi_Minh',
        mockGatewayEnabled: true,
      });
    });

    it('resume checkout: URL again while payable, 409 afterwards', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      const res = await post(t.app, `/bookings/${created.booking.id}/checkout`, student.cookie).send({}).expect(200);
      expect(res.body.checkoutUrl).toBe(created.checkoutUrl);
      expect(res.body.booking.id).toBe(created.booking.id);
      t.clock.advance(15 * MIN);
      const late = await post(t.app, `/bookings/${created.booking.id}/checkout`, student.cookie).send({}).expect(409);
      expect(late.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    });
  });

  describe('webhook endpoint', () => {
    let bookingId: string;
    let ref: string;

    beforeEach(async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      bookingId = created.booking.id;
      ref = (await paymentOf(bookingId)).providerRef;
    });

    const expectUntouched = async () => {
      expect(await state(bookingId)).toMatchObject({ booking: 'PENDING_PAYMENT', payment: 'PENDING', slot: 'HELD' });
    };

    it('applies a correctly signed SUCCEEDED event', async () => {
      const res = await hook(event(ref, 'SUCCEEDED')).expect(200);
      expect(res.body).toEqual({ status: 'applied' });
      expect(await state(bookingId)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID', slot: 'BOOKED' });
    });

    it('wrong signature -> 401 INVALID_SIGNATURE, nothing stored, nothing changed', async () => {
      const body = event(ref, 'SUCCEEDED');
      const attempts = [
        hook(body, { secret: 'x'.repeat(40) }),
        hook(body, { signature: null }),
        hook(body, { signature: 't=1700000000,v1=' + 'a'.repeat(64) }),
        hook(body, { signature: 'garbage' }),
        hook(body, { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` }),
      ];
      for (const attempt of attempts) {
        const res = await attempt.expect(401);
        expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      }
      expect(await t.prisma.paymentEvent.count()).toBe(0);
      await expectUntouched();
    });

    it('body altered after signing -> 401', async () => {
      const signed = event(ref, 'FAILED');
      const raw = JSON.stringify(signed);
      const signature = signMockWebhook(WEBHOOK_SECRET(), t.clock.now(), Buffer.from(raw));
      await hook(JSON.stringify({ ...signed, outcome: 'SUCCEEDED' }), { signature }).expect(401);
      await expectUntouched();
    });

    it('stale or future timestamp (> 300 s) -> 401, within 300 s accepted', async () => {
      const old = new Date(t.clock.now().getTime() - 301_000);
      await hook(event(ref, 'SUCCEEDED'), { at: old }).expect(401);
      await hook(event(ref, 'SUCCEEDED'), { at: new Date(t.clock.now().getTime() + 301_000) }).expect(401);
      await expectUntouched();
      await hook(event(ref, 'SUCCEEDED'), { at: new Date(t.clock.now().getTime() - 299_000) }).expect(200);
    });

    it('signed but malformed body -> 400; body over 4 KB -> 413', async () => {
      await hook({ eventId: 'evt_nope', providerRef: ref }).expect(400);
      await hook({ ...event(ref, 'SUCCEEDED'), extra: 1 }).expect(400);
      await hook('{not json').expect(400);
      await hook(JSON.stringify({ ...event(ref, 'SUCCEEDED'), pad: 'x'.repeat(5000) })).expect(413);
      await expectUntouched();
    });

    it('amount mismatch -> 400 AMOUNT_MISMATCH, recorded, state unchanged', async () => {
      const bad = event(ref, 'SUCCEEDED', price - 1);
      const res = await hook(bad).expect(400);
      expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
      await expectUntouched();
      const stored = await t.prisma.paymentEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: 'mock', eventId: bad.eventId } } });
      expect(stored.rejectedReason).toBe('AMOUNT_MISMATCH');
    });

    it('unknown provider reference -> 400 UNKNOWN_PAYMENT', async () => {
      const res = await hook(event('mock_' + 'f'.repeat(32), 'SUCCEEDED')).expect(400);
      expect(res.body.error.code).toBe('UNKNOWN_PAYMENT');
      await expectUntouched();
    });

    it('duplicate event id is a no-op 200', async () => {
      const body = event(ref, 'SUCCEEDED');
      expect((await hook(body).expect(200)).body).toEqual({ status: 'applied' });
      expect((await hook(body).expect(200)).body).toEqual({ status: 'duplicate' });
      expect(await t.prisma.paymentEvent.count()).toBe(1);
      expect(await t.prisma.emailOutbox.count()).toBe(2);
    });

    it('a new event on a CONFIRMED booking changes nothing (AC9)', async () => {
      await hook(event(ref, 'SUCCEEDED')).expect(200);
      await hook(event(ref, 'SUCCEEDED')).expect(200);
      const failed = event(ref, 'FAILED');
      await hook(failed).expect(200);
      expect(await state(bookingId)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID', slot: 'BOOKED' });
      const stored = await t.prisma.paymentEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: 'mock', eventId: failed.eventId } } });
      expect(stored.rejectedReason).toBe('OUT_OF_ORDER');
      expect(await t.prisma.emailOutbox.count()).toBe(2);
      expect(await t.prisma.bookingHistory.count({ where: { toStatus: 'CONFIRMED' } })).toBe(1);
    });

    it('20 parallel deliveries of the same event apply it once', async () => {
      const body = event(ref, 'SUCCEEDED');
      const results = await Promise.all(Array.from({ length: 20 }, () => hook(body)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.status === 'applied')).toHaveLength(1);
      expect(results.filter((r) => r.body.status === 'duplicate')).toHaveLength(19);
      expect(await t.prisma.paymentEvent.count()).toBe(1);
      expect(await t.prisma.emailOutbox.count()).toBe(2);
      expect(await state(bookingId)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID' });
    });

    it('20 parallel DIFFERENT success events for one payment confirm once', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => hook(event(ref, 'SUCCEEDED'))));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await t.prisma.emailOutbox.count()).toBe(2);
      expect(await t.prisma.bookingHistory.count({ where: { toStatus: 'CONFIRMED' } })).toBe(1);
    });

    it('FAILED(DECLINED) then SUCCEEDED: money is taken late and refunded automatically', async () => {
      await hook(event(ref, 'FAILED')).expect(200);
      expect(await state(bookingId)).toEqual({ booking: 'EXPIRED', payment: 'FAILED', reason: 'DECLINED', slot: 'AVAILABLE' });
      await hook(event(ref, 'SUCCEEDED')).expect(200);
      expect(await state(bookingId)).toEqual({ booking: 'EXPIRED', payment: 'REFUNDED', reason: null, slot: 'AVAILABLE' });
      expect(await t.prisma.auditLog.count({ where: { action: 'LATE_PAYMENT_AUTO_REFUND' } })).toBe(1);
    });

    it('SUCCEEDED after the deadline (clock passed hold) takes the late-payment path', async () => {
      t.clock.advance(15 * MIN);
      await hook(event(ref, 'SUCCEEDED')).expect(200);
      expect(await state(bookingId)).toEqual({ booking: 'EXPIRED', payment: 'REFUNDED', reason: null, slot: 'AVAILABLE' });
      expect(await t.prisma.auditLog.count({ where: { action: 'LATE_PAYMENT_AUTO_REFUND' } })).toBe(1);
      // replaying with a fresh event id does not refund twice
      await hook(event(ref, 'SUCCEEDED')).expect(200);
      expect(await t.prisma.auditLog.count()).toBe(1);
    });

    it('late payment whose refund fails keeps PAID + refund_failed for Admin', async () => {
      const provider = t.app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(provider, 'refund').mockRejectedValueOnce(new Error('gateway down'));
      try {
        t.clock.advance(15 * MIN);
        await hook(event(ref, 'SUCCEEDED')).expect(200);
      } finally {
        spy.mockRestore();
      }
      const payment = await paymentOf(bookingId);
      expect(payment).toMatchObject({ status: 'PAID', refundFailed: true });
      expect(await state(bookingId)).toMatchObject({ booking: 'EXPIRED' });
    });
  });

  describe('expiry job (US-SYS-02)', () => {
    let job: BookingExpiryService;
    beforeAll(() => {
      job = t.app.get(BookingExpiryService);
    });

    it('does nothing before the deadline and releases holds at 15 minutes', async () => {
      const slot = await addSlot(tutor.id);
      const created = await bookOk(student, slot.id);
      t.clock.advance(15 * MIN - 1);
      expect(await job.runOnce()).toBe(0);
      expect(await state(created.booking.id)).toMatchObject({ booking: 'PENDING_PAYMENT', slot: 'HELD' });
      t.clock.advance(1);
      expect(await job.runOnce()).toBe(1);
      expect(await state(created.booking.id)).toEqual({ booking: 'EXPIRED', payment: 'FAILED', reason: 'HOLD_EXPIRED', slot: 'AVAILABLE' });
      const history = await t.prisma.bookingHistory.findMany({ where: { bookingId: created.booking.id }, orderBy: { id: 'asc' } });
      expect(history[1]).toMatchObject({ toStatus: 'EXPIRED', actorType: 'SYSTEM', note: 'HOLD_EXPIRED' });
      expect(await job.runOnce()).toBe(0);
    });

    it('leaves confirmed bookings alone and handles more than one booking per sweep', async () => {
      const keep = await confirmed(student, (await addSlot(tutor.id)).id);
      const others = await Promise.all(Array.from({ length: 3 }, () => addUser('STUDENT')));
      const ids: string[] = [];
      for (const [i, s] of others.entries()) ids.push((await bookOk(s, (await addSlot(tutor.id, (72 + i * 2) * HOUR)).id)).booking.id);
      t.clock.advance(16 * MIN);
      expect(await job.runOnce()).toBe(3);
      expect(await state(keep)).toMatchObject({ booking: 'CONFIRMED' });
      for (const id of ids) expect(await state(id)).toMatchObject({ booking: 'EXPIRED', slot: 'AVAILABLE' });
    });

    it('a booking locked by another transaction is skipped, not waited for (SKIP LOCKED)', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      t.clock.advance(16 * MIN);
      let released!: () => void;
      const gate = new Promise<void>((resolve) => (released = resolve));
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => (locked = resolve));
      const holder = t.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${created.booking.id}::uuid FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 20_000 },
      );
      await hasLock;
      expect(await job.runOnce()).toBe(0);
      released();
      await holder;
      expect(await job.runOnce()).toBe(1);
    });

    it('lazy expiry: reads settle an overdue hold even though the job never ran', async () => {
      const created = await bookOk(student, (await addSlot(tutor.id)).id);
      t.clock.advance(15 * MIN);
      const res = await get(t.app, `/bookings/${created.booking.id}`, student.cookie).expect(200);
      expect(res.body.status).toBe('EXPIRED');
      expect(res.body.payment).toMatchObject({ status: 'FAILED', failureReason: 'HOLD_EXPIRED' });
      expect(await state(created.booking.id)).toMatchObject({ slot: 'AVAILABLE' });
    });

    it('lazy expiry in lists puts the lapsed hold under cancelled/expired', async () => {
      await bookOk(student, (await addSlot(tutor.id)).id);
      t.clock.advance(15 * MIN);
      expect((await get(t.app, '/bookings?scope=upcoming', student.cookie).expect(200)).body.total).toBe(0);
      const expired = (await get(t.app, '/bookings?scope=cancelled', student.cookie).expect(200)).body;
      expect(expired.items.map((b: { status: string }) => b.status)).toEqual(['EXPIRED']);
    });
  });

  describe('race: webhook vs expiry job (§2.3)', () => {
    let job: BookingExpiryService;
    beforeAll(() => {
      job = t.app.get(BookingExpiryService);
    });

    it.each(['SUCCEEDED', 'FAILED'] as const)('%s at the deadline, job and webhook concurrently: never CONFIRMED after EXPIRED', async (outcome) => {
      for (let i = 0; i < 6; i += 1) {
        await resetDb(t.prisma);
        t.clock.set(new Date());
        tutor = await addTutor();
        student = await addUser('STUDENT');
        const created = await bookOk(student, (await addSlot(tutor.id)).id);
        const ref = (await paymentOf(created.booking.id)).providerRef;
        t.clock.advance(15 * MIN);
        const work = [() => job.runOnce(), () => hook(event(ref, outcome)).then((r) => r.status)];
        if (i % 2) work.reverse();
        const results = await Promise.all(work.map((fn) => fn()));
        expect(results).toContain(200);
        const s = await state(created.booking.id);
        expect(s.booking).toBe('EXPIRED');
        expect(s.slot).toBe('AVAILABLE');
        expect(s.payment).toBe(outcome === 'SUCCEEDED' ? 'REFUNDED' : 'FAILED');
        expect(await t.prisma.bookingHistory.count({ where: { bookingId: created.booking.id, toStatus: 'EXPIRED' } })).toBe(1);
        expect(await t.prisma.bookingHistory.count({ where: { bookingId: created.booking.id, toStatus: 'CONFIRMED' } })).toBe(0);
      }
    });

    it('webhook just before the deadline wins over a concurrent job: CONFIRMED stays CONFIRMED', async () => {
      for (let i = 0; i < 4; i += 1) {
        await resetDb(t.prisma);
        t.clock.set(new Date());
        tutor = await addTutor();
        student = await addUser('STUDENT');
        const created = await bookOk(student, (await addSlot(tutor.id)).id);
        const ref = (await paymentOf(created.booking.id)).providerRef;
        t.clock.advance(15 * MIN - 1000);
        await Promise.all([job.runOnce(), hook(event(ref, 'SUCCEEDED')).expect(200)]);
        t.clock.advance(2000); // now past the deadline; a confirmed booking has no hold any more
        expect(await job.runOnce()).toBe(0);
        expect(await state(created.booking.id)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID', slot: 'BOOKED' });
      }
    });

    it('cancel (student drops the hold) racing with the webhook ends consistent', async () => {
      for (let i = 0; i < 4; i += 1) {
        await resetDb(t.prisma);
        t.clock.set(new Date());
        tutor = await addTutor();
        student = await addUser('STUDENT');
        const created = await bookOk(student, (await addSlot(tutor.id)).id);
        const ref = (await paymentOf(created.booking.id)).providerRef;
        const [cancel] = await Promise.all([
          post(t.app, `/bookings/${created.booking.id}/cancel`, student.cookie).send({}),
          hook(event(ref, 'SUCCEEDED')),
        ]);
        const s = await state(created.booking.id);
        if (s.booking === 'CONFIRMED') {
          expect(cancel.status).toBe(409); // webhook won: a CONFIRMED booking inside... 48h out can still be cancelled
        }
        expect(['CONFIRMED', 'EXPIRED', 'CANCELLED_BY_STUDENT']).toContain(s.booking);
        if (s.booking === 'EXPIRED') {
          expect(s.slot).toBe('AVAILABLE');
          // webhook landed after the cancel: the money must have been refunded, never left PAID/FAILED
          expect(s.payment).toBe('REFUNDED');
        }
        if (s.booking === 'CONFIRMED') expect(s.slot).toBe('BOOKED');
      }
    });
  });

  describe('cancel + refund', () => {
    it('student drops an unpaid hold: EXPIRED, slot released, nothing to refund', async () => {
      const slot = await addSlot(tutor.id);
      const created = await bookOk(student, slot.id);
      const res = await post(t.app, `/bookings/${created.booking.id}/cancel`, student.cookie).send({}).expect(200);
      expect(res.body).toMatchObject({ status: 'EXPIRED', payment: { status: 'FAILED', failureReason: 'CANCELLED_BY_STUDENT' } });
      expect(await state(created.booking.id)).toMatchObject({ slot: 'AVAILABLE' });
      await post(t.app, `/bookings/${created.booking.id}/cancel`, student.cookie).send({}).expect(409);
    });

    it('student cancels a CONFIRMED booking >= 24h ahead: 100% refund, slot AVAILABLE, reason kept', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id, 48 * HOUR)).id);
      await t.prisma.emailOutbox.deleteMany();
      const res = await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({ reason: 'Bận việc' }).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED_BY_STUDENT', cancelReason: 'Bận việc', payment: { status: 'REFUNDED' } });
      expect(res.body.payment.refundedAt).not.toBeNull();
      expect(await state(id)).toMatchObject({ booking: 'CANCELLED_BY_STUDENT', payment: 'REFUNDED', slot: 'AVAILABLE' });
      expect((await t.prisma.emailOutbox.findMany()).map((m) => m.template).sort()).toEqual([
        'booking_cancelled_student',
        'booking_cancelled_tutor',
      ]);
      // slot can be booked again
      await book(await addUser('STUDENT'), (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).slotId).expect(201);
    });

    it('24h boundary with the fake clock: exactly 24h allowed, 24h - 1s refused', async () => {
      const slot = await addSlot(tutor.id, 48 * HOUR);
      const id = await confirmed(student, slot.id);
      const detail = (await get(t.app, `/bookings/${id}`, student.cookie).expect(200)).body;
      expect(detail.cancelDeadline).toBe(new Date(slot.startAt.getTime() - 24 * HOUR).toISOString());

      await jump(new Date(slot.startAt.getTime() - 24 * HOUR + 1000));
      const flags = (await get(t.app, `/bookings/${id}`, student.cookie).expect(200)).body.actions;
      expect(flags.cancel).toEqual({ allowed: false, reasonCode: 'WINDOW_PASSED' });
      const denied = await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({}).expect(409);
      expect(denied.body.error.code).toBe('WINDOW_PASSED');
      expect(await state(id)).toMatchObject({ booking: 'CONFIRMED', payment: 'PAID', slot: 'BOOKED' });

      await jump(new Date(slot.startAt.getTime() - 24 * HOUR));
      await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({}).expect(200);
      expect(await state(id)).toMatchObject({ booking: 'CANCELLED_BY_STUDENT', payment: 'REFUNDED' });
    });

    it('student cannot cancel once the session started', async () => {
      const slot = await addSlot(tutor.id, 48 * HOUR);
      const id = await confirmed(student, slot.id);
      await jump(new Date(slot.startAt.getTime() + 1));
      const res = await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({}).expect(409);
      expect(res.body.error.code).toBe('SESSION_STARTED');
    });

    it('a failing refund leaves PAID + refund_failed but the booking is still cancelled (US-ADM-04 AC2)', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id)).id);
      const provider = t.app.get<PaymentProvider>(PAYMENT_PROVIDER);
      const spy = jest.spyOn(provider, 'refund').mockRejectedValueOnce(new Error('gateway down'));
      try {
        const res = await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({}).expect(200);
        expect(res.body).toMatchObject({ status: 'CANCELLED_BY_STUDENT', payment: { status: 'PAID', refundFailed: true } });
      } finally {
        spy.mockRestore();
      }
    });

    it('tutor cancels any time before the session (inside 24h too): refund, slot CLOSED, reason required', async () => {
      const slot = await addSlot(tutor.id, 48 * HOUR);
      const id = await confirmed(student, slot.id);
      await jump(new Date(slot.startAt.getTime() - 2 * HOUR));

      const noReason = await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({}).expect(400);
      expect(noReason.body.error.code).toBe('VALIDATION_FAILED');
      await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({ reason: '' }).expect(400);

      const res = await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({ reason: 'Ốm đột xuất' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED_BY_TUTOR',
        cancelledByRole: 'TUTOR',
        tutorCancelReason: 'Ốm đột xuất',
        actions: { cancel: { allowed: false, reasonCode: 'NOT_CONFIRMED' } },
      });
      expect(await state(id)).toMatchObject({ booking: 'CANCELLED_BY_TUTOR', payment: 'REFUNDED', slot: 'CLOSED' });
      // the student sees the tutor's reason and the refund
      const view = (await get(t.app, `/bookings/${id}`, student.cookie).expect(200)).body;
      expect(view).toMatchObject({ status: 'CANCELLED_BY_TUTOR', cancelReason: 'Ốm đột xuất', payment: { status: 'REFUNDED' } });
      await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({ reason: 'again' }).expect(409);
    });

    it('tutor cannot cancel after the session started', async () => {
      const slot = await addSlot(tutor.id, 48 * HOUR);
      const id = await confirmed(student, slot.id);
      await jump(slot.startAt);
      const res = await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({ reason: 'late' }).expect(409);
      expect(res.body.error.code).toBe('SESSION_STARTED');
    });

    it('rejects unknown fields and a reason over 500 characters', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id)).id);
      await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({ status: 'EXPIRED' }).expect(400);
      await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({ reason: 'x'.repeat(501) }).expect(400);
      await post(t.app, `/tutor/bookings/${id}/cancel`, tutor.cookie).send({ reason: 'ok', refund: false }).expect(400);
      expect(await state(id)).toMatchObject({ booking: 'CONFIRMED' });
    });
  });

  describe('role-specific DTOs (A1)', () => {
    it('student booking exposes an allow-list and never the provider reference', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id)).id);
      const body = (await get(t.app, `/bookings/${id}`, student.cookie).expect(200)).body;
      expect(Object.keys(body).sort()).toEqual(
        [
          'actions', 'cancelDeadline', 'cancelReason', 'cancelledAt', 'code', 'createdAt', 'endAt', 'holdExpiresAt', 'id',
          'isFinished', 'payment', 'priceVnd', 'rescheduleCount', 'review', 'serverTime', 'slotId', 'startAt', 'status',
          'student', 'tutor',
        ].sort(),
      );
      expect(Object.keys(body.payment).sort()).toEqual(
        ['amountVnd', 'failureReason', 'id', 'paidAt', 'provider', 'refundFailed', 'refundedAt', 'status'].sort(),
      );
      expect(Object.keys(body.tutor).sort()).toEqual(['fullName', 'id']);
      const text = JSON.stringify(body);
      expect(text).not.toContain((await paymentOf(id)).providerRef);
      expect(text).not.toContain(tutor.email);
    });

    it('tutor booking shows student name, time, price, status only', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id)).id);
      const body = (await get(t.app, `/tutor/bookings/${id}`, tutor.cookie).expect(200)).body;
      expect(Object.keys(body).sort()).toEqual(
        ['actions', 'cancelledAt', 'cancelledByRole', 'code', 'endAt', 'id', 'isFinished', 'priceVnd', 'startAt', 'status', 'student', 'tutorCancelReason'].sort(),
      );
      expect(body.student).toEqual({ fullName: 'Hoc Vien Binh' });
      const text = JSON.stringify(body);
      for (const secret of [student.email, student.id, 'payment', 'holdExpiresAt', (await paymentOf(id)).providerRef]) {
        expect(text).not.toContain(secret);
      }
    });

    it('a student cancel reason never reaches the tutor', async () => {
      const id = await confirmed(student, (await addSlot(tutor.id)).id);
      await post(t.app, `/bookings/${id}/cancel`, student.cookie).send({ reason: 'ly do rieng tu' }).expect(200);
      const body = (await get(t.app, `/tutor/bookings/${id}`, tutor.cookie).expect(200)).body;
      expect(body).toMatchObject({ status: 'CANCELLED_BY_STUDENT', cancelledByRole: 'STUDENT', tutorCancelReason: null });
      expect(JSON.stringify(body)).not.toContain('ly do rieng tu');
    });
  });

  describe('lists', () => {
    it('student scopes: upcoming (pending + confirmed ahead), past (finished), cancelled (cancelled + expired)', async () => {
      const tutor2 = await addTutor({ name: 'Gia Su Hai' });
      const upcomingId = await confirmed(student, (await addSlot(tutor.id, 72 * HOUR)).id);
      const pendingId = (await bookOk(student, (await addSlot(tutor2.id, 96 * HOUR)).id)).booking.id;
      const cancelledId = await confirmed(student, (await addSlot(tutor.id, 120 * HOUR)).id);
      await post(t.app, `/bookings/${cancelledId}/cancel`, student.cookie).send({}).expect(200);
      const failedId = (await bookOk(student, (await addSlot(tutor2.id, 144 * HOUR)).id)).booking.id;
      await complete(student, (await paymentOf(failedId)).id, 'FAILURE').expect(200);
      const soon = await addSlot(tutor.id, 3 * HOUR);
      const pastId = await confirmed(student, soon.id);
      t.clock.set(new Date(soon.endAt.getTime())); // session over; the other slots are still ahead

      const ids = async (scope: string) =>
        (await get(t.app, `/bookings?scope=${scope}`, student.cookie).expect(200)).body.items.map((b: { id: string }) => b.id);
      // the 15-minute holds of pendingId / failedId lapsed while the clock jumped; both sit under "cancelled"
      expect(await ids('upcoming')).toEqual([upcomingId]);
      expect(await ids('past')).toEqual([pastId]);
      expect((await ids('cancelled')).sort()).toEqual([pendingId, cancelledId, failedId].sort());
      const past = (await get(t.app, '/bookings?scope=past', student.cookie).expect(200)).body.items[0];
      expect(past.isFinished).toBe(true);
      expect(past.actions.review).toEqual({ allowed: true, reasonCode: null });
    });

    it('paginates and validates query input', async () => {
      for (let i = 0; i < 3; i += 1) await confirmed(student, (await addSlot(tutor.id, (72 + i * 2) * HOUR)).id);
      const page = (await get(t.app, '/bookings?pageSize=2&page=2', student.cookie).expect(200)).body;
      expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(page.items).toHaveLength(1);
      for (const q of ['scope=all', 'page=0', 'pageSize=101', 'pageSize=x']) await get(t.app, `/bookings?${q}`, student.cookie).expect(400);
      for (const q of ['scope=all', 'page=0']) await get(t.app, `/tutor/bookings?${q}`, tutor.cookie).expect(400);
    });

    it('tutor lists only confirmed/cancelled bookings of their own', async () => {
      const other = await addTutor({ name: 'Khac' });
      const mine = await confirmed(student, (await addSlot(tutor.id, 72 * HOUR)).id);
      await confirmed(student, (await addSlot(other.id, 100 * HOUR)).id);
      await bookOk(await addUser('STUDENT'), (await addSlot(tutor.id, 120 * HOUR)).id); // PENDING_PAYMENT: hidden
      const res = (await get(t.app, '/tutor/bookings', tutor.cookie).expect(200)).body;
      expect(res.items.map((b: { id: string }) => b.id)).toEqual([mine]);
      expect(res.items[0].student).toEqual({ fullName: 'Hoc Vien Binh' });
    });
  });
});
