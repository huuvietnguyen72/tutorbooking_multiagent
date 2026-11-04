import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export const ME_KEY = ['me'] as const;

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => handleGlobal(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => handleGlobal(client, error) }),
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
  return client;
}

/** Session changed server-side (expired, forced password change): re-read `/me` so route guards react. */
function handleGlobal(client: QueryClient, error: unknown): void {
  if (error instanceof ApiError && (error.code === 'UNAUTHENTICATED' || error.code === 'PASSWORD_CHANGE_REQUIRED')) {
    void client.invalidateQueries({ queryKey: ME_KEY });
  }
}
