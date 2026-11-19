import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BookingStateMachine } from '../src/bookings/booking-state-machine';
import { platformFee } from '../src/earnings/earnings.calc';
import { EarningsService } from '../src/earnings/earnings.service';
import { fixtures, HOUR, User, UUID0 } from './fixtures';
import { API, createTestApp, get, ORIGIN, resetDb, TestApp } from './helpers';

/** 2026-06-15 12:00 in Asia/Ho_Chi_Minh. */
const NOW = new Date('2026-06-15T05:00:00Z');

describe('tutor earnings (QUA-54)', () => {
  let t: TestApp;
  let f: ReturnType<typeof fixtures>;
  let admin: User;
  let student: User;
  let tutor: User;

  const put = (path: string, cookie?: string) => {
    const req = request(t.app.getHttpServer()).put(`${API}${path}`).set('Origin', ORIGIN);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const settle = (who: User | undefined, tutorId: string, month: string) => put(`/admin/tutors/${tutorId}/earnings/${month}/settlement`, who?.cookie);
  const summary = (query = '', who: User = tutor) => get(t.app, `/tutor/earnings${query}`, who.cookie);
  const items = (query = '', who: User = tutor) => get(t.app, `/tutor/earnings/items${query}`, who.cookie);

  /** A session of `tutor` ending at `endAt` (1h long), with the fee snapshot a CONFIRMED booking would carry. */
  const session = async (
    endAt: string,
    priceVnd: number,
    opts: {
      status?: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED_BY_STUDENT' | 'CANCELLED_BY_TUTOR';
      payment?: 'PENDING' | 'PAID' | 'REFUNDED';
      feeBp?: number | null;
      settledAt?: Date;
      refundedAt?: Date;
      tutorId?: string;
      cancelReason?: string;
    } = {},
  ) => {
    const tutorId = opts.tutorId ?? tutor.id;
    const end = new Date(endAt);
    const start = new Date(end.getTime() - HOUR);
    const slot = await t.prisma.slot.create({ data: { tutorId, startAt: start, endAt: end, status: 'BOOKED' } });
    const feeBp = opts.feeBp === undefined ? 1000 : opts.feeBp;
    return t.prisma.booking.create({
      data: {
        studentId: student.id,
        tutorId,
        slotId: slot.id,
        startAt: start,
        endAt: end,
        priceVnd,
        status: opts.status ?? 'CONFIRMED',
        cancelReason: opts.cancelReason,
        payment: {
          create: {
            provider: 'mock',
            providerRef: `test:${randomUUID()}`,
            amountVnd: priceVnd,
            status: opts.payment ?? 'PAID',
            paidAt: (opts.payment ?? 'PAID') === 'PENDING' ? null : NOW,
            feeRate: feeBp === null ? null : feeBp / 10_000,
            platformFeeVnd: feeBp === null ? null : platformFee(priceVnd, feeBp),
            settledAt: opts.settledAt,
            refundedAt: opts.refundedAt,
          },
        },
      },
      include: { payment: true },
    });
  };

  beforeAll(async () => {
    t = await createTestApp();
    f = fixtures(t);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.prisma);
    t.clock.set(NOW);
    admin = await f.addUser('ADMIN', 'Quan Tri');
    student = await f.addUser('STUDENT', 'Nguyen Van An');
    tutor = await f.addTutor();
  });

  describe('authorization and input', () => {
    it('401 without a session, 403 for student and admin, on both endpoints', async () => {
      for (const path of ['/tutor/earnings', '/tutor/earnings/items']) {
        expect((await get(t.app, path)).status).toBe(401);
        expect((await get(t.app, path, student.cookie)).status).toBe(403);
        expect((await get(t.app, path, admin.cookie)).status).toBe(403);
      }
    });

    it('settlement is ADMIN only', async () => {
      expect((await settle(undefined, tutor.id, '2026-05')).status).toBe(401);
      expect((await settle(tutor, tutor.id, '2026-05')).status).toBe(403);
      expect((await settle(student, tutor.id, '2026-05')).status).toBe(403);
    });

    it('a tutor that is not approved can still read (empty) earnings', async () => {
      const pending = await f.addTutor({ status: 'PENDING_APPROVAL' });
      const res = await summary('', pending);
      expect(res.status).toBe(200);
      expect(res.body.isEmpty).toBe(true);
    });

    it.each([
      ['unknown param', '?tutorId=' + UUID0],
      ['malformed month', '?month=2026-6'],
      ['month 13', '?month=2026-13'],
      ['future month', '?month=2026-07'],
      ['older than 24 months', '?month=2024-06'],
    ])('summary: %s -> 400', async (_n, q) => {
      const res = await summary(q);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect((await items(q)).status).toBe(400);
    });

    it.each([
      ['bad sort', '?sort=priceVnd:desc'],
      ['bad settlement', '?settlement=maybe'],
      ['pageSize over 100', '?pageSize=101'],
      ['page 0', '?page=0'],
      ['unknown param', '?foo=1'],
    ])('items: %s -> 400', async (_n, q) => {
      expect((await items(q)).status).toBe(400);
    });

    it('accepts the oldest allowed month (23 months back)', async () => {
      expect((await summary('?month=2024-07')).status).toBe(200);
    });
  });

  describe('figures', () => {
    it('empty month: zeros and the empty flag', async () => {
      const res = await summary('?month=2026-05');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        month: '2026-05',
        isEmpty: true,
        sessionCount: 0,
        grossVnd: 0,
        platformFeeVnd: 0,
        netVnd: 0,
        settledNetVnd: 0,
        unsettledNetVnd: 0,
        feeRate: 0.1,
      });
      const list = await items('?month=2026-05');
      expect(list.body).toMatchObject({ total: 0, items: [], cancelled: [], adjustments: [] });
    });

    it('defaults to the current month in GMT+7', async () => {
      t.clock.set(new Date('2026-06-30T17:30:00Z')); // already 1 July in Viet Nam
      tutor.cookie = (await f.addTutor()).cookie; // fresh cookie bound to the new clock; same-id irrelevant below
      const other = await f.addTutor();
      await session('2026-07-01T00:00:00Z', 100_000, { tutorId: other.id });
      expect((await summary('', other)).body.month).toBe('2026-07');
    });

    it('spec example: 200.000 + 150.000 + 333.333 at 10% -> fee 68.333, net 615.000', async () => {
      await session('2026-06-10T03:00:00Z', 200_000);
      await session('2026-06-11T03:00:00Z', 150_000);
      await session('2026-06-12T03:00:00Z', 333_333);
      const res = await summary('?month=2026-06');
      expect(res.body).toMatchObject({
        isEmpty: false,
        sessionCount: 3,
        grossVnd: 683_333,
        platformFeeVnd: 68_333,
        netVnd: 615_000,
        settledNetVnd: 0,
        unsettledNetVnd: 615_000,
        feeRate: 0.1,
      });
    });

    it('rounds half up per session, then adds', async () => {
      await session('2026-06-10T03:00:00Z', 100_005);
      await session('2026-06-11T03:00:00Z', 100_005);
      const body = (await summary('?month=2026-06')).body;
      expect(body.platformFeeVnd).toBe(20_002); // 2 x 10.001, not round(20.001)
      expect(body.netVnd).toBe(180_008);
    });

    it('item rows add up exactly to the totals across pages and settlement filters', async () => {
      const prices = [200_000, 150_000, 333_333, 100_005, 100_005, 99_999, 250_001];
      for (const [i, price] of prices.entries()) await session(`2026-06-${String(i + 1).padStart(2, '0')}T03:00:00Z`, price);
      await t.prisma.payment.updateMany({ where: { amountVnd: { in: [200_000, 99_999] } }, data: { settledAt: NOW } });

      const total = (await summary('?month=2026-06')).body;
      const rows: any[] = [];
      for (const page of [1, 2, 3, 4]) {
        const res = await items(`?month=2026-06&pageSize=2&page=${page}`);
        expect(res.body.total).toBe(prices.length);
        rows.push(...res.body.items);
      }
      expect(rows).toHaveLength(prices.length);
      const sum = (key: string, only?: (r: any) => boolean) => rows.filter(only ?? (() => true)).reduce((s, r) => s + r[key], 0);
      expect(sum('priceVnd')).toBe(total.grossVnd);
      expect(sum('platformFeeVnd')).toBe(total.platformFeeVnd);
      expect(sum('netVnd')).toBe(total.netVnd);
      expect(sum('netVnd', (r) => r.settled)).toBe(total.settledNetVnd);
      expect(sum('netVnd', (r) => !r.settled)).toBe(total.unsettledNetVnd);
      expect(total.settledNetVnd + total.unsettledNetVnd).toBe(total.netVnd);
      expect(rows.length).toBe(total.sessionCount);

      const settled = await items('?month=2026-06&settlement=settled');
      const unsettled = await items('?month=2026-06&settlement=unsettled');
      expect(settled.body.total).toBe(2);
      expect(unsettled.body.total).toBe(5);
    });

    it('sorts by startAt descending by default and ascending on request', async () => {
      await session('2026-06-01T03:00:00Z', 100_000);
      await session('2026-06-03T03:00:00Z', 100_000);
      await session('2026-06-02T03:00:00Z', 100_000);
      const desc = (await items('?month=2026-06')).body.items.map((r: any) => r.startAt);
      expect(desc).toEqual([...desc].sort().reverse());
      const asc = (await items('?month=2026-06&sort=startAt:asc')).body.items.map((r: any) => r.startAt);
      expect(asc).toEqual([...asc].sort());
      expect((await items('?month=2026-06&pageSize=1')).body.items).toHaveLength(1);
    });

    it('assigns a session to the Asia/Ho_Chi_Minh month of its endAt', async () => {
      await session('2026-05-31T16:00:00Z', 100_000); // ends 23:00 on 31 May in Viet Nam
      await session('2026-05-31T17:00:00Z', 200_000); // ends exactly 00:00 on 1 June
      expect((await summary('?month=2026-05')).body).toMatchObject({ sessionCount: 1, grossVnd: 100_000 });
      expect((await summary('?month=2026-06')).body).toMatchObject({ sessionCount: 1, grossVnd: 200_000 });
    });

    it('counts only finished CONFIRMED + PAID sessions of the caller', async () => {
      await session('2026-06-10T03:00:00Z', 100_000);
      await session('2026-06-20T03:00:00Z', 111_000); // not finished yet
      await session('2026-06-12T03:00:00Z', 122_000, { status: 'PENDING_PAYMENT', payment: 'PENDING', feeBp: null });
      const other = await f.addTutor();
      await session('2026-06-13T03:00:00Z', 133_000, { tutorId: other.id });
      const body = (await summary('?month=2026-06')).body;
      expect(body).toMatchObject({ sessionCount: 1, grossVnd: 100_000 });
      expect((await items('?month=2026-06')).body.items).toHaveLength(1);
    });

    it('lists cancelled and refunded sessions apart, outside the totals', async () => {
      await session('2026-06-10T03:00:00Z', 100_000);
      const cancelled = await session('2026-06-11T03:00:00Z', 120_000, {
        status: 'CANCELLED_BY_TUTOR',
        payment: 'REFUNDED',
        cancelReason: 'Om dot xuat',
        refundedAt: NOW,
      });
      const refunded = await session('2026-06-12T03:00:00Z', 130_000, { payment: 'REFUNDED', refundedAt: NOW });
      const body = (await summary('?month=2026-06')).body;
      expect(body).toMatchObject({ sessionCount: 1, grossVnd: 100_000, platformFeeVnd: 10_000, netVnd: 90_000 });
      const list = (await items('?month=2026-06')).body;
      expect(list.items).toHaveLength(1);
      expect(list.cancelled.map((c: any) => c.bookingId).sort()).toEqual([cancelled.id, refunded.id].sort());
      const row = list.cancelled.find((c: any) => c.bookingId === cancelled.id);
      expect(row).toMatchObject({ status: 'CANCELLED_BY_TUTOR', refunded: true, cancelledByRole: 'TUTOR', tutorCancelReason: 'Om dot xuat' });
    });

    it('does not leak student email, provider or refund references', async () => {
      await session('2026-06-10T03:00:00Z', 100_000);
      await session('2026-06-11T03:00:00Z', 120_000, { status: 'CANCELLED_BY_STUDENT', payment: 'REFUNDED', refundedAt: NOW, cancelReason: 'Ban viec' });
      const text = JSON.stringify([(await summary('?month=2026-06')).body, (await items('?month=2026-06')).body]);
      expect(text).not.toContain(student.email);
      expect(text).not.toMatch(/providerRef|refundRef|test:|Ban viec|"email"/);
      expect(Object.keys((await items('?month=2026-06')).body.items[0]).sort()).toEqual(
        ['bookingId', 'code', 'endAt', 'netVnd', 'platformFeeVnd', 'priceVnd', 'settled', 'settledAt', 'startAt', 'studentName'].sort(),
      );
    });
  });

  describe('fee snapshot', () => {
    it('is fixed when the booking is confirmed and survives a FEE_RATE change', async () => {
      const t15 = await createTestApp({ env: { FEE_RATE: '0.15' } });
      const t20 = await createTestApp({ env: { FEE_RATE: '0.2' } });
      try {
        t15.clock.set(NOW);
        t20.clock.set(NOW);
        const slot = await t.prisma.slot.create({
          data: { tutorId: tutor.id, startAt: new Date('2026-06-10T02:00:00Z'), endAt: new Date('2026-06-10T03:00:00Z'), status: 'HELD' },
        });
        const booking = await t.prisma.booking.create({
          data: {
            studentId: student.id,
            tutorId: tutor.id,
            slotId: slot.id,
            startAt: slot.startAt,
            endAt: slot.endAt,
            priceVnd: 200_001,
            status: 'PENDING_PAYMENT',
            holdExpiresAt: new Date(NOW.getTime() + HOUR),
            payment: { create: { provider: 'mock', providerRef: `test:${randomUUID()}`, amountVnd: 200_001, status: 'PENDING' } },
          },
        });
        const machine = t15.app.get(BookingStateMachine);
        await t15.prisma.$transaction(async (tx) => {
          await machine.confirm(tx, (await machine.lockBooking(tx, booking.id))!);
        });

        const payment = await t.prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
        expect(payment.status).toBe('PAID');
        expect(Number(payment.feeRate)).toBe(0.15);
        expect(payment.platformFeeVnd).toBe(30_000); // 30000.15

        const expected = { grossVnd: 200_001, platformFeeVnd: 30_000, netVnd: 170_001, feeRate: 0.15 };
        expect(await t15.app.get(EarningsService).summary(tutor.id, '2026-06')).toMatchObject(expected);
        expect(await t20.app.get(EarningsService).summary(tutor.id, '2026-06')).toMatchObject(expected);
        expect((await summary('?month=2026-06')).body).toMatchObject(expected); // default-config app
      } finally {
        await t15.close();
        await t20.close();
      }
    });

    it('a payment that predates the snapshot falls back to the configured rate', async () => {
      await session('2026-06-10T03:00:00Z', 200_000, { feeBp: null });
      expect((await summary('?month=2026-06')).body).toMatchObject({ platformFeeVnd: 20_000, netVnd: 180_000 });
    });
  });

  describe('settlement', () => {
    it('marks the month settled, once; a repeat is a no-op with no second audit row', async () => {
      await session('2026-05-10T03:00:00Z', 200_000);
      await session('2026-05-11T03:00:00Z', 150_000);
      await session('2026-06-01T03:00:00Z', 100_000); // other month: untouched

      const first = await settle(admin, tutor.id, '2026-05');
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ tutorId: tutor.id, month: '2026-05', settledCount: 2, alreadySettledCount: 0, settledNetVnd: 315_000 });

      const may = (await summary('?month=2026-05')).body;
      expect(may).toMatchObject({ netVnd: 315_000, settledNetVnd: 315_000, unsettledNetVnd: 0 });
      expect((await summary('?month=2026-06')).body).toMatchObject({ settledNetVnd: 0, unsettledNetVnd: 90_000 });
      const row = (await items('?month=2026-05&settlement=settled')).body.items[0];
      expect(row.settled).toBe(true);
      expect(row.settledAt).toBe(NOW.toISOString());

      const second = await settle(admin, tutor.id, '2026-05');
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ tutorId: tutor.id, month: '2026-05', settledCount: 0, alreadySettledCount: 2, settledNetVnd: 0 });

      const logs = await t.prisma.auditLog.findMany({ where: { action: 'TUTOR_EARNINGS_SETTLED' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorId: admin.id, entityType: 'TutorEarnings', entityId: `${tutor.id}:2026-05` });
      expect(logs[0]!.metadata).toMatchObject({ settledCount: 2, settledNetVnd: 315_000 });
      const payments = await t.prisma.payment.findMany({ where: { settledAt: { not: null } } });
      expect(payments.every((p) => p.settledBy === admin.id)).toBe(true);
    });

    it('ignores refunded, pending and other tutors sessions', async () => {
      await session('2026-05-10T03:00:00Z', 200_000);
      await session('2026-05-11T03:00:00Z', 150_000, { payment: 'REFUNDED', status: 'CANCELLED_BY_TUTOR', refundedAt: NOW });
      const other = await f.addTutor();
      await session('2026-05-12T06:00:00Z', 100_000, { tutorId: other.id });
      const res = await settle(admin, tutor.id, '2026-05');
      expect(res.body).toMatchObject({ settledCount: 1, settledNetVnd: 180_000 });
      expect(await t.prisma.payment.count({ where: { settledAt: { not: null } } })).toBe(1);
    });

    it('rejects the running month, bad input and unknown tutors', async () => {
      expect((await settle(admin, tutor.id, '2026-06')).status).toBe(409);
      expect((await settle(admin, tutor.id, '2026-07')).status).toBe(409);
      expect((await settle(admin, tutor.id, '2026-13')).status).toBe(400);
      expect((await settle(admin, 'not-a-uuid', '2026-05')).status).toBe(400);
      expect((await settle(admin, UUID0, '2026-05')).status).toBe(404);
      expect((await settle(admin, student.id, '2026-05')).status).toBe(404);
      expect((await put(`/admin/tutors/${tutor.id}/earnings/2026-05/settlement`, admin.cookie).send({ extra: 1 })).status).toBe(400);
      expect(await t.prisma.auditLog.count({ where: { action: 'TUTOR_EARNINGS_SETTLED' } })).toBe(0);
    });

    it('a refund after settlement leaves the closed month alone and shows as an adjustment in the refund month', async () => {
      const booking = await session('2026-05-10T03:00:00Z', 200_000);
      await session('2026-05-11T03:00:00Z', 100_000);
      await settle(admin, tutor.id, '2026-05');
      const before = (await summary('?month=2026-05')).body;

      await t.prisma.payment.update({ where: { id: booking.payment!.id }, data: { status: 'REFUNDED', refundedAt: NOW } });

      expect((await summary('?month=2026-05')).body).toEqual({ ...before, adjustmentsVnd: 0, adjustmentCount: 0 });
      const may = (await items('?month=2026-05')).body;
      expect(may.items).toHaveLength(2);
      expect(may.cancelled).toHaveLength(0);

      const june = (await summary('?month=2026-06')).body;
      expect(june).toMatchObject({ sessionCount: 0, netVnd: 0, adjustmentsVnd: -180_000, adjustmentCount: 1 });
      const adjustments = (await items('?month=2026-06')).body.adjustments;
      expect(adjustments).toEqual([
        expect.objectContaining({ bookingId: booking.id, amountVnd: -180_000, refundedAt: NOW.toISOString(), studentName: 'Nguyen Van An' }),
      ]);
    });
  });

  describe('admin read (QUA-76)', () => {
    const list = (query = '', who: User | null = admin) => get(t.app, `/admin/earnings${query}`, who?.cookie);
    const tutorItems = (tutorId: string, query = '', who: User | null = admin) =>
      get(t.app, `/admin/tutors/${tutorId}/earnings/items${query}`, who?.cookie);

    it('401 without a session, 403 for student and tutor', async () => {
      expect((await list('', null)).status).toBe(401);
      expect((await list('?month=2026-05', student)).status).toBe(403);
      expect((await list('?month=2026-05', tutor)).status).toBe(403);
      expect((await tutorItems(tutor.id, '?month=2026-05', null)).status).toBe(401);
      expect((await tutorItems(tutor.id, '?month=2026-05', student)).status).toBe(403);
      expect((await tutorItems(tutor.id, '?month=2026-05', tutor)).status).toBe(403);
    });

    it.each([
      ['malformed month', '?month=2026-6'],
      ['month 13', '?month=2026-13'],
      ['future month', '?month=2026-07'],
      ['older than 24 months', '?month=2024-06'],
      ['unknown param', '?foo=1'],
      ['pageSize over 100', '?pageSize=101'],
    ])('%s -> 400', async (_n, q) => {
      expect((await list(q)).status).toBe(400);
      expect((await tutorItems(tutor.id, q)).status).toBe(400);
    });

    it('items: bad tutor id -> 400, unknown or non-tutor -> 404', async () => {
      expect((await tutorItems('not-a-uuid', '?month=2026-05')).status).toBe(400);
      expect((await tutorItems(UUID0, '?month=2026-05')).status).toBe(404);
      expect((await tutorItems(student.id, '?month=2026-05')).status).toBe(404);
    });

    it('lists tutors with sessions in the month and matches the tutor own report and the item rows', async () => {
      const other = await f.addTutor();
      await t.prisma.user.update({ where: { id: other.id }, data: { fullName: 'Aaa Other' } });
      await session('2026-05-10T03:00:00Z', 200_000);
      await session('2026-05-11T03:00:00Z', 150_000, { settledAt: NOW });
      await session('2026-05-12T03:00:00Z', 333_333);
      await session('2026-05-12T06:00:00Z', 100_000, { tutorId: other.id });
      await session('2026-05-13T03:00:00Z', 90_000, { payment: 'PENDING', status: 'PENDING_PAYMENT' }); // not counted
      await session('2026-06-01T03:00:00Z', 50_000); // other month

      const res = await list('?month=2026-05');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ month: '2026-05', monthClosed: true, total: 2, page: 1 });
      expect(res.body.items.map((r: { tutorId: string }) => r.tutorId)).toEqual([other.id, tutor.id]);
      const row = res.body.items[1];
      expect(row).toMatchObject({ sessionCount: 3, settledCount: 1, unsettledCount: 2 });

      const own = (await summary('?month=2026-05')).body;
      expect(row).toMatchObject({
        sessionCount: own.sessionCount,
        grossVnd: own.grossVnd,
        platformFeeVnd: own.platformFeeVnd,
        netVnd: own.netVnd,
        settledNetVnd: own.settledNetVnd,
        unsettledNetVnd: own.unsettledNetVnd,
      });

      const detail = await tutorItems(tutor.id, '?month=2026-05');
      expect(detail.status).toBe(200);
      expect(detail.body.items.reduce((sum: number, i: { netVnd: number }) => sum + i.netVnd, 0)).toBe(row.netVnd);
      expect(detail.body.items.filter((i: { settled: boolean }) => i.settled)).toHaveLength(row.settledCount);
      expect(detail.body.items[0]).toEqual(expect.objectContaining({ bookingId: expect.any(String), studentName: 'Nguyen Van An', startAt: expect.any(String) }));
    });

    it('monthClosed is false for the running month; an empty month lists nothing', async () => {
      await session('2026-06-10T03:00:00Z', 100_000);
      expect((await list('')).body).toMatchObject({ month: '2026-06', monthClosed: false, total: 1 });
      const empty = await list('?month=2026-04');
      expect(empty.body).toMatchObject({ monthClosed: true, total: 0, items: [] });
    });

    it('paginates the tutor list', async () => {
      const other = await f.addTutor();
      await session('2026-05-10T03:00:00Z', 100_000);
      await session('2026-05-10T06:00:00Z', 100_000, { tutorId: other.id });
      const page2 = (await list('?month=2026-05&pageSize=1&page=2')).body;
      expect(page2).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page2.items).toHaveLength(1);
    });

    it('reflects the settlement afterwards', async () => {
      await session('2026-05-10T03:00:00Z', 200_000);
      await session('2026-05-11T03:00:00Z', 150_000);
      await settle(admin, tutor.id, '2026-05');

      const row = (await list('?month=2026-05')).body.items[0];
      expect(row).toMatchObject({ netVnd: 315_000, settledNetVnd: 315_000, unsettledNetVnd: 0, settledCount: 2, unsettledCount: 0 });
      const detail = (await tutorItems(tutor.id, '?month=2026-05')).body.items;
      expect(detail).toHaveLength(2);
      for (const i of detail) expect(i).toMatchObject({ settled: true, settledAt: NOW.toISOString() });
    });
  });
});
