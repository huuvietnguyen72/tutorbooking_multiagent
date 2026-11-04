import { HttpException } from '@nestjs/common';

/** Stable error codes; keep in sync with `ErrorCode` in docs/openapi.yaml. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'EMAIL_TAKEN',
  'WRONG_CURRENT_PASSWORD',
  'TUTOR_NOT_ACCEPTING',
  'SLOT_OVERLAP',
  'SLOT_LOCKED',
  'SLOT_UNAVAILABLE',
  'SLOT_TOO_SOON',
  'STUDENT_OVERLAP',
  'BOOKING_NOT_PAYABLE',
  'GATEWAY_ALREADY_COMPLETED',
  'WINDOW_PASSED',
  'RESCHEDULE_LIMIT',
  'NOT_CONFIRMED',
  'SESSION_STARTED',
  'NOT_FINISHED',
  'ALREADY_REVIEWED',
  'INVALID_SIGNATURE',
  'AMOUNT_MISMATCH',
  'UNKNOWN_PAYMENT',
  'ALREADY_REFUNDED',
  'PAYMENT_NOT_REFUNDABLE',
  'CANNOT_LOCK_ADMIN',
  'INVALID_STATE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(AppError.body(code, message, details), status);
  }

  static body(code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorBody {
    return { error: { code, message, ...(details ? { details } : {}) } };
  }

  static validation(fields: { field: string; code: string }[]): AppError {
    return new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', { fields });
  }

  static unauthenticated(): AppError {
    return new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  static forbidden(): AppError {
    return new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
  }

  static notFound(): AppError {
    return new AppError(404, 'NOT_FOUND', 'Resource not found');
  }
}
