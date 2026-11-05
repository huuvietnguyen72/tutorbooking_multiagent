import { request } from './client';
import type {
  LoginRequest,
  Me,
  PublicConfig,
  PublicReviewPage,
  PublicSlot,
  RegisterRequest,
  Subject,
  TeachingScope,
  TutorBooking,
  TutorBookingPage,
  TutorOwnProfile,
  TutorProfileInput,
  TutorPublic,
  TutorSlot,
  TutorSearchParams,
  TutorSummaryPage,
} from './types';

export const api = {
  getPublicConfig: (signal?: AbortSignal) => request<PublicConfig>('GET', '/config/public', { signal }),

  register: (body: RegisterRequest) => request<Me>('POST', '/auth/register', { body }),
  login: (body: LoginRequest) => request<Me>('POST', '/auth/login', { body }),
  logout: () => request<void>('POST', '/auth/logout'),
  getMe: (signal?: AbortSignal) => request<Me>('GET', '/me', { signal }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<void>('POST', '/me/password', { body }),

  listSubjects: (signal?: AbortSignal) => request<Subject[]>('GET', '/subjects', { signal }),
  searchTutors: (params: TutorSearchParams, signal?: AbortSignal) =>
    request<TutorSummaryPage>('GET', '/tutors', { query: { ...params }, signal }),
  getTutor: (tutorId: string, signal?: AbortSignal) =>
    request<TutorPublic>('GET', `/tutors/${encodeURIComponent(tutorId)}`, { signal }),
  listTutorSlots: (tutorId: string, from: string, to: string, signal?: AbortSignal) =>
    request<PublicSlot[]>('GET', `/tutors/${encodeURIComponent(tutorId)}/slots`, {
      query: { from, to },
      signal,
    }),
  listTutorReviews: (tutorId: string, page: number, pageSize: number, signal?: AbortSignal) =>
    request<PublicReviewPage>('GET', `/tutors/${encodeURIComponent(tutorId)}/reviews`, {
      query: { page, pageSize },
      signal,
    }),

  getMyTutorProfile: (signal?: AbortSignal) => request<TutorOwnProfile>('GET', '/tutor/profile', { signal }),
  updateMyTutorProfile: (body: TutorProfileInput) => request<TutorOwnProfile>('PUT', '/tutor/profile', { body }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<TutorOwnProfile>('PUT', '/tutor/profile/avatar', { body: form });
  },
  resubmitTutorProfile: () => request<TutorOwnProfile>('POST', '/tutor/profile/submit'),

  listMySlots: (from: string, to: string, signal?: AbortSignal) =>
    request<TutorSlot[]>('GET', '/tutor/slots', { query: { from, to }, signal }),
  createSlots: (startTimes: string[]) => request<TutorSlot[]>('POST', '/tutor/slots', { body: { startTimes } }),
  moveSlot: (slotId: string, startAt: string) =>
    request<TutorSlot>('PATCH', `/tutor/slots/${encodeURIComponent(slotId)}`, { body: { startAt } }),
  deleteSlot: (slotId: string) => request<void>('DELETE', `/tutor/slots/${encodeURIComponent(slotId)}`),
  reopenSlot: (slotId: string) => request<TutorSlot>('POST', `/tutor/slots/${encodeURIComponent(slotId)}/reopen`),

  listMyTeachingBookings: (scope: TeachingScope, page: number, pageSize: number, signal?: AbortSignal) =>
    request<TutorBookingPage>('GET', '/tutor/bookings', { query: { scope, page, pageSize }, signal }),
  getMyTeachingBooking: (bookingId: string, signal?: AbortSignal) =>
    request<TutorBooking>('GET', `/tutor/bookings/${encodeURIComponent(bookingId)}`, { signal }),
  tutorCancelBooking: (bookingId: string, reason: string) =>
    request<TutorBooking>('POST', `/tutor/bookings/${encodeURIComponent(bookingId)}/cancel`, { body: { reason } }),
  listMyReviews: (page: number, pageSize: number, signal?: AbortSignal) =>
    request<PublicReviewPage>('GET', '/tutor/reviews', { query: { page, pageSize }, signal }),
};
