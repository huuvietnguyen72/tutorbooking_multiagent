import { BACKOFF_MINUTES, MAX_ATTEMPTS, MailOutboxWorker } from '../src/mail/mail-outbox.worker';
import { MailTransport, OutgoingMail } from '../src/mail/mail-transport';
import { createTestApp, resetDb, TestApp } from './helpers';

describe('mail outbox worker (T5)', () => {
  let t: TestApp;
  let worker: MailOutboxWorker;
  let sent: OutgoingMail[];
  let failWith: Error | null;

  const enqueue = (template = 'booking_confirmed_student', toEmail = 'a@example.com') =>
    t.prisma.emailOutbox.create({
      data: {
        toEmail,
        template,
        nextAttemptAt: t.clock.now(),
        payload: { bookingCode: 'BK1', studentName: 'An', tutorName: 'Binh', startAt: '2026-12-01T07:00:00Z', endAt: '2026-12-01T08:00:00Z' },
      },
    });
  const row = (id: string) => t.prisma.emailOutbox.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    t = await createTestApp();
    worker = t.app.get(MailOutboxWorker);
    jest.spyOn(t.app.get(MailTransport), 'send').mockImplementation(async (mail) => {
      if (failWith) throw failWith;
      sent.push(mail);
    });
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDb(t.prisma);
    t.clock.set(new Date());
    sent = [];
    failWith = null;
  });

  it('delivers a due row once and marks it SENT', async () => {
    const m = await enqueue();
    expect(await worker.runOnce()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'a@example.com' });
    expect(await row(m.id)).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
    expect((await row(m.id)).sentAt).not.toBeNull();
    expect(await worker.runOnce()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('ignores rows that are not due yet', async () => {
    const m = await enqueue();
    await t.prisma.emailOutbox.update({ where: { id: m.id }, data: { nextAttemptAt: new Date(t.clock.now().getTime() + 60_000) } });
    expect(await worker.runOnce()).toBe(0);
    expect((await row(m.id)).status).toBe('PENDING');
  });

  it('transport failure retries with backoff 1/5/15/15 min and the 5th failure is FAILED', async () => {
    const m = await enqueue();
    failWith = new Error('smtp down');
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const before = t.clock.now();
      expect(await worker.runOnce()).toBe(0);
      const r = await row(m.id);
      expect(r).toMatchObject({ status: 'PENDING', attempts: attempt, lastError: 'smtp down' });
      expect(r.nextAttemptAt.getTime()).toBe(before.getTime() + BACKOFF_MINUTES[attempt - 1] * 60_000);
      // not retried before its time
      expect(await worker.runOnce()).toBe(0);
      expect((await row(m.id)).attempts).toBe(attempt);
      t.clock.set(r.nextAttemptAt);
    }
    await worker.runOnce();
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
    t.clock.set(new Date(t.clock.now().getTime() + 3600_000));
    expect(await worker.runOnce()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('recovers after a transient failure', async () => {
    const m = await enqueue();
    failWith = new Error('blip');
    await worker.runOnce();
    failWith = null;
    t.clock.set(new Date(t.clock.now().getTime() + 61_000));
    expect(await worker.runOnce()).toBe(1);
    expect(await row(m.id)).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
  });

  it('unknown template fails permanently at once, without calling the transport', async () => {
    const m = await enqueue('no_such_template');
    await worker.runOnce();
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(sent).toHaveLength(0);
  });

  it('two workers running in parallel never send the same mail twice', async () => {
    const ids = (await Promise.all(Array.from({ length: 12 }, (_, i) => enqueue('booking_confirmed_student', `u${i}@example.com`)))).map((m) => m.id);
    const counts = await Promise.all([worker.runOnce(), worker.runOnce(), worker.runOnce()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
    expect(new Set(sent.map((s) => s.to)).size).toBe(12);
    expect(sent).toHaveLength(12);
    for (const id of ids) expect((await row(id)).status).toBe('SENT');
  });
});
