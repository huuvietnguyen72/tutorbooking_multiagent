import type { Me } from '../api/types';

export const ROUTES = {
  home: '/',
  tutors: '/gia-su',
  tutor: (id: string) => `/gia-su/${id}`,
  login: '/dang-nhap',
  register: '/dang-ky',
  forcePassword: '/doi-mat-khau',
  account: '/tai-khoan',
  forbidden: '/403',
  notFound: '/404',
  error: '/loi',
  book: (slotId: string) => `/dat-lich/${slotId}`,
  myBookings: '/lich-cua-toi',
  booking: (bookingId: string) => `/lich-cua-toi/${bookingId}`,
  reschedule: (bookingId: string) => `/lich-cua-toi/${bookingId}/doi-lich`,
  pay: (bookingId: string) => `/thanh-toan/${bookingId}`,
  payResult: (bookingId: string) => `/thanh-toan/${bookingId}/ket-qua`,
  gateway: (paymentId: string) => `/cong-thanh-toan-gia-lap/${paymentId}`,
  tutorGate: '/gia-su/trang-thai',
  tutorProfile: '/gia-su/ho-so-cua-toi',
  tutorSlots: '/gia-su/lich-trong',
  tutorSessions: '/gia-su/buoi-day',
  tutorSession: (bookingId: string) => `/gia-su/buoi-day/${bookingId}`,
  tutorEarnings: '/gia-su/thu-nhap',
  tutorReviews: '/gia-su/danh-gia',
  admin: '/admin',
  adminTutors: '/admin/gia-su-cho-duyet',
  adminUsers: '/admin/nguoi-dung',
  adminBookings: '/admin/booking',
  adminBooking: (id: string) => `/admin/booking/${id}`,
  adminAudit: '/admin/nhat-ky',
  adminEarnings: '/admin/doi-soat',
} as const;

/**
 * Destination for a signed-in user who is still on the login/register screen.
 * Guests arrive with `?next=` (already sanitised by `safeNext`); honour it unless the account must
 * change its password. Registration only honours `next` for students — a tutor's home is the approval gate.
 */
export function postAuthHome(me: Me, next: string | null, via: 'login' | 'register'): string {
  if (me.mustChangePassword) return ROUTES.forcePassword;
  if (via === 'register' && me.role !== 'STUDENT') return defaultHome(me);
  return next ?? defaultHome(me);
}

/** Where a user lands right after login (design §2.5). */
export function defaultHome(me: Me): string {
  switch (me.role) {
    case 'ADMIN':
      return ROUTES.admin;
    case 'TUTOR':
      return me.tutorApprovalStatus === 'APPROVED' ? ROUTES.tutorSessions : ROUTES.tutorGate;
    default:
      return ROUTES.tutors;
  }
}
