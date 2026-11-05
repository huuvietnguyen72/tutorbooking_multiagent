import { z } from 'zod';
import { AppError } from './app-error';

/** Parse a request payload; failures become 400 VALIDATION_FAILED with `details.fields`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw AppError.validation(
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      code: issue.code,
    })),
  );
}

/** Path-param guard: a malformed id is a 400 (D4), an unknown or foreign one a 404 later on. */
export function uuidParam(value: string, field = 'id'): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw AppError.validation([{ field, code: 'invalid_uuid' }]);
  return result.data;
}
