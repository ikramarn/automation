/**
 * Tests for subscription guard middleware (Req 2.6).
 *
 * Strategy: build a minimal Fastify app with:
 *   - GET /resource   (read-only endpoint)
 *   - POST /resource  (mutation endpoint)
 *   - PUT /resource   (mutation endpoint)
 *   - DELETE /resource (mutation endpoint)
 *   - PATCH /resource  (mutation endpoint)
 *
 * Each route has `requireActiveSubscription` as a preHandler. The
 * `authenticate` middleware is bypassed by directly injecting a synthetic
 * `request.user` via a test preHandler that runs before the guard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { requireActiveSubscription } from './subscriptionGuard.js';
import { registerErrorHandler } from '../errors/errorHandler.js';
import type { RequestUser } from '../types/index.js';

// ── App builder ───────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  registerErrorHandler(app);

  /**
   * Inject a synthetic `request.user` from the `x-test-subscription-status`
   * header so tests can control the subscription status without a real JWT.
   */
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const status =
      (request.headers['x-test-subscription-status'] as string | undefined) ?? 'active';

    request.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      subscription_status: status as RequestUser['subscription_status'],
    };
  });

  // GET — read-only
  app.get(
    '/resource',
    { preHandler: requireActiveSubscription },
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );

  // POST — mutation
  app.post(
    '/resource',
    { preHandler: requireActiveSubscription },
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );

  // PUT — mutation
  app.put(
    '/resource',
    { preHandler: requireActiveSubscription },
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );

  // DELETE — mutation
  app.delete(
    '/resource',
    { preHandler: requireActiveSubscription },
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );

  // PATCH — mutation
  app.patch(
    '/resource',
    { preHandler: requireActiveSubscription },
    async (_request, reply) => reply.status(200).send({ ok: true }),
  );

  await app.ready();
  return app;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('requireActiveSubscription middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Read-only access always allowed ────────────────────────────────────────

  it('GET with suspended user → 200 (read-only access allowed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'suspended' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET with inactive user → 200 (read-only access allowed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'inactive' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET with cancelled user → 200 (cancelled = read-only allowed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'cancelled' },
    });

    expect(response.statusCode).toBe(200);
  });

  // ── Active subscription allows mutations ───────────────────────────────────

  it('POST with active user → 200', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'active' },
    });

    expect(response.statusCode).toBe(200);
  });

  // ── Suspended subscription blocks mutations ────────────────────────────────

  it('POST with suspended user → 403 with error_code "subscription_required"', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'suspended' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });

  it('PUT with suspended user → 403', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'suspended' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });

  it('DELETE with suspended user → 403', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'suspended' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });

  it('PATCH with suspended user → 403', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'suspended' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });

  // ── Inactive subscription blocks mutations ─────────────────────────────────

  it('POST with inactive user → 403 with error_code "subscription_required"', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'inactive' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });

  // ── Cancelled subscription blocks mutations ────────────────────────────────

  it('POST with cancelled user → 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/resource',
      headers: { 'x-test-subscription-status': 'cancelled' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error_code: string }>();
    expect(body.error_code).toBe('subscription_required');
  });
});
