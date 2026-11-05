import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetMockState } from '../mocks/handlers';
import { server } from '../mocks/server';

// jsdom lacks these; antd's responsive helpers and Drawer need them.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
window.HTMLElement.prototype.scrollIntoView = () => undefined;

// Node's fetch (undici) rejects jsdom's AbortSignal and relative URLs; adapt it for tests only.
const nodeFetch = globalThis.fetch.bind(globalThis);
// jsdom's FormData/File are not the ones undici understands; rebuild the body with Node's FormData
// (obtained from a parsed Response, because jsdom shadows the global).
const JsdomFormData = globalThis.FormData;
async function toNodeBody(body: BodyInit | null | undefined): Promise<BodyInit | null | undefined> {
  if (!(body instanceof JsdomFormData)) return body;
  const NodeFormData = (
    await new Response('a=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }).formData()
  ).constructor as new () => FormData;
  const out = new NodeFormData();
  for (const [key, value] of body.entries()) {
    if (typeof value === 'string') out.append(key, value);
    else out.append(key, new Blob([await value.arrayBuffer()], { type: value.type }), value.name);
  }
  return out;
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? new URL(input, window.location.href).toString() : input;
  return nodeFetch(url, init ? { ...init, body: await toNodeBody(init.body), signal: undefined } : init);
};

const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init);
  }
} as typeof Request;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockState();
});
afterAll(() => server.close());
