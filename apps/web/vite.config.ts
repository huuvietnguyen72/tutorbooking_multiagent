import { createRequire } from 'node:module';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// @ant-design/icons@6 maps the `node` import condition to a CJS build that
// require()s the ESM-only @ant-design/colors@8, which fails on Node < 22.12.
// Point vitest at the ESM build instead so it is transformed by vite-node.
const antIconsEs = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@ant-design/icons/package.json')),
  'es/index.js',
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: process.env.VITEST ? [{ find: /^@ant-design\/icons$/, replacement: antIconsEs }] : [],
  },
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
    server: { deps: { inline: ['@testing-library/jest-dom', /@ant-design\//] } },
    css: false,
    // Keep the antd/jsdom suites from competing for CPU on small CI runners.
    maxWorkers: 1,
    // antd + jsdom is slow on first render
    testTimeout: 20000,
  },
});
