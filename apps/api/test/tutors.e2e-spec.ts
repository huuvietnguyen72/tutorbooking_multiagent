import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { API, createTestApp, get, insertUser, loginCookie, ORIGIN, post, resetDb, TestApp } from './helpers';

process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'tb-uploads-'));

const HOUR = 3_600_000;
const send = (t: TestApp, method: 'put' | 'patch' | 'delete', path: string, cookie?: string) => {
  const req = request(t.app.getHttpServer())[method](`${API}${path}`).set('Origin', ORIGIN);
  return cookie ? req.set('Cookie', cookie) : req;
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

describe('tutors, subjects, slots (T3)', () => {
  let t: TestApp;
  let tutor: { id: string; cookie: string; email: string };
  let other: { id: string; cookie: string };
  let student: { id: string; cookie: string; email: string };
  let admin: { cookie: string };
  let subjectIds: number[];
  let future: number; // base instant: tomorrow 00:00 UTC

  const addTutor = async (opts: { status?: 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED'; price?: number; subject?: number; name?: string; rating?: number } = {}) => {
    const user = await insertUser(t.prisma, 'TUTOR');
    await t.prisma.user.update({ where: { id: user.id }, data: { fullName: opts.name ?? 'Gia Su' } });
    await t.prisma.tutorProfile.create({
      data: {
        userId: user.id,
        approvalStatus: opts.status ?? 'APPROVED',
        pricePerSessionVnd: opts.price ?? 200_000,
        ratingAvg: opts.rating ?? 0,
        subjects: opts.subject ? { create: [{ subjectId: opts.subject }] } : undefined,
        rejectionReason: opts.status === 'REJECTED' ? 'ly do noi bo' : null,
      },
    });
    return { id: user.id, email: user.email, cookie: await loginCookie(t.app, user.email) };
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.prisma);
    t.clock.set(new Date());
    future = Math.ceil((Date.now() + 24 * HOUR) / (24 * HOUR)) * 24 * HOUR;
    subjectIds = [];
    for (const name of ['Toan', 'Ly', 'Hoa']) {
      subjectIds.push((await t.prisma.subject.create({ data: { name, slug: name.toLowerCase() } })).id);
    }
    tutor = await addTutor({ subject: subjectIds[0], name: 'Nguyen An' });
    other = await addTutor({ subject: subjectIds[1], name: 'Tran Binh', price: 400_000 });
    const s = await insertUser(t.prisma, 'STUDENT');
    student = { id: s.id, email: s.email, cookie: await loginCookie(t.app, s.email) };
    const a = await insertUser(t.prisma, 'ADMIN');
    admin = { cookie: await loginCookie(t.app, a.email) };
  });

  describe('authorization matrix', () => {
    const slotId = '00000000-0000-4000-8000-000000000000';
    const endpoints: [string, string][] = [
      ['get', '/tutor/profile'],
      ['put', '/tutor/profile'],
      ['put', '/tutor/profile/avatar'],
      ['post', '/tutor/profile/submit'],
      ['get', `/tutor/slots?from=${new Date().toISOString()}&to=${new Date(Date.now() + HOUR).toISOString()}`],
      ['post', '/tutor/slots'],
      ['patch', `/tutor/slots/${slotId}`],
      ['delete', `/tutor/slots/${slotId}`],
      ['post', `/tutor/slots/${slotId}/reopen`],
    ];
    const call = (method: string, path: string, cookie?: string) => {
      const req = request(t.app.getHttpServer())[method as 'get'](`${API}${path}`).set('Origin', ORIGIN);
      if (path.endsWith('/avatar')) req.attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
      return cookie ? req.set('Cookie', cookie) : req;
    };
    it.each(endpoints)('%s %s: no login → 401, student/admin → 403', async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
      expect((await call(method, path, student.cookie)).status).toBe(403);
      expect((await call(method, path, admin.cookie)).status).toBe(403);
    });
  });

  describe('subjects + public tutors', () => {
    it('GET /subjects is public', async () => {
      const res = await get(t.app, '/subjects').expect(200);
      expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Hoa', 'Ly', 'Toan']);
    });

    it('public DTO exposes no email, approval or rejection data; only APPROVED tutors appear', async () => {
      const rejected = await addTutor({ status: 'REJECTED', subject: subjectIds[0] });
      const pending = await addTutor({ status: 'PENDING_APPROVAL' });
      const list = await get(t.app, '/tutors').expect(200);
      expect(list.body.total).toBe(2);
      const text = JSON.stringify(list.body);
      for (const forbidden of [tutor.email, 'ly do noi bo', 'approvalStatus', 'rejectionReason', 'reviewedBy', 'email']) {
        expect(text).not.toContain(forbidden);
      }
      await get(t.app, `/tutors/${rejected.id}`).expect(404);
      await get(t.app, `/tutors/${pending.id}`).expect(404);
      const detail = await get(t.app, `/tutors/${tutor.id}`).expect(200);
      expect(Object.keys(detail.body).sort()).toEqual(
        ['avatarUrl', 'bio', 'experience', 'fullName', 'id', 'nextAvailableAt', 'pricePerSessionVnd', 'ratingAvg', 'ratingCount', 'subjects'],
      );
    });

    it('hides locked tutors', async () => {
      await t.prisma.user.update({ where: { id: other.id }, data: { status: 'LOCKED' } });
      expect((await get(t.app, '/tutors').expect(200)).body.total).toBe(1);
      await get(t.app, `/tutors/${other.id}`).expect(404);
    });

    it('filters by subject and price, sorts by whitelist, paginates', async () => {
      const bySubject = await get(t.app, `/tutors?subjectId=${subjectIds[1]}`).expect(200);
      expect(bySubject.body.items.map((i: { id: string }) => i.id)).toEqual([other.id]);
      const byPrice = await get(t.app, '/tutors?minPrice=300000&maxPrice=500000').expect(200);
      expect(byPrice.body.items.map((i: { id: string }) => i.id)).toEqual([other.id]);
      const desc = await get(t.app, '/tutors?sort=price_desc').expect(200);
      expect(desc.body.items.map((i: { id: string }) => i.id)).toEqual([other.id, tutor.id]);
      const asc = await get(t.app, '/tutors?sort=price_asc&pageSize=1&page=2').expect(200);
      expect(asc.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
      expect(asc.body.items.map((i: { id: string }) => i.id)).toEqual([other.id]);
    });

    it('filters by rating and name; escapes LIKE wildcards in q', async () => {
      await t.prisma.tutorProfile.update({ where: { userId: other.id }, data: { ratingAvg: 4.5, ratingCount: 3 } });
      expect((await get(t.app, '/tutors?minRating=4').expect(200)).body.items.map((i: { id: string }) => i.id)).toEqual([other.id]);
      expect((await get(t.app, '/tutors?q=tran').expect(200)).body.total).toBe(1);
      expect((await get(t.app, '/tutors?q=%25').expect(200)).body.total).toBe(0);
      expect((await get(t.app, '/tutors?q=_').expect(200)).body.total).toBe(0);
    });

    it('rejects invalid query input (D4)', async () => {
      for (const q of ['pageSize=101', 'page=0', 'sort=password', 'subjectId=abc', `q=${'x'.repeat(101)}`, 'availableDate=2030-13-45', 'availableDate=2030-02-30', 'availableDate=2031-02-29', 'minRating=9']) {
        const res = await get(t.app, `/tutors?${q}`).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      await get(t.app, '/tutors/not-a-uuid').expect(400);
    });

    it('availableDate filter uses the display timezone; nextAvailableAt is the earliest bookable slot', async () => {
      // 20:00 UTC on day D == 03:00 on D+1 in Asia/Ho_Chi_Minh.
      const start = new Date(future + 20 * HOUR);
      await t.prisma.slot.create({ data: { tutorId: tutor.id, startAt: start, endAt: new Date(start.getTime() + HOUR) } });
      const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const local = day(future + 24 * HOUR);
      expect((await get(t.app, `/tutors?availableDate=${local}`).expect(200)).body.items.map((i: { id: string }) => i.id)).toEqual([tutor.id]);
      expect((await get(t.app, `/tutors?availableDate=${day(future)}`).expect(200)).body.total).toBe(0);
      const detail = await get(t.app, `/tutors/${tutor.id}`).expect(200);
      expect(detail.body.nextAvailableAt).toBe(start.toISOString());
    });

    it('public slots: AVAILABLE/UNAVAILABLE only, no closed/deleted/booker info, 31-day cap', async () => {
      const mk = (h: number, status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'CLOSED', deletedAt?: Date) =>
        t.prisma.slot.create({ data: { tutorId: tutor.id, startAt: new Date(future + h * HOUR), endAt: new Date(future + (h + 1) * HOUR), status, deletedAt } });
      await mk(1, 'AVAILABLE');
      await mk(3, 'HELD');
      await mk(5, 'BOOKED');
      await mk(7, 'CLOSED');
      await mk(9, 'AVAILABLE', new Date());
      const q = `from=${new Date(future).toISOString()}&to=${new Date(future + 2 * 86_400_000).toISOString()}`;
      const res = await get(t.app, `/tutors/${tutor.id}/slots?${q}`).expect(200);
      expect(res.body.map((s: { status: string }) => s.status)).toEqual(['AVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE']);
      expect(Object.keys(res.body[0]).sort()).toEqual(['endAt', 'id', 'startAt', 'status']);
      await get(t.app, `/tutors/${tutor.id}/slots?from=${new Date(future).toISOString()}&to=${new Date(future + 32 * 86_400_000).toISOString()}`).expect(400);
      await get(t.app, `/tutors/${tutor.id}/slots?from=2030-01-01T00:00:00&to=2030-01-02T00:00:00`).expect(400); // no offset
      await get(t.app, `/tutors/${other.id}/slots?${q}`).expect(200);
      const pending = await addTutor({ status: 'PENDING_APPROVAL' });
      await get(t.app, `/tutors/${pending.id}/slots?${q}`).expect(404);
    });

    it('GET /slots/:id returns slot + tutor + price; 404 for closed or unapproved tutor', async () => {
      const slot = await t.prisma.slot.create({ data: { tutorId: tutor.id, startAt: new Date(future + 2 * HOUR), endAt: new Date(future + 3 * HOUR) } });
      const res = await get(t.app, `/slots/${slot.id}`).expect(200);
      expect(res.body).toMatchObject({ id: slot.id, status: 'AVAILABLE', priceVnd: 200_000, tutor: { id: tutor.id } });
      expect(JSON.stringify(res.body)).not.toContain(tutor.email);
      await t.prisma.slot.update({ where: { id: slot.id }, data: { status: 'CLOSED' } });
      await get(t.app, `/slots/${slot.id}`).expect(404);
      await t.prisma.slot.update({ where: { id: slot.id }, data: { status: 'AVAILABLE' } });
      await t.prisma.tutorProfile.update({ where: { userId: tutor.id }, data: { approvalStatus: 'SUSPENDED' } });
      await get(t.app, `/slots/${slot.id}`).expect(404);
    });
  });

  describe('own profile', () => {
    const body = (over: object = {}) => ({
      fullName: 'Nguyen An', bio: 'Bio', experience: 'Exp', pricePerSessionVnd: 300_000, subjectIds: [subjectIds[0], subjectIds[2]], ...over,
    });

    it('updates profile + subjects, keeps approval status, shows own status', async () => {
      const res = await send(t, 'put', '/tutor/profile', tutor.cookie).send(body({ fullName: 'Moi' })).expect(200);
      expect(res.body).toMatchObject({ fullName: 'Moi', pricePerSessionVnd: 300_000, approvalStatus: 'APPROVED', rejectionReason: null });
      expect(res.body.subjects.map((s: { id: number }) => s.id)).toEqual([subjectIds[0], subjectIds[2]]);
      const me = await get(t.app, '/tutor/profile', tutor.cookie).expect(200);
      expect(me.body.approvalStatus).toBe('APPROVED');
    });

    it('validates input (D4): strict keys, bounds, unknown subject', async () => {
      for (const bad of [
        body({ pricePerSessionVnd: 0 }), body({ pricePerSessionVnd: 1.5 }), body({ pricePerSessionVnd: 100_000_001 }),
        body({ fullName: '' }), body({ bio: 'x'.repeat(2001) }), body({ subjectIds: [] }), body({ subjectIds: [999999] }),
        body({ approvalStatus: 'APPROVED' }), body({ avatarUrl: 'http://evil' }),
      ]) {
        const res = await send(t, 'put', '/tutor/profile', tutor.cookie).send(bad).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('a tutor can only edit their own profile (no id in the path, identity from session)', async () => {
      await send(t, 'put', '/tutor/profile', tutor.cookie).send(body({ fullName: 'Chi Toi' })).expect(200);
      const o = await t.prisma.user.findUniqueOrThrow({ where: { id: other.id } });
      expect(o.fullName).toBe('Tran Binh');
    });

    it('resubmit: REJECTED → PENDING_APPROVAL clears reason; other states → 409', async () => {
      await post(t.app, '/tutor/profile/submit', tutor.cookie).expect(409);
      const rej = await addTutor({ status: 'REJECTED' });
      const res = await post(t.app, '/tutor/profile/submit', rej.cookie).expect(200);
      expect(res.body).toMatchObject({ approvalStatus: 'PENDING_APPROVAL', rejectionReason: null });
    });

    it('avatar: accepts PNG by magic bytes, serves it back, replaces old file', async () => {
      const up = (buf: Buffer, name = 'a.png', ct = 'image/png') =>
        send(t, 'put', '/tutor/profile/avatar', tutor.cookie).attach('file', buf, { filename: name, contentType: ct });
      const res = await up(PNG).expect(200);
      expect(res.body.avatarUrl).toMatch(/^\/api\/v1\/files\/avatars\/[a-f0-9]{32}\.png$/);
      const file = await request(t.app.getHttpServer()).get(res.body.avatarUrl).expect(200);
      expect(file.headers['content-type']).toMatch(/image\/png/);
      const second = await up(PNG).expect(200);
      expect(second.body.avatarUrl).not.toBe(res.body.avatarUrl);
      await request(t.app.getHttpServer()).get(res.body.avatarUrl).expect(404);
    });

    it('avatar: rejects wrong type (even with image content-type), oversize, missing file', async () => {
      const bad = await send(t, 'put', '/tutor/profile/avatar', tutor.cookie)
        .attach('file', Buffer.from('<?php echo 1;'), { filename: 'a.png', contentType: 'image/png' }).expect(415);
      expect(bad.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      const big = await send(t, 'put', '/tutor/profile/avatar', tutor.cookie)
        .attach('file', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), { filename: 'a.png', contentType: 'image/png' }).expect(413);
      expect(big.body.error.code).toBe('FILE_TOO_LARGE');
      await send(t, 'put', '/tutor/profile/avatar', tutor.cookie).field('x', 'y').expect(400);
      await send(t, 'put', '/tutor/profile/avatar', tutor.cookie).send({ a: 1 }).expect(400); // JSON not accepted
    });

    it('avatar file route is a whitelist (no traversal)', async () => {
      await request(t.app.getHttpServer()).get(`${API}/files/avatars/..%2F..%2Fpackage.json`).expect(404);
      await request(t.app.getHttpServer()).get(`${API}/files/avatars/${'a'.repeat(32)}.png`).expect(404);
    });
  });

  describe('tutor slots', () => {
    const start = (h: number) => new Date(future + h * HOUR).toISOString();
    const list = (cookie: string) =>
      get(t.app, `/tutor/slots?from=${start(0)}&to=${new Date(future + 5 * 86_400_000).toISOString()}`, cookie);

    it('creates slots of SLOT_DURATION, all-or-nothing', async () => {
      const res = await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10), start(12)] }).expect(201);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ startAt: start(10), endAt: start(11), status: 'AVAILABLE', booking: null });
      // overlaps existing slot → whole batch rejected
      const clash = await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(20), start(12)] }).expect(409);
      expect(clash.body.error.code).toBe('SLOT_OVERLAP');
      expect((await list(tutor.cookie)).body).toHaveLength(2);
    });

    it('allows adjacent slots; rejects overlap within one request and between requests', async () => {
      await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10), start(11)] }).expect(201);
      const inReq = await post(t.app, '/tutor/slots', tutor.cookie)
        .send({ startTimes: [start(30), new Date(future + 30 * HOUR + 30 * 60_000).toISOString()] }).expect(409);
      expect(inReq.body.error.code).toBe('SLOT_OVERLAP');
      await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [new Date(future + 10 * HOUR + 1000).toISOString()] }).expect(409);
    });

    it('concurrent identical creates: exactly one wins (DB exclusion constraint)', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(14)] })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    });

    it('validates input: past, no offset, empty, >50, extra keys', async () => {
      for (const startTimes of [[new Date(Date.now() - HOUR).toISOString()], ['2030-01-01T10:00:00'], [], Array.from({ length: 51 }, (_, i) => start(i * 2)), ['nope']]) {
        const res = await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(1)], status: 'BOOKED' }).expect(400);
    });

    it('unapproved tutors cannot create slots (TUTOR_NOT_ACCEPTING)', async () => {
      const pending = await addTutor({ status: 'PENDING_APPROVAL' });
      const res = await post(t.app, '/tutor/slots', pending.cookie).send({ startTimes: [start(1)] }).expect(403);
      expect(res.body.error.code).toBe('TUTOR_NOT_ACCEPTING');
    });

    it('lists own slots with booking info when BOOKED, not other tutors’ slots', async () => {
      const [mine] = (await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10)] }).expect(201)).body;
      await post(t.app, '/tutor/slots', other.cookie).send({ startTimes: [start(10)] }).expect(201);
      await t.prisma.slot.update({ where: { id: mine.id }, data: { status: 'BOOKED' } });
      await t.prisma.booking.create({
        data: { studentId: student.id, tutorId: tutor.id, slotId: mine.id, startAt: new Date(mine.startAt), endAt: new Date(mine.endAt), priceVnd: 1000, status: 'CONFIRMED' },
      });
      const res = await list(tutor.cookie).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].booking).toMatchObject({ studentName: 'Test STUDENT', code: expect.stringMatching(/^#BK-\d+$/) });
      await get(t.app, `/tutor/slots?from=${start(0)}&to=${new Date(future + 40 * 86_400_000).toISOString()}`, tutor.cookie).expect(400);
    });

    it('move: only AVAILABLE own slots; HELD/BOOKED → SLOT_LOCKED; overlap → SLOT_OVERLAP; foreign → 404', async () => {
      const [a, b] = (await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10), start(14)] }).expect(201)).body;
      const moved = await send(t, 'patch', `/tutor/slots/${a.id}`, tutor.cookie).send({ startAt: start(16) }).expect(200);
      expect(moved.body).toMatchObject({ startAt: start(16), endAt: start(17) });
      expect((await send(t, 'patch', `/tutor/slots/${a.id}`, tutor.cookie).send({ startAt: start(14) }).expect(409)).body.error.code).toBe('SLOT_OVERLAP');
      await send(t, 'patch', `/tutor/slots/${a.id}`, other.cookie).send({ startAt: start(16) }).expect(404);
      await send(t, 'patch', `/tutor/slots/${a.id}`, tutor.cookie).send({ startAt: new Date(Date.now() - HOUR).toISOString() }).expect(400);
      for (const status of ['HELD', 'BOOKED'] as const) {
        await t.prisma.slot.update({ where: { id: b.id }, data: { status } });
        expect((await send(t, 'patch', `/tutor/slots/${b.id}`, tutor.cookie).send({ startAt: start(40) }).expect(409)).body.error.code).toBe('SLOT_LOCKED');
        expect((await send(t, 'delete', `/tutor/slots/${b.id}`, tutor.cookie).expect(409)).body.error.code).toBe('SLOT_LOCKED');
      }
    });

    it('delete is soft, frees the time range, hides the slot; foreign → 404', async () => {
      const [a] = (await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10)] }).expect(201)).body;
      await send(t, 'delete', `/tutor/slots/${a.id}`, other.cookie).expect(404);
      await send(t, 'delete', `/tutor/slots/${a.id}`, tutor.cookie).expect(204);
      const row = await t.prisma.slot.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.deletedAt).not.toBeNull();
      expect((await list(tutor.cookie)).body).toHaveLength(0);
      await send(t, 'delete', `/tutor/slots/${a.id}`, tutor.cookie).expect(404);
      await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10)] }).expect(201);
    });

    it('reopen: CLOSED → AVAILABLE; wrong state → INVALID_STATE; past → SLOT_TOO_SOON; overlap → SLOT_OVERLAP; foreign → 404', async () => {
      const [a] = (await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10)] }).expect(201)).body;
      expect((await post(t.app, `/tutor/slots/${a.id}/reopen`, tutor.cookie).expect(409)).body.error.code).toBe('INVALID_STATE');
      await t.prisma.slot.update({ where: { id: a.id }, data: { status: 'CLOSED' } });
      await post(t.app, `/tutor/slots/${a.id}/reopen`, other.cookie).expect(404);
      // another slot takes the range while it is closed
      await post(t.app, '/tutor/slots', tutor.cookie).send({ startTimes: [start(10)] }).expect(201);
      expect((await post(t.app, `/tutor/slots/${a.id}/reopen`, tutor.cookie).expect(409)).body.error.code).toBe('SLOT_OVERLAP');
      await t.prisma.slot.updateMany({ where: { tutorId: tutor.id, status: 'AVAILABLE' }, data: { deletedAt: new Date() } });
      const ok = await post(t.app, `/tutor/slots/${a.id}/reopen`, tutor.cookie).expect(200);
      expect(ok.body.status).toBe('AVAILABLE');
      await t.prisma.slot.update({ where: { id: a.id }, data: { status: 'CLOSED' } });
      t.clock.set(new Date(future + 12 * HOUR));
      const later = await loginCookie(t.app, tutor.email);
      expect((await post(t.app, `/tutor/slots/${a.id}/reopen`, later).expect(409)).body.error.code).toBe('SLOT_TOO_SOON');
    });

    it('malformed slot id → 400', async () => {
      await send(t, 'patch', '/tutor/slots/xyz', tutor.cookie).send({ startAt: start(1) }).expect(400);
      await send(t, 'delete', '/tutor/slots/xyz', tutor.cookie).expect(400);
    });
  });
});
