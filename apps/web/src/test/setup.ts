import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { resetMockState } from "../mocks/handlers";
import { server } from "../mocks/server";

// Registered explicitly: the '@testing-library/jest-dom/vitest' entry can bind to a different vitest instance.
expect.extend(matchers);

// jsdom lacks these; antd's responsive helpers and Drawer need them.
Object.defineProperty(window, "matchMedia", {
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
// The adapter is installed after server.listen() so that it wraps msw's patched fetch: msw 3 builds a Request from the
// call arguments, and Vitest 5's Request cannot read jsdom Blobs, so a jsdom FormData body is serialised up front.
const JsdomFormData = globalThis.FormData;
// jsdom's File has no arrayBuffer(); read it through FileReader instead.
const readBytes = (file: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
// Builds the multipart payload by hand: neither jsdom's nor the Node-realm Blob is accepted by undici's FormData here.
async function toMultipart(
  form: FormData,
): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----vitest${Math.random().toString(16).slice(2)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      chunks.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        ),
      );
    } else {
      chunks.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`,
        ),
        new Uint8Array(await readBytes(value)),
        enc.encode("\r\n"),
      );
    }
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
function adaptFetch(): void {
  const mswFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? new URL(input, window.location.href).toString()
        : input;
    if (init?.body instanceof JsdomFormData) {
      const { body, contentType } = await toMultipart(init.body);
      return mswFetch(url, {
        ...init,
        body: body as BodyInit,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          "content-type": contentType,
        },
        signal: undefined,
      });
    }
    return mswFetch(url, init ? { ...init, signal: undefined } : init);
  };
}

const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init);
  }
} as typeof Request;

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
  adaptFetch();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockState();
});
afterAll(() => server.close());
