import type { ErrorCode } from './types';

export const API_BASE = '/api/v1';

export interface FieldError {
  field: string;
  code: string;
}

/** Error from the API. `message` is intentionally generic: UI maps `code` to i18n text (see errors.ts). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN';
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get fieldErrors(): FieldError[] {
    const fields = this.details?.fields;
    return Array.isArray(fields) ? (fields as FieldError[]) : [];
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
  }
  const qs = search.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const isForm = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'same-origin',
      // For FormData the browser sets the multipart boundary itself.
      headers: hasBody && !isForm ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
      body: hasBody ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: ErrorCode; details?: Record<string, unknown> } } | undefined)
      ?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.details);
  }
  return payload as T;
}
