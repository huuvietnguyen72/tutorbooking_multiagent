import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints';
import { ApiError } from './client';
import { ME_KEY } from './queryClient';
import type { Me, RegisterRequest, TutorSearchParams } from './types';

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
    queryFn: ({ signal }) => api.listTutorSlots(tutorId, from, to, signal),
  });
}

export function useTutorReviews(tutorId: string, page: number, pageSize = 5) {
  return useQuery({
    queryKey: ['tutor', tutorId, 'reviews', page, pageSize],
    queryFn: ({ signal }) => api.listTutorReviews(tutorId, page, pageSize, signal),
  });
}
