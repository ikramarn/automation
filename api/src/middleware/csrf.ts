import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';

/** HTTP methods that mutate state and require CSRF validation. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Name of the signed CSRF cookie. */
const CSRF_COOKIE = 'csrf_token';

/** Name of the CSRF request header (lowercase — HTTP headers are case-insensitive). */
const CSRF_HEADER = 'x-csrf-token';

/**
 * Fastify preHandler hook — CSRF protection middleware.
 *
 * Implements the double-submit cookie pattern (Req 18.6):
 *
 * 1. For state-changing methods (POST, PUT, PATCH, DELETE):
 *    a. Read the `X-CSRF-Token` header from the request.
 *    b. Read and **unsign** the `csrf_token` signed cookie.
 *    c. Verify both are present and that they match using
 *       `crypto.timingSafeEqual` to prevent timing attacks.
 *    d. If missing or mismatched: throw AppError → HTTP 403
 *       `{ error_code: "csrf_token_invalid" }`
 *
 * 2. GET / HEAD / OPTIONS requests pass through without any check.
 *
 * ── How to apply to route groups ────────────────────────────────────────────
 *
 * Import `csrfProtect` and add it as a `preHandler` hook on the routes or
 * route groups that require CSRF validation:
 *
 * Option A — per-route:
 *   app.post('/pipelines', { preHandler: [authenticate, csrfProtect] }, handler);
 *
 * Option B — entire route group (recommended):
 *   async function pipelineRoutes(app: FastifyInstance) {
 *     app.addHook('preHandler', csrfProtect);   // protects every route in this plugin
 *     app.post('/', createPipelineHandler);
 *   }
 *   await app.register(pipelineRoutes, { prefix: '/pipelines' });
 *
 * Routes that require CSRF protection per design (Req 18.6):
 *   /pipelines    /credentials    /settings
 *
 * Requirements: 18.6
 */
export async function csrfProtect(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const method = request.method.toUpperCase();

  // Safe methods — no CSRF check needed
  if (!STATE_CHANGING_METHODS.has(method)) {
    return;
  }

  // 1. Extract the X-CSRF-Token header (Fastify lowercases header names)
  const headerToken = request.headers[CSRF_HEADER];
  if (!headerToken || typeof headerToken !== 'string' || headerToken.trim() === '') {
    throw new AppError(403, 'csrf_token_invalid', 'CSRF token missing or invalid');
  }

  // 2. Read the csrf_token signed cookie
  const rawCookie = (request.cookies as Record<string, string | undefined>)[CSRF_COOKIE];
  if (!rawCookie) {
    throw new AppError(403, 'csrf_token_invalid', 'CSRF token missing or invalid');
  }

  // 3. Unsign the cookie using @fastify/cookie (verifies HMAC signature)
  const unsignResult = reply.unsignCookie(rawCookie);
  if (!unsignResult.valid || !unsignResult.value) {
    throw new AppError(403, 'csrf_token_invalid', 'CSRF token missing or invalid');
  }

  const cookieToken = unsignResult.value;

  // 4. Constant-time comparison to prevent timing attacks
  if (!safeCompare(headerToken, cookieToken)) {
    throw new AppError(403, 'csrf_token_invalid', 'CSRF token missing or invalid');
  }
}

/**
 * Constant-time string comparison using `crypto.timingSafeEqual`.
 *
 * Length mismatch returns false immediately — length is not a timing oracle
 * since token lengths are fixed (64 hex chars from randomBytes(32)).
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}
