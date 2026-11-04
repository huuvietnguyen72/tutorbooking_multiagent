import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { RouterProvider } from 'react-router-dom';
import '../i18n';
import { createQueryClient } from '../api/queryClient';
import { createTestRouter } from '../router';

/** Renders the real route table at `path`, with MSW answering the API. */
export function renderApp(path: string) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const router = createTestRouter([path]);
  const utils = render(
    <AntApp>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AntApp>,
  );
  return { ...utils, router };
}
