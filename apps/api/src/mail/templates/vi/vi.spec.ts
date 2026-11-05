import { escapeHtml, singleLine } from '../../escape';
import { formatRange, renderMail, TEMPLATE_NAMES, UnknownTemplateError } from './index';

const TZ = 'Asia/Ho_Chi_Minh';
const XSS = `<script>alert("x")</script> & 'q'`;

describe('mail templates', () => {
  it('escapeHtml covers & < > " \'', () => {
    expect(escapeHtml(XSS)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('singleLine collapses CR/LF into one line', () => {
    expect(singleLine('a\r\nBcc: evil@x.com\nb')).toBe('a Bcc: evil@x.com b');
  });

  it.each(TEMPLATE_NAMES)('%s escapes user-controlled values in html', (name) => {
    const mail = renderMail(
      name,
      { bookingCode: 'BK1', studentName: XSS, tutorName: XSS, reason: XSS, cancelledBy: 'STUDENT', startAt: '2026-12-01T07:00:00Z', endAt: '2026-12-01T08:00:00Z' },
      TZ,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain(`"x"`);
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('subject cannot carry CR/LF from a booking code', () => {
    const mail = renderMail('booking_confirmed_student', { bookingCode: 'A\r\nBcc: x@y.z' }, TZ);
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('formatRange renders GMT+7 wall-clock time', () => {
    expect(formatRange('2026-12-01T07:00:00Z', '2026-12-01T08:00:00Z', TZ)).toBe('14:00 - 15:00, 01/12/2026 (GMT+7)');
  });

  it('unknown template throws UnknownTemplateError', () => {
    expect(() => renderMail('nope', {}, TZ)).toThrow(UnknownTemplateError);
  });
});
