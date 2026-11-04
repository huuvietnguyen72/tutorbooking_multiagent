/**
 * Validates the `?next=` redirect target so login cannot be used as an open redirect.
 * Only same-origin absolute paths are accepted.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch === '\\') return null;
  }
  return value;
}
