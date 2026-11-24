/** Every error a client can receive, with its HTTP status and reason phrase. Listed in docs/api.md. */
export const ERROR_CODES = {
  invalid_request: { status: 400, reason: 'Bad Request' },
  unauthorised: { status: 401, reason: 'Unauthorized' },
  url_blocked: { status: 403, reason: 'Forbidden' },
  not_found: { status: 404, reason: 'Not Found' },
  method_not_allowed: { status: 405, reason: 'Method Not Allowed' },
  rate_limited: { status: 429, reason: 'Too Many Requests' },
  internal_error: { status: 500, reason: 'Internal Server Error' },
  upstream_error: { status: 502, reason: 'Bad Gateway' },
  unavailable: { status: 503, reason: 'Service Unavailable' },
  upstream_timeout: { status: 504, reason: 'Gateway Timeout' },
} as const satisfies Record<string, { status: number; reason: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ServiceErrorDetails {
  /** HTTP status the target answered with, for upstream_error. */
  upstreamStatus?: number;
  /** Seconds the client should wait, for rate_limited and unavailable. */
  retryAfterSeconds?: number;
}

/** A failure with a stable code that callers map to an HTTP status or exit code. */
export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details: ServiceErrorDetails;

  constructor(code: ErrorCode, message: string, details: ServiceErrorDetails = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

/** Returns the error as a ServiceError, wrapping anything unexpected as internal_error. */
export function toServiceError(error: unknown): ServiceError {
  return error instanceof ServiceError ? error : new ServiceError('internal_error', 'Something went wrong on the server.');
}
