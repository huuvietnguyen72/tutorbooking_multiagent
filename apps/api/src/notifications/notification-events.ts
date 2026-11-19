import type { NotificationType, Prisma } from '@prisma/client';
import { formatBookingCode } from '../bookings/booking-code';

type Db = Prisma.TransactionClient;

export interface BookingForNotice {
  id: string;
  code: bigint;
  startAt: Date;
  student: { id: string; fullName: string };
  tutor: { id: string; fullName: string };
}

export type BookingNoticeKind = 'confirmed' | 'cancelled' | 'rescheduled';

const TYPE: Record<BookingNoticeKind, NotificationType> = {
  confirmed: 'BOOKING_CONFIRMED',
  cancelled: 'BOOKING_CANCELLED',
  rescheduled: 'BOOKING_RESCHEDULED',
};

const TITLE: Record<BookingNoticeKind, string> = {
  confirmed: 'Đặt lịch đã được xác nhận',
  cancelled: 'Buổi học đã bị huỷ',
  rescheduled: 'Buổi học đã đổi lịch',
};

const VERB: Record<BookingNoticeKind, string> = {
  confirmed: 'đã được xác nhận',
  cancelled: 'đã bị huỷ',
  rescheduled: 'đã được đổi lịch',
};

/** Vietnam time, the only locale the product serves. */
const when = (d: Date): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);

/** Short body shown in the list; never carries a cancel reason (a student's reason is private, Security A1). */
export function bookingNoticeBody(kind: BookingNoticeKind, booking: BookingForNotice, recipient: 'student' | 'tutor'): string {
  const other = recipient === 'student' ? booking.tutor.fullName : booking.student.fullName;
  return `Booking ${formatBookingCode(booking.code)} với ${other} lúc ${when(booking.startAt)} ${VERB[kind]}.`;
}

/**
 * Writes one notification per party in the caller's transaction (same idea as the email outbox):
 * the notice exists iff the state change committed.
 */
export async function notifyBooking(tx: Db, kind: BookingNoticeKind, booking: BookingForNotice): Promise<void> {
  const parties = [
    { userId: booking.student.id, role: 'student' },
    { userId: booking.tutor.id, role: 'tutor' },
  ] as const;
  await tx.notification.createMany({
    data: parties.map(({ userId, role }) => ({
      userId,
      type: TYPE[kind],
      title: TITLE[kind],
      body: bookingNoticeBody(kind, booking, role),
      bookingId: booking.id,
    })),
  });
}

export async function notifyReview(
  tx: Db,
  review: { tutorId: string; bookingId: string; rating: number },
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: review.tutorId,
      type: 'REVIEW_RECEIVED',
      title: 'Bạn có đánh giá mới',
      body: `Một học viên vừa đánh giá bạn ${review.rating}/5 sao.`,
      bookingId: review.bookingId,
    },
  });
}
