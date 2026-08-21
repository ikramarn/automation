/**
 * Property-based tests for subscription guard middleware (Property 18).
 *
 * **Validates: Requirements 2.6**
 *
 * Uses fast-check to verify that:
 *   - Suspended subscriptions block ALL mutation methods (POST/PUT/PATCH/DELETE)
 *     with HTTP 403 + error_code "subscription_required".
 *   - Inactive subscriptions block ALL mutation methods similarly.
 *   - Cancelled subscriptions block ALL mutation methods similarly.
 *   - Suspended/inactive/cancelled subscriptions still permit read-only GET
 *     requests (HTTP 200).
 *   - Active subscriptions permit every mutation method (HTTP 200).
 *
 * The test app reuses the same minimal Fastify harness pattern from
 * subscriptionGuard.test.ts: a global preHandler populates `request.user`
 * from the `x-test-subscription-status` header, letting tests control
 * subscription status without a real JWT.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { requireActiveSubscription } from './subscriptionGuard.js';
import { registerErrorHandler } from '../errors/errorHandler.js';
import type { RequestUser } from '../types/index.js';

// ── Test app builder ──────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  registerErrorHandler(app);

  /**
   * Synthetic authentication hook: reads the subscription status from
   * `x-test-subscription-status` header and attaches it as `request.user`.
   * Defaults to "active" when the header is absent.
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

  const ok = async (_req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(200).send({ ok: true });

  // Read-only routes
  app.get('/resource', { preHandler: requireActiveSubscription }, ok);

  // Mutation routes
  app.post('/resource', { preHandler: requireActiveSubscription }, ok);
  app.put('/resource', { preHandler: requireActiveSubscription }, ok);
  app.patch('/resource', { preHandler: requireActiveSubscription }, ok);
  app.delete('/resource', { preHandler: requireActiveSubscription }, ok);

  await app.ready();
  return app;
}

// ── Property 18: Suspended Subscription Read-Only Enforcement ────────────────

describe('Property 18: Suspended Subscription Read-Only Enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Property A — Suspended blocks all mutations ───────────────────────────

  it(
    'Property A — suspended subscription + any mutation method → always 403 subscription_required',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          async (method) => {
            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/resource',
              headers: { 'x-test-subscription-status': 'suspended' },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('subscription_required');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property B — Inactive blocks all mutations ────────────────────────────

  it(
    'Property B — inactive subscription + any mutation method → always 403 subscription_required',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          async (method) => {
            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/resource',
              headers: { 'x-test-subscription-status': 'inactive' },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('subscription_required');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property C — Cancelled blocks all mutations ───────────────────────────

  it(
    'Property C — cancelled subscription + any mutation method → always 403 subscription_required',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          async (method) => {
            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/resource',
              headers: { 'x-test-subscription-status': 'cancelled' },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('subscription_required');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property D — Suspended/inactive/cancelled all permit GET reads ────────

  it(
    'Property D — GET with any non-active status (suspended/inactive/cancelled) → always 200',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('suspended', 'inactive', 'cancelled'),
          async (subscriptionStatus) => {
            const response = await app.inject({
              method: 'GET',
              url: '/resource',
              headers: { 'x-test-subscription-status': subscriptionStatus },
            });

            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 30 },
      );
    },
  );

  // ── Property E — Active subscription permits all mutations ────────────────

  it(
    'Property E — active subscription + any mutation method → always 200',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
          async (method) => {
            const response = await app.inject({
              method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
              url: '/resource',
              headers: { 'x-test-subscription-status': 'active' },
            });

            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});
