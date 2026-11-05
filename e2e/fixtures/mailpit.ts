import { expect } from '@playwright/test';
import { MAILPIT_URL } from './env';

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export interface MailMessage extends MailSummary {
  Text: string;
}

const api = (path: string) => `${MAILPIT_URL}/api/v1${path}`;

async function list(): Promise<MailSummary[]> {
  const res = await fetch(api('/messages?limit=200'));
  if (!res.ok) throw new Error(`Mailpit list -> ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages ?? [];
}

/** Mails whose subject mentions this booking code (subjects are "Đặt lịch #BK-1 thành công", "Buổi học #BK-1 đã bị huỷ", ...). */
export async function mailsFor(code: string, subjectPart?: string): Promise<MailSummary[]> {
  return (await list()).filter((m) => m.Subject.includes(code) && (!subjectPart || m.Subject.includes(subjectPart)));
}

/** Polls Mailpit until `count` matching mails arrived (the outbox worker sends asynchronously). */
export async function waitForMails(code: string, subjectPart: string, count = 2): Promise<MailMessage[]> {
  let found: MailSummary[] = [];
  await expect
    .poll(async () => (found = await mailsFor(code, subjectPart)).length, { timeout: 40_000, intervals: [1000, 2000], message: `mails "${subjectPart}" for ${code}` })
    .toBeGreaterThanOrEqual(count);
  return Promise.all(found.map(async (m) => (await (await fetch(api(`/message/${m.ID}`))).json()) as MailMessage));
}

/** Negative check: nothing with this subject part exists for the code (call after the state is already final). */
export async function expectNoMail(code: string, subjectPart: string): Promise<void> {
  expect(await mailsFor(code, subjectPart)).toHaveLength(0);
}
