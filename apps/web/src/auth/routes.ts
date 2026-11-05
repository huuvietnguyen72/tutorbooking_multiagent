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
  tutorReviews: '/gia-su/danh-gia',
  admin: '/admin',
  adminTutors: '/admin/gia-su-cho-duyet',
  adminUsers: '/admin/nguoi-dung',
  adminBookings: '/admin/booking',
} as const;

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
