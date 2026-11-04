import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import i18n from './i18n';
import './index.css';

document.title = i18n.t('app.title');

async function enableMocking(): Promise<void> {
  // Dev only: serve the API from MSW handlers generated against docs/openapi.yaml until the backend is up.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MSW === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
