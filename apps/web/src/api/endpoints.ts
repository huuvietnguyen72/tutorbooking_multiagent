import { request } from './client';
import type {
  LoginRequest,
  Me,
  PublicConfig,
  PublicReviewPage,
  PublicSlot,
  RegisterRequest,
  Subject,
  TutorPublic,
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
};
