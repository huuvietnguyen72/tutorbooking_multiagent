import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints';
import { ApiError } from './client';
import { ME_KEY } from './queryClient';
import type { Me, RegisterRequest, StudentScope, TeachingScope, TutorProfileInput, TutorSearchParams } from './types';

/** `null` = not logged in. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await api.getMe(signal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (me) => qc.setQueryData(ME_KEY, me),
  });
}

/** The API's register response does not set a session cookie, so log in right after creating the account. */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RegisterRequest) => {
      await api.register(body);
      return api.login({ email: body.email, password: body.password });
    },
    onSuccess: (me) => qc.setQueryData(ME_KEY, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: ({ signal }) => api.getPublicConfig(signal),
    staleTime: 10 * 60_000,
  });
}

export function useSubjects() {
  return useQuery({
    queryKey: ['subjects'],
    queryFn: ({ signal }) => api.listSubjects(signal),
    staleTime: 10 * 60_000,
  });
}

export function useTutors(params: TutorSearchParams) {
  return useQuery({
    queryKey: ['tutors', params],
    queryFn: ({ signal }) => api.searchTutors(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useTutor(tutorId: string) {
  return useQuery({
    queryKey: ['tutor', tutorId],
    queryFn: ({ signal }) => api.getTutor(tutorId, signal),
  });
}

export function useTutorSlots(tutorId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['tutor', tutorId, 'slots', from, to],
    enabled: !!tutorId,
    queryFn: ({ signal }) => api.listTutorSlots(tutorId, from, to, signal),
  });
}

export function useTutorReviews(tutorId: string, page: number, pageSize = 5) {
  return useQuery({
    queryKey: ['tutor', tutorId, 'reviews', page, pageSize],
    queryFn: ({ signal }) => api.listTutorReviews(tutorId, page, pageSize, signal),
  });
}

// ---- tutor self-service (T7). All keys start with 'my' so they never collide with the public 'tutor' keys. ----

export function useMyProfile() {
  return useQuery({
    queryKey: ['my', 'profile'],
    queryFn: ({ signal }) => api.getMyTutorProfile(signal),
  });
}

/** Saving or resubmitting changes `approvalStatus`, which `useMe` mirrors, so refresh both. */
function useProfileMutation<V>(mutationFn: (values: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my', 'profile'] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export const useSaveProfile = () => useProfileMutation((body: TutorProfileInput) => api.updateMyTutorProfile(body));
export const useResubmitProfile = () => useProfileMutation(() => api.resubmitTutorProfile());
export const useUploadAvatar = () => useProfileMutation((file: File) => api.uploadAvatar(file));

export function useMySlots(from: string, to: string) {
  return useQuery({
    queryKey: ['my', 'slots', from, to],
    queryFn: ({ signal }) => api.listMySlots(from, to, signal),
  });
}

function useSlotMutation<V, R>(mutationFn: (values: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my', 'slots'] }),
  });
}

export const useCreateSlots = () => useSlotMutation((startTimes: string[]) => api.createSlots(startTimes));
export const useMoveSlot = () =>
  useSlotMutation((v: { slotId: string; startAt: string }) => api.moveSlot(v.slotId, v.startAt));
export const useDeleteSlot = () => useSlotMutation((slotId: string) => api.deleteSlot(slotId));
export const useReopenSlot = () => useSlotMutation((slotId: string) => api.reopenSlot(slotId));

export function useMyTeachingBookings(scope: TeachingScope, page: number, pageSize = 10) {
  return useQuery({
    queryKey: ['my', 'bookings', scope, page, pageSize],
    queryFn: ({ signal }) => api.listMyTeachingBookings(scope, page, pageSize, signal),
    placeholderData: keepPreviousData,
  });
}

export function useMyTeachingBooking(bookingId: string) {
  return useQuery({
    queryKey: ['my', 'booking', bookingId],
    queryFn: ({ signal }) => api.getMyTeachingBooking(bookingId, signal),
  });
}

export function useTutorCancelBooking(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.tutorCancelBooking(bookingId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my', 'bookings'] });
      void qc.invalidateQueries({ queryKey: ['my', 'booking', bookingId] });
      void qc.invalidateQueries({ queryKey: ['my', 'slots'] });
    },
  });
}

export function useMyReviews(page: number, pageSize = 10) {
  return useQuery({
    queryKey: ['my', 'reviews', page, pageSize],
    queryFn: ({ signal }) => api.listMyReviews(page, pageSize, signal),
    placeholderData: keepPreviousData,
  });
}

// ---- student flow (T8). Keys start with 'student' so the tutor-side 'my' keys stay untouched. ----

export function useSlot(slotId: string) {
  return useQuery({
    queryKey: ['slot', slotId],
    queryFn: ({ signal }) => api.getSlot(slotId, signal),
    retry: false,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slotId: string; idempotencyKey?: string }) => api.createBooking(v.slotId, v.idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['student', 'bookings'] });
      void qc.invalidateQueries({ queryKey: ['tutor'] });
    },
  });
}

export function useStudentBookings(scope: StudentScope, page: number, pageSize = 10) {
  return useQuery({
    queryKey: ['student', 'bookings', scope, page, pageSize],
    queryFn: ({ signal }) => api.listMyBookings(scope, page, pageSize, signal),
    placeholderData: keepPreviousData,
  });
}

interface BookingQueryOptions {
  /** ms between refetches, or `false`/`undefined` to stop. */
  refetchInterval?: number | false;
}

/** Single booking incl. `serverTime`. Always revalidated on mount: the server may have expired the hold meanwhile. */
export function useStudentBooking(bookingId: string, options: BookingQueryOptions = {}) {
  return useQuery({
    queryKey: ['student', 'booking', bookingId],
    queryFn: ({ signal }) => api.getMyBooking(bookingId, signal),
    staleTime: 0,
    refetchInterval: options.refetchInterval || false,
  });
}

/** After any booking mutation both the lists and the detail change, and slots may reopen. */
function useBookingMutation<V, R>(bookingId: string, mutationFn: (values: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['student'] });
      void qc.invalidateQueries({ queryKey: ['tutor'] });
      void qc.invalidateQueries({ queryKey: ['slot'] });
    },
    meta: { bookingId },
  });
}

export const useResumeCheckout = (bookingId: string) => useBookingMutation(bookingId, () => api.resumeCheckout(bookingId));
export const useStudentCancel = (bookingId: string) =>
  useBookingMutation(bookingId, (reason?: string) => api.studentCancelBooking(bookingId, reason));
export const useReschedule = (bookingId: string) =>
  useBookingMutation(bookingId, (newSlotId: string) => api.rescheduleBooking(bookingId, newSlotId));
export const useReviewBooking = (bookingId: string) =>
  useBookingMutation(bookingId, (v: { rating: number; comment?: string }) => api.reviewBooking(bookingId, v));

export function useGatewayPayment(paymentId: string) {
  return useQuery({
    queryKey: ['student', 'gateway', paymentId],
    queryFn: ({ signal }) => api.getMockGatewayPayment(paymentId, signal),
    staleTime: 0,
    retry: false,
  });
}

export const useCompleteGatewayPayment = (paymentId: string) =>
  useMutation({ mutationFn: (result: 'SUCCESS' | 'FAILURE') => api.completeMockGatewayPayment(paymentId, result) });
