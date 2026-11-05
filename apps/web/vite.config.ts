import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // Resolve jest-dom against this test runner, including linked workspace installs.
    server: { deps: { inline: ['@testing-library/jest-dom'] } },
    css: false,
    // antd + jsdom is slow on first render
    testTimeout: 20000,
  },
});
