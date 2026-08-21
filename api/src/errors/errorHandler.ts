import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './AppError.js';
import type { ApiErrorResponse } from '../types/index.js';

/**
 * Global Fastify error handler.
 *
 * Converts all thrown errors — AppError instances, Fastify validation errors,
 * and unexpected errors — into the standard structured JSON shape:
 *
 *   { status: "error", error_code, message, details }
 *
 * Req 19.3.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError | Error, _request: FastifyRequest, reply: FastifyReply) => {
      // ── Known application error ──────────────────────────────────────────
      if (error instanceof AppError) {
        const body: ApiErrorResponse = {
          status: 'error',
          error_code: error.errorCode,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        };
        return reply.status(error.statusCode).send(body);
      }

      // ── Fastify schema validation error (statusCode 400) ─────────────────
      const fastifyError = error as FastifyError;
      if (fastifyError.validation) {
        const body: ApiErrorResponse = {
          status: 'error',
          error_code: 'validation_error',
          message: 'Request validation failed',
          details: fastifyError.validation,
        };
        return reply.status(400).send(body);
      }

      // ── Fastify built-in errors (e.g. 404 route not found) ───────────────
      if (fastifyError.statusCode) {
        const body: ApiErrorResponse = {
          status: 'error',
          error_code: toErrorCode(fastifyError.statusCode),
          message: fastifyError.message,
        };
        return reply.status(fastifyError.statusCode).send(body);
      }

      // ── Unexpected / unhandled errors ─────────────────────────────────────
      // Log the real error but don't leak internals to the client
      app.log.error({ err: error }, 'Unhandled error');

      const body: ApiErrorResponse = {
        status: 'error',
        error_code: 'internal_error',
        message: 'An unexpected error occurred',
      };
      return reply.status(500).send(body);
    },
  );

  // Handle 404 — route not found
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    const body: ApiErrorResponse = {
      status: 'error',
      error_code: 'not_found',
      message: 'Route not found',
    };
    return reply.status(404).send(body);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toErrorCode(statusCode: number): string {
  const map: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    408: 'request_timeout',
    409: 'conflict',
    422: 'unprocessable_entity',
    429: 'too_many_requests',
    500: 'internal_error',
    502: 'bad_gateway',
    503: 'service_unavailable',
  };
  return map[statusCode] ?? 'error';
}
