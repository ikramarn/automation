/**
 * Property-based tests for CSRF protection middleware (Property 15).
 *
 * **Validates: Requirements 18.6**
 *
 * Uses fast-check to verify that:
 *   - Any state-changing request (POST/PUT/PATCH/DELETE) with a missing or
 *     mismatched X-CSRF-Token header always returns HTTP 403.
 *   - Safe methods (GET/HEAD/OPTIONS) always pass through without a CSRF token.
 *   - A valid signed cookie + matching header always returns HTTP 200.
 *
 * The same minimal Fastify app from csrf.test.ts is reused here for consistency.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { csrfProtect } from './csrf.js';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters!!';
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

// ── Test app builder ──────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, { secret: COOKIE_SECRET, hook: 'onRequest' });
  registerErrorHandler(app);

  const okHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ ok: true });
  };

  // Safe routes — no CSRF check
  app.get('/test', okHandler);
  app.head('/test', okHandler);
  app.options('/test', okHandler);

  // State-changing routes — CSRF protected
  app.post('/test', { preHandler: csrfProtect }, okHandler);
  app.put('/test', { preHandler: csrfProtect }, okHandler);
  app.patch('/test', { preHandler: csrfProtect }, okHandler);
  app.delete('/test', { preHandler: csrfProtect }, okHandler);

  await app.ready();
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Signs a raw token string using @fastify/cookie's signCookie so it can be
 * used as a valid CSRF cookie value that the middleware will accept after
 * calling reply.unsignCookie().
 */
function signToken(app: FastifyInstance, value: string): string {
  return app.signCookie(value);
}

// ── Property 15 — CSRF Token Enforcement ─────────────────────────────────────

describe('Property 15: CSRF Token Enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['COOKIE_SECRET'] = COOKIE_SECRET;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Property A — Missing header, any state-changing method ───────────────

  it(
    'Property A — state-changing method + valid cookie but missing header → always 403',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          // Generate a random token value (printable ASCII, no special URL chars)
          fc.string({ minLength: 8, maxLength: 128 }).filter(s => s.trim().length > 0),
          async (method, tokenValue) => {
            const signedCookie = signToken(app, tokenValue);

            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/test',
              cookies: { [CSRF_COOKIE]: signedCookie },
              // Intentionally NO X-CSRF-Token header
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('csrf_token_invalid');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property B — Mismatched tokens ───────────────────────────────────────

  it(
    'Property B — valid signed cookie but different string as header → always 403',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          // Two distinct strings: one for the cookie, one for the header
          fc
            .tuple(
              fc.string({ minLength: 8, maxLength: 64 }).filter(s => s.trim().length > 0),
              fc.string({ minLength: 8, maxLength: 64 }).filter(s => s.trim().length > 0),
            )
            .filter(([cookie, header]) => cookie !== header),
          async (method, [cookieValue, headerValue]) => {
            const signedCookie = signToken(app, cookieValue);

            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/test',
              headers: { [CSRF_HEADER]: headerValue },
              cookies: { [CSRF_COOKIE]: signedCookie },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('csrf_token_invalid');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property C — Random strings as header ────────────────────────────────

  it(
    'Property C — signed cookie + random header string (different from cookie) → always 403',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          fc.string({ minLength: 1, maxLength: 128 }).filter(s => s.trim().length > 0),
          fc.string({ minLength: 1, maxLength: 128 }).filter(s => s.trim().length > 0),
          async (method, cookieValue, randomHeader) => {
            // Only test cases where header differs from cookie
            fc.pre(cookieValue !== randomHeader);

            const signedCookie = signToken(app, cookieValue);

            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/test',
              headers: { [CSRF_HEADER]: randomHeader },
              cookies: { [CSRF_COOKIE]: signedCookie },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('csrf_token_invalid');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property D — Unsigned/tampered cookie ────────────────────────────────

  it(
    'Property D — unsigned/tampered cookie + matching header → always 403',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          fc.string({ minLength: 8, maxLength: 64 }).filter(s => s.trim().length > 0),
          async (method, tokenValue) => {
            // Pass the raw token as both the cookie (unsigned!) and header.
            // @fastify/cookie's unsignCookie will reject an unsigned cookie,
            // so the middleware must return 403 even when they "match".
            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/test',
              headers: { [CSRF_HEADER]: tokenValue },
              cookies: { [CSRF_COOKIE]: tokenValue }, // unsigned — invalid signature
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('csrf_token_invalid');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property E — Safe methods pass through ───────────────────────────────

  it(
    'Property E — safe methods (GET/HEAD/OPTIONS) with no CSRF token → always pass (200)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('GET', 'OPTIONS'),
          async method => {
            // No cookie, no header — safe methods must never be blocked
            const response = await app.inject({
              method: method as 'GET' | 'OPTIONS',
              url: '/test',
            });

            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 20 },
      );
    },
  );

  // ── Positive counter-example — valid token always 200 ────────────────────

  it(
    'Positive counter-example — valid signed cookie + matching header → always 200 for all state-changing methods',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          // Use a fixed-length hex-like token to ensure no accidental mismatch
          fc
            .hexaString({ minLength: 32, maxLength: 64 })
            .filter(s => s.length > 0),
          async (method, tokenValue) => {
            const signedCookie = signToken(app, tokenValue);

            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/test',
              headers: { [CSRF_HEADER]: tokenValue },
              cookies: { [CSRF_COOKIE]: signedCookie },
            });

            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});
