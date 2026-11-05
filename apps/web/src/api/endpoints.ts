import { request } from './client';
import type {
  Booking,
  BookingPage,
  CheckoutResponse,
  MockGatewayPayment,
  Review,
  SlotDetail,
  StudentScope,
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

  getSlot: (slotId: string, signal?: AbortSignal) =>
    request<SlotDetail>('GET', `/slots/${encodeURIComponent(slotId)}`, { signal }),

  createBooking: (slotId: string, idempotencyKey?: string) =>
    request<CheckoutResponse>('POST', '/bookings', { body: { slotId }, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined }),
  listMyBookings: (scope: StudentScope, page: number, pageSize: number, signal?: AbortSignal) =>
    request<BookingPage>('GET', '/bookings', { query: { scope, page, pageSize }, signal }),
  getMyBooking: (bookingId: string, signal?: AbortSignal) =>
    request<Booking>('GET', `/bookings/${encodeURIComponent(bookingId)}`, { signal }),
  resumeCheckout: (bookingId: string) =>
    request<CheckoutResponse>('POST', `/bookings/${encodeURIComponent(bookingId)}/checkout`),
  studentCancelBooking: (bookingId: string, reason?: string) =>
    request<Booking>('POST', `/bookings/${encodeURIComponent(bookingId)}/cancel`, { body: reason ? { reason } : {} }),
  rescheduleBooking: (bookingId: string, newSlotId: string) =>
    request<Booking>('POST', `/bookings/${encodeURIComponent(bookingId)}/reschedule`, { body: { newSlotId } }),
  reviewBooking: (bookingId: string, body: { rating: number; comment?: string }) =>
    request<Review>('POST', `/bookings/${encodeURIComponent(bookingId)}/review`, { body }),

  getMockGatewayPayment: (paymentId: string, signal?: AbortSignal) =>
    request<MockGatewayPayment>('GET', `/mock-gateway/payments/${encodeURIComponent(paymentId)}`, { signal }),
  completeMockGatewayPayment: (paymentId: string, result: 'SUCCESS' | 'FAILURE') =>
    request<{ redirectUrl: string }>('POST', `/mock-gateway/payments/${encodeURIComponent(paymentId)}/complete`, { body: { result } }),
};
