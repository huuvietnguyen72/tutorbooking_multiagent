import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext (open-redirect guard)', () => {
  it('accepts same-origin paths', () => {
    expect(safeNext('/gia-su/abc?slot=1')).toBe('/gia-su/abc?slot=1');
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, undefined, '/a\nb'])(
    'rejects %s',
    (value) => {
      expect(safeNext(value as string | null | undefined)).toBeNull();
    },
  );
});
