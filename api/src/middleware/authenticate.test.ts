/**
 * Tests for JWT authentication middleware (Req 1.4, 18.2).
 *
 * Strategy: build a minimal Fastify app with a single protected GET /protected
 * route that applies the authenticate preHandler. Each test exercises a
 * distinct token-extraction / validation path.
 *
 * JWTs are signed with the same secret the JWT plugin is configured with so
 * that we can produce valid tokens in tests without external services.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { authenticate } from './authenticate.js';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ── Test constants ────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters!!';

/** A valid Supabase-style JWT payload. */
const VALID_PAYLOAD = {
  sub: 'user-uuid-1234',
  email: 'test@example.com',
  user_metadata: { subscription_status: 'active' },
};

// ── App builder ───────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, { secret: COOKIE_SECRET, hook: 'onRequest' });

  await app.register(fastifyJwt, { secret: JWT_SECRET });

  registerErrorHandler(app);

  // Protected route: apply authenticate as a preHandler
  app.get(
    '/protected',
    { preHandler: authenticate },
    async (request, reply) => {
      return reply.status(200).send({ user: request.user });
    },
  );

  await app.ready();
  return app;
}

/** Signs a JWT with the test secret using @fastify/jwt's sign method. */
function signToken(app: FastifyInstance, payload: object, expiresIn = '24h'): string {
  return app.jwt.sign(payload, { expiresIn });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('authenticate middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['SUPABASE_JWT_SECRET'] = JWT_SECRET;
    process.env['COOKIE_SECRET'] = COOKIE_SECRET;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Valid token paths ───────────────────────────────────────────────────────

  it('valid Bearer token → attaches user and returns 200', async () => {
    const token = signToken(app, VALID_PAYLOAD);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: Record<string, unknown> }>();
    expect(body.user.id).toBe(VALID_PAYLOAD.sub);
    expect(body.user.email).toBe(VALID_PAYLOAD.email);
    expect(body.user.subscription_status).toBe('active');
  });

  it('valid session cookie → attaches user and returns 200', async () => {
    const token = signToken(app, VALID_PAYLOAD);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { session_token: token },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: Record<string, unknown> }>();
    expect(body.user.id).toBe(VALID_PAYLOAD.sub);
    expect(body.user.email).toBe(VALID_PAYLOAD.email);
    expect(body.user.subscription_status).toBe('active');
  });

  it('Bearer token takes precedence over session cookie', async () => {
    const tokenA = signToken(app, { ...VALID_PAYLOAD, sub: 'user-a' });
    const tokenB = signToken(app, { ...VALID_PAYLOAD, sub: 'user-b' });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${tokenA}` },
      cookies: { session_token: tokenB },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: Record<string, unknown> }>();
    expect(body.user.id).toBe('user-a');
  });

  it('maps unknown subscription_status to "inactive"', async () => {
    const token = signToken(app, {
      sub: 'user-uuid-5678',
      email: 'other@example.com',
      user_metadata: { subscription_status: 'unknown_value' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: Record<string, unknown> }>();
    expect(body.user.subscription_status).toBe('inactive');
  });

  it('maps missing subscription_status to "inactive"', async () => {
    const token = signToken(app, {
      sub: 'user-uuid-9999',
      email: 'nosub@example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: Record<string, unknown> }>();
    expect(body.user.subscription_status).toBe('inactive');
  });

  // ── Failure paths → HTTP 401 ────────────────────────────────────────────────

  it('expired token → returns 401 with error_code "unauthorized"', async () => {
    // Manually set exp to a past Unix timestamp (1 second in the past) so the
    // token is immediately expired. fast-jwt rejects negative string durations,
    // so we use a numeric exp claim directly.
    const pastExp = Math.floor(Date.now() / 1000) - 1;
    const token = app.jwt.sign({ ...VALID_PAYLOAD, exp: pastExp });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });

  it('invalid signature → returns 401 with error_code "unauthorized"', async () => {
    // Sign with a different secret
    const otherApp = Fastify({ logger: false });
    await otherApp.register(fastifyJwt, { secret: 'completely-different-secret-value!!' });
    const badToken = otherApp.jwt.sign(VALID_PAYLOAD);
    await otherApp.close();

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${badToken}` },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });

  it('missing token → returns 401 with error_code "unauthorized"', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });

  it('malformed token (random string) → returns 401 with error_code "unauthorized"', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer this.is.not.a.valid.jwt' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });

  it('Authorization header without Bearer scheme → returns 401', async () => {
    const token = signToken(app, VALID_PAYLOAD);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Basic ${token}` },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });

  it('empty Authorization header value → returns 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: '' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('unauthorized');
  });
});
