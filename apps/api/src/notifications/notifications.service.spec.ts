import { AppError } from '../common/app-error';
import { FixedClock } from '../common/clock';
import type { PrismaService } from '../common/prisma.service';
import { bookingNoticeBody, notifyBooking, notifyReview } from './notification-events';
import { NotificationsService } from './notifications.service';

interface Row {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  bookingId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

type Where = { id?: string; userId: string; readAt?: null };
const matches = (r: Row, w: Where): boolean =>
  (w.id === undefined || r.id === w.id) && r.userId === w.userId && (w.readAt === undefined || r.readAt === null);

/** In-memory stand-in honouring only the `where` clauses the service uses. */
function fakePrisma(rows: Row[]): PrismaService {
  const notification = {
    findMany: async ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length,
    findFirst: async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null,
    updateMany: async ({ where, data }: { where: Where; data: { readAt: Date } }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => (r.readAt = data.readAt));
      return { count: hit.length };
    },
  };
  return { notification, $transaction: (ps: Promise<unknown>[]) => Promise.all(ps) } as unknown as PrismaService;
}

const now = new Date('2026-12-01T00:00:00Z');
const row = (id: string, userId: string, minute: number, read = false): Row => ({
  id,
  userId,
  type: 'BOOKING_CONFIRMED',
  title: 't',
  body: 'b',
  bookingId: null,
  readAt: read ? new Date('2026-11-30T00:00:00Z') : null,
  createdAt: new Date(now.getTime() + minute * 60_000),
});

const setup = () => {
  const rows = [row('n1', 'alice', 1), row('n2', 'alice', 2, true), row('n3', 'alice', 3), row('x1', 'bob', 1)];
  return { rows, svc: new NotificationsService(fakePrisma(rows), new FixedClock(now)) };
};

describe('NotificationsService', () => {
  it('lists only own notifications, newest first, paginated', async () => {
    const { svc } = setup();
    const page = await svc.list('alice', 1, 2, false);
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.id)).toEqual(['n3', 'n2']);
    expect((await svc.list('alice', 2, 2, false)).items.map((i) => i.id)).toEqual(['n1']);
  });

  it('filters unread only and counts unread', async () => {
    const { svc } = setup();
    expect((await svc.list('alice', 1, 20, true)).items.map((i) => i.id)).toEqual(['n3', 'n1']);
    expect(await svc.unreadCount('alice')).toEqual({ count: 2 });
    expect(await svc.unreadCount('bob')).toEqual({ count: 1 });
  });

  it('marks one read and is idempotent', async () => {
    const { svc } = setup();
    const first = await svc.markRead('alice', 'n1');
    expect(first.isRead).toBe(true);
    expect(first.readAt).toBe(now.toISOString());
    expect((await svc.markRead('alice', 'n2')).readAt).toBe('2026-11-30T00:00:00.000Z');
  });

  it("cannot read or mark another user's notification (404, left untouched)", async () => {
    const { svc, rows } = setup();
    await expect(svc.markRead('alice', 'x1')).rejects.toBeInstanceOf(AppError);
    await expect(svc.markRead('alice', 'missing')).rejects.toBeInstanceOf(AppError);
    expect(rows.find((r) => r.id === 'x1')?.readAt).toBeNull();
    expect((await svc.list('alice', 1, 20, false)).items.some((i) => i.id === 'x1')).toBe(false);
  });

  it('read-all only touches the caller', async () => {
    const { svc, rows } = setup();
    expect(await svc.markAllRead('alice')).toEqual({ updated: 2 });
    expect(await svc.unreadCount('alice')).toEqual({ count: 0 });
    expect(rows.find((r) => r.id === 'x1')?.readAt).toBeNull();
  });
});

describe('notification events', () => {
  const booking = {
    id: 'b1',
    code: 42n,
    startAt: new Date('2026-12-05T02:00:00Z'),
    student: { id: 's1', fullName: 'Học Viên' },
    tutor: { id: 't1', fullName: 'Gia Sư' },
  };

  it('writes one notice per party and names the counterpart', async () => {
    const createMany = jest.fn();
    await notifyBooking({ notification: { createMany } } as never, 'cancelled', booking);
    const { data } = createMany.mock.calls[0][0];
    expect(data.map((d: { userId: string }) => d.userId)).toEqual(['s1', 't1']);
    expect(data[0].type).toBe('BOOKING_CANCELLED');
    expect(data[0].body).toContain('Gia Sư');
    expect(data[1].body).toContain('Học Viên');
    expect(data[0].bookingId).toBe('b1');
  });

  it('body never contains a cancel reason field', () => {
    expect(bookingNoticeBody('rescheduled', booking, 'student')).toContain('đổi lịch');
  });

  it('notifies the tutor of a new review', async () => {
    const create = jest.fn();
    await notifyReview({ notification: { create } } as never, { tutorId: 't1', bookingId: 'b1', rating: 5 });
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: 't1', type: 'REVIEW_RECEIVED', bookingId: 'b1' });
  });
});
