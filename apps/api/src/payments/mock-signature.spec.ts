import { signMockWebhook, verifyMockSignature } from './mock-signature';
import { InvalidSignatureError } from './payment-provider';

const secret = 'unit-test-secret-'.padEnd(40, 'x');
const now = new Date('2026-12-01T00:00:00Z');
const body = Buffer.from('{"eventId":"evt_x"}');
const reason = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof InvalidSignatureError ? e.reason : 'other';
  }
};

describe('mock webhook signature (HMAC-SHA256 over t.rawBody)', () => {
  it('accepts a correctly signed body', () => {
    expect(reason(() => verifyMockSignature(secret, signMockWebhook(secret, now, body), body, now))).toBeNull();
  });

  it('rejects missing and malformed headers', () => {
    expect(reason(() => verifyMockSignature(secret, undefined, body, now))).toBe('missing');
    expect(reason(() => verifyMockSignature(secret, 'v1=abc', body, now))).toBe('malformed');
    expect(reason(() => verifyMockSignature(secret, 't=1,v1=zz', body, now))).toBe('malformed');
  });

  it('rejects a wrong secret, a tampered body and a tampered timestamp', () => {
    const header = signMockWebhook(secret, now, body);
    expect(reason(() => verifyMockSignature('other-secret'.padEnd(40, 'y'), header, body, now))).toBe('mismatch');
    expect(reason(() => verifyMockSignature(secret, header, Buffer.from('{"eventId":"evt_y"}'), now))).toBe('mismatch');
    expect(reason(() => verifyMockSignature(secret, header.replace(/t=\d+/, 't=1'), body, now))).toBe('mismatch');
  });

  it('enforces |now - t| <= 300s', () => {
    const header = signMockWebhook(secret, now, body);
    expect(reason(() => verifyMockSignature(secret, header, body, new Date(now.getTime() + 300_000)))).toBeNull();
    expect(reason(() => verifyMockSignature(secret, header, body, new Date(now.getTime() + 301_000)))).toBe('stale');
    expect(reason(() => verifyMockSignature(secret, header, body, new Date(now.getTime() - 301_000)))).toBe('stale');
  });
});
