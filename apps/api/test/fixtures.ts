import { randomUUID } from 'node:crypto';
import { insertUser, loginCookie, TestApp } from './helpers';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const UUID0 = '00000000-0000-4000-8000-000000000000';

export interface User {
  id: string;
  email: string;
  cookie: string;
}

/** Row factories shared by the T5 specs; bookings are inserted directly so tests need not replay the payment flow. */
export function fixtures(t: TestApp) {
  const addUser = async (role: 'STUDENT' | 'TUTOR' | 'ADMIN', name?: string): Promise<User> => {
    const user = await insertUser(t.prisma, role);
    if (name) await t.prisma.user.update({ where: { id: user.id }, data: { fullName: name } });
    return { id: user.id, email: user.email, cookie: await loginCookie(t.app, user.email) };
  };

  const addTutor = async (
    opts: { status?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; price?: number | null; name?: string } = {},
  ): Promise<User> => {
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

  /** Slot starting `inMs` after the fake clock's now, rounded up to the hour. */
  const addSlot = (tutorId: string, inMs = 48 * HOUR, opts: { status?: 'AVAILABLE' | 'BOOKED' | 'CLOSED'; durationMs?: number } = {}) => {
    const startAt = new Date(Math.ceil((t.clock.now().getTime() + inMs) / HOUR) * HOUR);
    return t.prisma.slot.create({
      data: { tutorId, startAt, endAt: new Date(startAt.getTime() + (opts.durationMs ?? HOUR)), status: opts.status ?? 'AVAILABLE' },
    });
  };

  /** A CONFIRMED + PAID booking on a fresh BOOKED slot starting in `inMs`. */
  const confirmedBooking = async (student: User, tutor: User, inMs = 72 * HOUR, priceVnd = 300_000) => {
    const slot = await addSlot(tutor.id, inMs, { status: 'BOOKED' });
    const booking = await t.prisma.booking.create({
      data: {
        studentId: student.id,
        tutorId: tutor.id,
        slotId: slot.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        priceVnd,
        status: 'CONFIRMED',
        payment: {
          create: { provider: 'mock', providerRef: `test:${randomUUID()}`, amountVnd: priceVnd, status: 'PAID', paidAt: t.clock.now() },
        },
      },
      include: { payment: true },
    });
    return { booking, slot, payment: booking.payment! };
  };

  /** Moves the fake clock; cookies are clock-bound (8h), so the actors log in again. */
  const jump = async (to: Date, who: User[]) => {
    t.clock.set(to);
    for (const u of who) u.cookie = await loginCookie(t.app, u.email);
  };

  return { addUser, addTutor, addSlot, confirmedBooking, jump };
}
