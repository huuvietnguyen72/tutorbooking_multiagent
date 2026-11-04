import { describe, expect, it } from 'vitest';
import enumCodes from '../test/errorCodes';
import vi from '../i18n/vi.json';
import { ApiError } from './client';
import { errorText } from './errors';

describe('error code -> text', () => {
  it('has Vietnamese text for every ErrorCode in the OpenAPI spec', () => {
    for (const code of enumCodes) {
      expect(vi.errors, code).toHaveProperty(code);
    }
  });

  it('never exposes the server message', () => {
    const err = new ApiError(401, 'INVALID_CREDENTIALS');
    expect(errorText(err)).toBe('Email hoặc mật khẩu không đúng.');
    expect(errorText(new Error('boom'))).toBe(vi.errors.UNKNOWN);
    expect(errorText(new ApiError(0, 'NETWORK'))).toBe(vi.errors.NETWORK);
  });
});
