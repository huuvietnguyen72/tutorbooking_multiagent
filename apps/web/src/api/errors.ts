import i18n from '../i18n';
import { ApiError } from './client';

/** Maps an error to Vietnamese text by `code`. The server `message` is never shown. */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  const key = `errors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : i18n.t('errors.UNKNOWN');
}

/** Text for a single validation `code` reported for a field (e.g. `too_small`). */
export function fieldErrorText(code: string): string {
  const key = `validation.${code}`;
  return i18n.exists(key) ? i18n.t(key) : i18n.t('errors.VALIDATION_FAILED');
}
