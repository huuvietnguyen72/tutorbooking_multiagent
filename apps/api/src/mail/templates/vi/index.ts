import { escapeHtml, singleLine } from '../../escape';

/** Vietnamese email bodies (CEO #5: the only language). Values are escaped here, never at the call site. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface MailPayload {
  bookingCode?: string;
  startAt?: string;
  endAt?: string;
  oldStartAt?: string;
  oldEndAt?: string;
  priceVnd?: number;
  studentName?: string;
  tutorName?: string;
  cancelledBy?: 'STUDENT' | 'TUTOR' | 'ADMIN';
  reason?: string;
  refunded?: boolean;
}

export class UnknownTemplateError extends Error {}

const pad = (n: string | undefined): string => (n ?? '').padStart(2, '0');

/** `14:00 - 15:00, 01/12/2026 (GMT+7)`: the only place UTC instants become wall-clock text. */
export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const parts = (iso: string) => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    });
    const map = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    return map as Record<string, string>;
  };
  const s = parts(startIso);
  const e = parts(endIso);
  return `${pad(s.hour)}:${pad(s.minute)} - ${pad(e.hour)}:${pad(e.minute)}, ${s.day}/${s.month}/${s.year} (${s.timeZoneName})`;
}

const formatVnd = (amount: number): string => `${new Intl.NumberFormat('vi-VN').format(amount)} đ`;

const CANCELLER: Record<NonNullable<MailPayload['cancelledBy']>, string> = {
  STUDENT: 'học viên',
  TUTOR: 'gia sư',
  ADMIN: 'quản trị viên',
};

interface Line {
  label: string;
  value: string;
}

function layout(subject: string, greeting: string, intro: string, lines: Line[], outro?: string): RenderedMail {
  const rows = lines
    .map((l) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${escapeHtml(l.label)}</td><td><strong>${escapeHtml(l.value)}</strong></td></tr>`)
    .join('');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><table>${rows}</table>` +
    (outro ? `<p>${escapeHtml(outro)}</p>` : '') +
    `<p>Trân trọng,<br>Tutor Booking</p></div>`;
  const text = [greeting, '', intro, '', ...lines.map((l) => `${l.label}: ${l.value}`), ...(outro ? ['', outro] : []), '', 'Trân trọng,', 'Tutor Booking'].join('\n');
  return { subject: singleLine(subject), html, text };
}

type Role = 'student' | 'tutor';

function details(p: MailPayload, role: Role, tz: string): Line[] {
  const lines: Line[] = [{ label: 'Mã đặt lịch', value: p.bookingCode ?? '' }];
  lines.push(role === 'student' ? { label: 'Gia sư', value: p.tutorName ?? '' } : { label: 'Học viên', value: p.studentName ?? '' });
  if (p.startAt && p.endAt) lines.push({ label: 'Thời gian', value: formatRange(p.startAt, p.endAt, tz) });
  if (typeof p.priceVnd === 'number') lines.push({ label: 'Học phí', value: formatVnd(p.priceVnd) });
  return lines;
}

const greet = (p: MailPayload, role: Role): string => `Xin chào ${(role === 'student' ? p.studentName : p.tutorName) ?? ''},`;

type Builder = (p: MailPayload, tz: string) => RenderedMail;

const confirmed =
  (role: Role): Builder =>
  (p, tz) =>
    layout(
      `Đặt lịch ${p.bookingCode ?? ''} thành công`,
      greet(p, role),
      role === 'student' ? 'Lịch học của bạn đã được xác nhận sau khi thanh toán thành công.' : 'Có một học viên vừa đặt và thanh toán buổi học của bạn.',
      details(p, role, tz),
    );

const cancelled =
  (role: Role): Builder =>
  (p, tz) => {
    const who = p.cancelledBy ? CANCELLER[p.cancelledBy] : 'hệ thống';
    const lines = details(p, role, tz);
    if (p.reason) lines.push({ label: 'Lý do', value: p.reason });
    const outro = role === 'student' ? (p.refunded ? 'Học phí đã được hoàn lại 100%.' : 'Nếu cần hoàn học phí, vui lòng liên hệ quản trị viên.') : undefined;
    return layout(`Buổi học ${p.bookingCode ?? ''} đã bị huỷ`, greet(p, role), `Buổi học dưới đây đã được ${who} huỷ.`, lines, outro);
  };

const rescheduled =
  (role: Role): Builder =>
  (p, tz) => {
    const lines = details(p, role, tz);
    if (p.oldStartAt && p.oldEndAt) lines.push({ label: 'Thời gian cũ', value: formatRange(p.oldStartAt, p.oldEndAt, tz) });
    return layout(`Buổi học ${p.bookingCode ?? ''} đã đổi lịch`, greet(p, role), 'Buổi học đã được đổi sang thời gian mới.', lines);
  };

const BUILDERS: Record<string, Builder> = {
  booking_confirmed_student: confirmed('student'),
  booking_confirmed_tutor: confirmed('tutor'),
  booking_cancelled_student: cancelled('student'),
  booking_cancelled_tutor: cancelled('tutor'),
  booking_rescheduled_student: rescheduled('student'),
  booking_rescheduled_tutor: rescheduled('tutor'),
};

export const TEMPLATE_NAMES = Object.keys(BUILDERS);

export function renderMail(template: string, payload: unknown, timeZone: string): RenderedMail {
  const build = BUILDERS[template];
  if (!build) throw new UnknownTemplateError(`Unknown email template: ${template}`);
  return build((payload ?? {}) as MailPayload, timeZone);
}
