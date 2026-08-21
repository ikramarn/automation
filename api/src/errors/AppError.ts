/**
 * Application-level error class.
 *
 * Throw an AppError from any route handler or plugin to produce a structured
 * JSON error response:
 *   { status: "error", error_code, message, details }
 *
 * Req 19.3: All API errors MUST use this shape.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    errorCode: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }

  // ── Convenience factory methods ────────────────────────────────────────────

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(401, 'unauthorized', message);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(403, 'forbidden', message);
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(404, 'not_found', `${resource} not found`);
  }

  static conflict(message: string): AppError {
    return new AppError(409, 'conflict', message);
  }

  static tooManyRequests(message = 'Too many requests'): AppError {
    return new AppError(429, 'too_many_requests', message);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(500, 'internal_error', message);
  }
}
