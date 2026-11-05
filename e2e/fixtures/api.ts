import { request, type APIRequestContext } from '@playwright/test';
import { WEB_BASE_URL } from './env';

export interface Booking {
  id: string;
  code: string;
  slotId: string;
  status: string;
  startAt: string;
  endAt: string;
  priceVnd: number;
  holdExpiresAt: string | null;
  rescheduleCount: number;
  tutor: { id: string; fullName: string };
  review: { rating: number; comment: string | null } | null;
  payment: { id?: string; status: string; amountVnd: number; failureReason?: string | null };
  actions?: { cancel: { allowed: boolean; reasonCode?: string | null } };
}

export interface Slot {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

/** Thin JSON client over a cookie-carrying request context. Goes through nginx like the browser does. */
export class Api {
  constructor(readonly ctx: APIRequestContext) {}

  static async fromState(storageState: string): Promise<Api> {
    const ctx = await request.newContext({
      baseURL: WEB_BASE_URL,
      storageState,
      // The API's CSRF check wants the SPA origin on every write.
      extraHTTPHeaders: { Origin: WEB_BASE_URL },
    });
    return new Api(ctx);
  }

  static async anonymous(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: WEB_BASE_URL, extraHTTPHeaders: { Origin: WEB_BASE_URL } }));
  }

  async send<T>(method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }> {
    const res = await this.ctx[method](`/api/v1${path}`, { data, headers });
    const text = await res.text();
    return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
  }

  private async ok<T>(method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown, headers?: Record<string, string>): Promise<T> {
    const res = await this.send<T>(method, path, data, headers);
    if (res.status >= 300) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  get = <T>(path: string) => this.ok<T>('get', path);
  post = <T>(path: string, data?: unknown) => this.ok<T>('post', path, data);

  async login(email: string, password: string): Promise<void> {
    await this.post('/auth/login', { email, password });
  }

  /** Tutor: create one slot. Retries with a fresh random time when it collides with an existing slot. */
  async createSlot(startAt: Date): Promise<Slot> {
    const res = await this.send<Slot[]>('post', '/tutor/slots', { startTimes: [startAt.toISOString()] });
    if (res.status !== 201) throw new Error(`createSlot ${startAt.toISOString()} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body[0];
  }

  /** Student: hold a slot (PENDING_PAYMENT). */
  createBooking(slotId: string) {
    return this.post<{ booking: Booking; checkoutUrl: string; serverTime: string }>('/bookings', { slotId });
  }

  booking(id: string) {
    return this.get<Booking>(`/bookings/${id}`);
  }

  /** Student: simulate the gateway page. `paymentId` is the last segment of the checkout URL. */
  completePayment(paymentId: string, result: 'SUCCESS' | 'FAILURE') {
    return this.post<{ redirectUrl: string }>(`/mock-gateway/payments/${paymentId}/complete`, { result });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

export const paymentIdOf = (checkoutUrl: string): string => checkoutUrl.split('/').filter(Boolean).pop() ?? '';
