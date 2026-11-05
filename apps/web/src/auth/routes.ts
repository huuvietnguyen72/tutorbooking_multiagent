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
  adminBooking: (id: string) => `/admin/booking/${id}`,
  adminAudit: '/admin/nhat-ky',
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
