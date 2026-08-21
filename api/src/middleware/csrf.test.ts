/**
 * Tests for CSRF protection middleware (Req 18.6).
 *
 * Strategy: build a minimal Fastify app with:
 *   - GET  /test  — safe route (no CSRF check)
 *   - POST /test  — state-changing route protected by csrfProtect
 *   - PUT  /test  — state-changing route protected by csrfProtect
 *   - PATCH /test — state-changing route protected by csrfProtect
 *   - DELETE /test — state-changing route protected by csrfProtect
 *   - OPTIONS /test — preflight (no CSRF check)
 *
 * The double-submit cookie pattern is exercised by:
 *   1. Signing a known token with @fastify/cookie's signer.
 *   2. Sending it as both the `csrf_token` cookie and `X-CSRF-Token` header.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { csrfProtect } from './csrf.js';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ── Test constants ────────────────────────────────────────────────────────────

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters!!';
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

// ── App builder ───────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, { secret: COOKIE_SECRET, hook: 'onRequest' });

  registerErrorHandler(app);

  // Handler that simply returns 200 — used for all test routes
  const okHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ ok: true });
  };

  app.get('/test', okHandler);
  app.options('/test', okHandler);

  app.post('/test', { preHandler: csrfProtect }, okHandler);
  app.put('/test', { preHandler: csrfProtect }, okHandler);
  app.patch('/test', { preHandler: csrfProtect }, okHandler);
  app.delete('/test', { preHandler: csrfProtect }, okHandler);

  await app.ready();
  return app;
}

/**
 * Signs a token value using @fastify/cookie's signCookie decorator so we can
 * produce a valid signed cookie value that `reply.unsignCookie` will accept.
 * The `signCookie` method is available on FastifyInstance via SignerMethods.
 */
function signCookieValue(app: FastifyInstance, value: string): string {
  return app.signCookie(value);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('csrfProtect middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['COOKIE_SECRET'] = COOKIE_SECRET;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Safe methods — no CSRF check ────────────────────────────────────────────

  it('GET request without CSRF header → passes through (200)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });
    expect(response.statusCode).toBe(200);
  });

  it('OPTIONS request → passes (no CSRF check on preflight)', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/test',
    });
    expect(response.statusCode).toBe(200);
  });

  // ── POST with valid CSRF token ──────────────────────────────────────────────

  it('POST with valid matching CSRF token header and cookie → passes through (200)', async () => {
    const token = 'a'.repeat(64); // 64-char hex token
    const signedCookie = signCookieValue(app, token);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        [CSRF_HEADER]: token,
      },
      cookies: {
        [CSRF_COOKIE]: signedCookie,
      },
    });

    expect(response.statusCode).toBe(200);
  });

  // ── POST with missing/mismatched token → 403 ───────────────────────────────

  it('POST with missing X-CSRF-Token header → 403 csrf_token_invalid', async () => {
    const token = 'b'.repeat(64);
    const signedCookie = signCookieValue(app, token);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      cookies: {
        [CSRF_COOKIE]: signedCookie,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  it('POST with mismatched token → 403 csrf_token_invalid', async () => {
    const token = 'c'.repeat(64);
    const differentToken = 'd'.repeat(64);
    const signedCookie = signCookieValue(app, token);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        [CSRF_HEADER]: differentToken, // header ≠ cookie
      },
      cookies: {
        [CSRF_COOKIE]: signedCookie,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  it('POST with missing csrf_token cookie → 403 csrf_token_invalid', async () => {
    const token = 'e'.repeat(64);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        [CSRF_HEADER]: token,
      },
      // No cookie set
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  // ── Other state-changing methods → 403 when token missing ─────────────────

  it('PUT with missing token → 403 csrf_token_invalid', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/test',
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  it('PATCH with missing token → 403 csrf_token_invalid', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/test',
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  it('DELETE with missing token → 403 csrf_token_invalid', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/test',
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });

  // ── Tampered cookie signature → 403 ────────────────────────────────────────

  it('POST with unsigned (tampered) cookie → 403 csrf_token_invalid', async () => {
    const token = 'f'.repeat(64);
    // Pass the raw token as cookie without signing it — unsignCookie will reject it
    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        [CSRF_HEADER]: token,
      },
      cookies: {
        [CSRF_COOKIE]: token, // not signed — invalid
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('csrf_token_invalid');
  });
});
