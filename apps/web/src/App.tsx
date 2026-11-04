import { RouterProvider } from 'react-router-dom';
import { useMemo } from 'react';
import AppProviders from './AppProviders';
import { createQueryClient } from './api/queryClient';
import { createRouter } from './router';

export default function App() {
  const client = useMemo(() => createQueryClient(), []);
  const router = useMemo(() => createRouter(), []);
  return (
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
