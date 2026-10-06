export type ErrorCode =
  | 'COLOR_LENGTH_UNSUPPORTED'
  | 'COLOR_INVALID_CHAR'
  | 'CANVAS_NOT_OPAQUE'
  | 'CATEGORY_INVALID'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'BATCH_EMPTY'
  | 'PALETTE_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'RECORD_NOT_FOUND'
  | 'VALIDATION_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: { code, message, details } };
}
