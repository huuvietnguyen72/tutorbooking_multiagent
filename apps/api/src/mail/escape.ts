const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Every user-controlled value goes through this before it lands in an HTML body (D3). */
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Header values must stay on one line: CR/LF would let a name inject extra headers. */
export const singleLine = (value: unknown): string => String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
