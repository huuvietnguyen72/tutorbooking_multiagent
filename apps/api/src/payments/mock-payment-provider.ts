import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { SIGNATURE_HEADER, verifyMockSignature } from './mock-signature';
import { PaymentProvider, VerifiedPaymentEvent } from './payment-provider';

export const mockEventSchema = z
  .object({
    eventId: z.string().regex(/^evt_[0-9a-f-]{36}$/),
    providerRef: z.string().min(1).max(64),
    outcome: z.enum(['SUCCEEDED', 'FAILED']),
    amountVnd: z.number().int().min(1),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type MockEventBody = z.input<typeof mockEventSchema>;

/** Browser-facing route of the SPA mock gateway page (S-08). */
export const mockCheckoutPath = (paymentId: string): string => `/cong-thanh-toan-gia-lap/${paymentId}`;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  constructor(
    private readonly webhookSecret: string,
    private readonly clock: Clock,
  ) {}

  async createPayment(input: { paymentId: string }): Promise<{ providerRef: string; checkoutUrl: string }> {
    // 128-bit random reference, used only in the signed webhook body; never in a URL (B6).
    return { providerRef: `mock_${randomBytes(16).toString('hex')}`, checkoutUrl: mockCheckoutPath(input.paymentId) };
  }

  checkoutUrl(paymentId: string): string {
    return mockCheckoutPath(paymentId);
  }

  async verifyCallback(req: {
    headers: Record<string, string | undefined>;
    rawBody: Buffer;
  }): Promise<VerifiedPaymentEvent> {
    verifyMockSignature(this.webhookSecret, req.headers[SIGNATURE_HEADER], req.rawBody, this.clock.now());
    let json: unknown;
    try {
      json = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw AppError.validation([{ field: '(body)', code: 'invalid_json' }]);
    }
    const parsed = mockEventSchema.safeParse(json);
    if (!parsed.success) {
      throw AppError.validation(parsed.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', code: i.code })));
    }
    return { ...parsed.data, occurredAt: new Date(parsed.data.occurredAt) };
  }

  async refund(input: { idempotencyKey: string }): Promise<{ refundRef: string; status: 'REFUNDED' }> {
    return { refundRef: `mock_refund_${input.idempotencyKey}`, status: 'REFUNDED' };
  }
}
