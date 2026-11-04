/** Injection token for the active provider (`PAYMENT_PROVIDER`). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export class InvalidSignatureError extends Error {
  constructor(readonly reason: 'missing' | 'malformed' | 'stale' | 'mismatch') {
    super(`Invalid webhook signature (${reason})`);
  }
}

export interface VerifiedPaymentEvent {
  eventId: string;
  providerRef: string;
  outcome: 'SUCCEEDED' | 'FAILED';
  amountVnd: number;
  occurredAt: Date;
}

/** docs/architecture.md §2.9. `PaymentsService` depends on this interface only. */
export interface PaymentProvider {
  readonly name: 'mock' | 'vnpay';
  /** Starts a payment session; never changes booking state. */
  createPayment(input: {
    paymentId: string;
    bookingId: string;
    amountVnd: number;
    description: string;
    returnUrl: string;
    expiresAt: Date;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  /** Where the shopper continues an already-created payment (resume checkout). */
  checkoutUrl(paymentId: string): string;
  /** Authenticates a callback/webhook. Throws `InvalidSignatureError`; touches no DB. */
  verifyCallback(req: { headers: Record<string, string | undefined>; rawBody: Buffer }): Promise<VerifiedPaymentEvent>;
  /** Idempotent on `idempotencyKey`. */
  refund(input: {
    paymentId: string;
    providerRef: string;
    amountVnd: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ refundRef: string; status: 'REFUNDED' }>;
}
