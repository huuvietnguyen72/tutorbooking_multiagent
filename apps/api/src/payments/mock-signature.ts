import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidSignatureError } from './payment-provider';

export const SIGNATURE_HEADER = 'x-mock-signature';
export const MAX_SKEW_SECONDS = 300;
export const MAX_WEBHOOK_BYTES = 4096;

const HEADER_FORMAT = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

const mac = (secret: string, t: number, rawBody: Buffer): Buffer =>
  createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();

/** `X-Mock-Signature: t=<unix>,v1=<hex(HMAC_SHA256(secret, t + "." + rawBody))>` */
export function signMockWebhook(secret: string, now: Date, rawBody: Buffer): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${mac(secret, t, rawBody).toString('hex')}`;
}

/** Verifies on the raw bytes, before any JSON parsing. Constant-time compare, length checked first. */
export function verifyMockSignature(secret: string, header: string | undefined, rawBody: Buffer, now: Date): void {
  if (!header) throw new InvalidSignatureError('missing');
  const match = HEADER_FORMAT.exec(header);
  if (!match) throw new InvalidSignatureError('malformed');
  const t = Number(match[1]);
  const given = Buffer.from(match[2], 'hex');
  const expected = mac(secret, t, rawBody);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InvalidSignatureError('mismatch');
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > MAX_SKEW_SECONDS) throw new InvalidSignatureError('stale');
}
