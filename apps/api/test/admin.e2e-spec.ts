import { PAYMENT_PROVIDER, PaymentProvider } from '../src/payments/payment-provider';
import { fixtures, HOUR, User, UUID0 } from './fixtures';
import { createTestApp, get, post, resetDb, TestApp } from './helpers';
import request from 'supertest';
import { API, ORIGIN } from './helpers';

describe('admin API (T5)', () => {
  let t: TestApp;
  let f: ReturnType<typeof fixtures>;
  let admin: User;
  let student: User;
  let tutor: User;

  const patch = (path: string, cookie: string) =>
    request(t.app.getHttpServer()).patch(`${API}${path}`).set('Origin', ORIGIN).set('Cookie', cookie);
  const audits = (entityId?: string) =>
    t.prisma.auditLog.findMany({ where: entityId ? { entityId } : {}, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp();
    f = fixtures(t);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDb(t.prisma);
    t.clock.set(new Date());
    admin = await f.addUser('ADMIN', 'Quan Tri');
    student = await f.addUser('STUDENT', 'Nguyen Van An');
    tutor = await f.addTutor({ status: 'PENDING_APPROVAL' });
  });

  describe('authorization matrix (DoD)', () => {
    const routes: ['get' | 'post' | 'patch', string][] = [
      ['get', '/admin/stats'],
      ['get', '/admin/users'],
      ['patch', `/admin/users/${UUID0}/status`],
      ['get', '/admin/tutors'],
      ['post', `/admin/tutors/${UUID0}/approve`],
      ['get', '/admin/bookings'],
      ['get', `/admin/bookings/${UUID0}`],
      ['post', `/admin/bookings/${UUID0}/cancel`],
      ['post', `/admin/payments/${UUID0}/refund`],
      ['patch', `/admin/reviews/${UUID0}`],
      ['get', '/admin/audit-logs'],
    ];
    const call = (method: 'get' | 'post' | 'patch', path: string, cookie?: string) => {
      const req = method === 'get' ? get(t.app, path, cookie) : method === 'post' ? post(t.app, path, cookie) : patch(path, cookie ?? '');
      if (!cookie && method === 'patch') return request(t.app.getHttpServer()).patch(`${API}${path}`).set('Origin', ORIGIN).send({});
      return method === 'get' ? req : req.send({ status: 'LOCKED', reason: 'x', hidden: true });
    };

    it.each(routes)('%s %s: anonymous 401, student/tutor 403', async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
      expect((await call(method, path, student.cookie)).status).toBe(403);
      expect((await call(method, path, tutor.cookie)).status).toBe(403);
    });

    it('admin reaches the routes (unknown ids are 404, not 403)', async () => {
      expect((await get(t.app, '/admin/stats', admin.cookie)).status).toBe(200);
      expect((await get(t.app, `/admin/bookings/${UUID0}`, admin.cookie)).status).toBe(404);
    });
  });

  describe('PATCH /admin/users/:id/status', () => {
    it('locks: bumps token_version, kills the old session, audits once; unlock audits once', async () => {
      const before = await t.prisma.user.findUniqueOrThrow({ where: { id: student.id } });
      const res = await patch(`/admin/users/${student.id}/status`, admin.cookie).send({ status: 'LOCKED', reason: 'spam' }).expect(200);
      expect(res.body).toMatchObject({ id: student.id, status: 'LOCKED' });
      const after = await t.prisma.user.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect((await get(t.app, '/me', student.cookie)).status).toBe(401);

      await patch(`/admin/users/${student.id}/status`, admin.cookie).send({ status: 'ACTIVE' }).expect(200);
      expect((await audits(student.id)).map((a) => [a.action, a.actorId, a.reason])).toEqual([
        ['USER_LOCKED', admin.id, 'spam'],
        ['USER_UNLOCKED', admin.id, null],
      ]);
    });

    it('no-op (already in that status) writes no audit row', async () => {
      await patch(`/admin/users/${student.id}/status`, admin.cookie).send({ status: 'ACTIVE' }).expect(200);
      expect(await audits()).toHaveLength(0);
    });

    it('cannot lock an admin, including oneself: 409 CANNOT_LOCK_ADMIN', async () => {
      const other = await f.addUser('ADMIN');
      for (const id of [admin.id, other.id]) {
        const res = await patch(`/admin/users/${id}/status`, admin.cookie).send({ status: 'LOCKED' }).expect(409);
        expect(res.body.error.code).toBe('CANNOT_LOCK_ADMIN');
      }
      expect(await audits()).toHaveLength(0);
    });

    it('unknown id 404, bad id 400, bad status 400', async () => {
      await patch(`/admin/users/${UUID0}/status`, admin.cookie).send({ status: 'LOCKED' }).expect(404);
      await patch('/admin/users/nope/status', admin.cookie).send({ status: 'LOCKED' }).expect(400);
      await patch(`/admin/users/${student.id}/status`, admin.cookie).send({ status: 'BANNED' }).expect(400);
    });
  });

  describe('POST /admin/tutors/:id/:action', () => {
    const act = (id: string, action: string, body: object = {}) => post(t.app, `/admin/tutors/${id}/${action}`, admin.cookie).send(body);
    const status = async (id: string) => (await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: id } })).approvalStatus;

    it('approve -> suspend -> reinstate, each audited', async () => {
      await act(tutor.id, 'approve').expect(200);
      expect(await status(tutor.id)).toBe('APPROVED');
      await act(tutor.id, 'suspend', { reason: 'complaint' }).expect(200);
      expect(await status(tutor.id)).toBe('SUSPENDED');
      await act(tutor.id, 'reinstate').expect(200);
      expect(await status(tutor.id)).toBe('APPROVED');
      expect((await audits(tutor.id)).map((a) => a.action)).toEqual(['TUTOR_APPROVED', 'TUTOR_SUSPENDED', 'TUTOR_REINSTATED']);
    });

    it('reject needs a reason (400) and stores it', async () => {
      expect((await act(tutor.id, 'reject')).status).toBe(400);
      expect(await status(tutor.id)).toBe('PENDING_APPROVAL');
      await act(tutor.id, 'reject', { reason: 'thieu bang cap' }).expect(200);
      const p = await t.prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } });
      expect(p).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'thieu bang cap', reviewedBy: admin.id });
    });

    it('wrong state is 409 INVALID_STATE and writes no audit', async () => {
      for (const action of ['suspend', 'reinstate']) {
        const res = await act(tutor.id, action).expect(409);
        expect(res.body.error.code).toBe('INVALID_STATE');
      }
      await act(tutor.id, 'approve').expect(200);
      expect((await act(tutor.id, 'approve')).body.error.code).toBe('INVALID_STATE');
      expect((await act(tutor.id, 'reject', { reason: 'x' })).status).toBe(409);
      expect(await audits()).toHaveLength(1);
    });

    it('unknown action is 400; a non-tutor or unknown id is 404', async () => {
      expect((await act(tutor.id, 'delete')).status).toBe(400);
      expect((await act(student.id, 'approve')).status).toBe(404);
      expect((await act(UUID0, 'approve')).status).toBe(404);
    });
  });

  describe('POST /admin/bookings/:id/cancel', () => {
    const cancel = (id: string, body: object = { reason: 'su co' }) => post(t.app, `/admin/bookings/${id}/cancel`, admin.cookie).send(body);

    beforeEach(async () => {
      tutor = await f.addTutor();
    });

    it('CONFIRMED: cancelled by admin, slot CLOSED, refunded by default, one audit row', async () => {
      const { booking, slot, payment } = await f.confirmedBooking(student, tutor);
      const res = await cancel(booking.id).expect(200);
      expect(res.body.status).toBe('CANCELLED_BY_ADMIN');
      expect(res.body.payment.status).toBe('REFUNDED');
      expect((await t.prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('CLOSED');
      const rows = await audits(booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'BOOKING_CANCELLED_BY_ADMIN', actorId: admin.id, reason: 'su co' });
      expect((await t.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).refundedAt).not.toBeNull();
    });

    it('refund:false keeps the payment PAID', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      const res = await cancel(booking.id, { reason: 'x', refund: false }).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED_BY_ADMIN', payment: { status: 'PAID' } });
    });

    it('PENDING_PAYMENT or already started -> 409; missing reason -> 400; unknown -> 404', async () => {
      const { booking } = await f.confirmedBooking(student, tutor);
      await t.prisma.booking.update({ where: { id: booking.id }, data: { status: 'PENDING_PAYMENT', holdExpiresAt: new Date(t.clock.now().getTime() + HOUR) } });
      expect((await cancel(booking.id)).status).toBe(409);

      const started = await f.confirmedBooking(student, tutor, 96 * HOUR);
      await f.jump(new Date(started.slot.startAt.getTime() + 60_000), [admin]);
      expect((await cancel(started.booking.id)).status).toBe(409);

      expect((await cancel(started.booking.id, {})).status).toBe(400);
      expect((await cancel(UUID0)).status).toBe(404);
      expect(await audits()).toHaveLength(0);
    });
  });

  describe('POST /admin/payments/:id/refund', () => {
    const refund = (id: string, body: object = { reason: 'hoan tay' }) => post(t.app, `/admin/payments/${id}/refund`, admin.cookie).send(body);
    const provider = () => t.app.get<PaymentProvider>(PAYMENT_PROVIDER);

    beforeEach(async () => {
      tutor = await f.addTutor();
    });

    it('PAID after a no-refund cancel -> REFUNDED; second call 409 ALREADY_REFUNDED', async () => {
      const { booking, payment } = await f.confirmedBooking(student, tutor);
      await post(t.app, `/admin/bookings/${booking.id}/cancel`, admin.cookie).send({ reason: 'x', refund: false }).expect(200);
      const res = await refund(payment.id).expect(200);
      expect(res.body).toMatchObject({ id: payment.id, status: 'REFUNDED', refundedByName: 'Quan Tri' });
      const again = await refund(payment.id).expect(409);
      expect(again.body.error.code).toBe('ALREADY_REFUNDED');
      expect((await audits(payment.id)).map((a) => a.action)).toEqual(['PAYMENT_REFUNDED']);
    });

    it('CONFIRMED booking not yet taught -> 409 PAYMENT_NOT_REFUNDABLE', async () => {
      const { payment } = await f.confirmedBooking(student, tutor);
      const res = await refund(payment.id).expect(409);
      expect(res.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
      expect(await audits()).toHaveLength(0);
    });

    it('provider failure keeps PAID with refundFailed (retryable) and is audited', async () => {
      const { booking, payment } = await f.confirmedBooking(student, tutor);
      await post(t.app, `/admin/bookings/${booking.id}/cancel`, admin.cookie).send({ reason: 'x', refund: false }).expect(200);
      const spy = jest.spyOn(provider(), 'refund').mockRejectedValueOnce(new Error('gateway down'));
      const res = await refund(payment.id).expect(200);
      expect(res.body).toMatchObject({ status: 'PAID', refundFailed: true });
      expect((await audits(payment.id)).map((a) => a.action)).toEqual(['PAYMENT_REFUND_FAILED']);

      const listed = await get(t.app, '/admin/bookings?refundFailed=true', admin.cookie).expect(200);
      expect(listed.body.items.map((b: { id: string }) => b.id)).toEqual([booking.id]);

      expect((await refund(payment.id)).status).toBe(200); // retry works
      expect((await t.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
      expect(spy).toHaveBeenCalledTimes(2); // failed attempt + retry
    });

    it('two parallel requests refund exactly once', async () => {
      const { booking, payment } = await f.confirmedBooking(student, tutor);
      await post(t.app, `/admin/bookings/${booking.id}/cancel`, admin.cookie).send({ reason: 'x', refund: false }).expect(200);
      const spy = jest.spyOn(provider(), 'refund');
      const results = await Promise.all([refund(payment.id), refund(payment.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await audits(payment.id)).filter((a) => a.action === 'PAYMENT_REFUNDED')).toHaveLength(1);
    });

    it('unknown payment 404, bad id 400, missing reason 400', async () => {
      expect((await refund(UUID0)).status).toBe(404);
      expect((await refund('nope')).status).toBe(400);
      expect((await refund(UUID0, {})).status).toBe(400);
    });
  });

  describe('reads and review moderation', () => {
    it('lists users with filters and pagination bounds', async () => {
      const res = await get(t.app, '/admin/users?role=STUDENT&pageSize=5', admin.cookie).expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 5, total: 1 });
      expect(res.body.items[0]).not.toHaveProperty('passwordHash');
      expect((await get(t.app, '/admin/users?pageSize=1000', admin.cookie)).status).toBe(400);
    });

    it('hides a review and audits it; audit-logs lists newest filters', async () => {
      tutor = await f.addTutor();
      const { booking } = await f.confirmedBooking(student, tutor);
      const r = await t.prisma.review.create({ data: { bookingId: booking.id, studentId: student.id, tutorId: tutor.id, rating: 4 } });
      await patch(`/admin/reviews/${r.id}`, admin.cookie).send({ hidden: true }).expect(200);
      expect((await t.prisma.review.findUniqueOrThrow({ where: { id: r.id } })).isHidden).toBe(true);
      const logs = await get(t.app, `/admin/audit-logs?entityId=${r.id}`, admin.cookie).expect(200);
      expect(logs.body.items).toHaveLength(1);
      expect(logs.body.items[0]).toMatchObject({ entityType: 'review', actorId: admin.id });
    });
  });
});
