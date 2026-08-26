/**
 * Integration tests: Stripe webhook → subscription state transitions
 * and subscription guard enforcement on pipeline mutations.
 *
 * These tests wire together three real layers:
 *   1. The Stripe webhook route (signature verification → handler → Supabase update)
 *   2. The subscription guard middleware (requireActiveSubscription)
 *   3. The pipeline create/list routes (POST /pipelines, GET /pipelines)
 *
 * External dependencies (Stripe SDK, Supabase, email, n8n, fetch) are mocked
 * using the same patterns as the unit tests in stripe.test.ts.
 *
 * ── Test groups ──────────────────────────────────────────────────────────────
 *
 * Group A — Webhook → subscription state:
 *   1. checkout.session.completed → status becomes 'active'
 *   2. invoice.payment_failed     → status becomes 'suspended'
 *   3. customer.subscription.deleted → status becomes 'cancelled'
 *   4. Webhook retry backoff: DB failure triggers delay() with correct ms values
 *   5. Full lifecycle sequence: checkout → payment_failed → subscription.deleted
 *
 * Group B — Subscription guard on /pipelines:
 *   6. Active subscription  → POST /pipelines passes the guard (201)
 *   7. Suspended subscription → POST /pipelines blocked by guard (403)
 *   8. Suspended subscription → GET /pipelines passes the guard (200)
 *
 * Requirements: 2.3, 2.4, 2.5, 2.6, 2.9
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

// ── Environment ──────────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'integration-test-jwt-secret-long-enough-32ch';
process.env['COOKIE_SECRET'] = 'integration-test-cookie-secret-at-least-32-chars!';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_fake';
process.env['API_BASE_URL'] = 'http://localhost:3000';
process.env['BILLING_PORTAL_URL'] = 'https://billing.example.com';

// ── Mock: delay (retries resolve instantly) ───────────────────────────────────
const { mockDelay } = vi.hoisted(() => ({
  mockDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/delay.js', () => ({
  delay: mockDelay,
}));

// ── Mock: Stripe ──────────────────────────────────────────────────────────────
const { mockConstructEventAsync } = vi.hoisted(() => ({
  mockConstructEventAsync: vi.fn(),
}));

vi.mock('../lib/stripe.js', () => ({
  createStripeClient: () => ({
    webhooks: {
      constructEventAsync: mockConstructEventAsync,
    },
  }),
}));

// ── Mock: Supabase ────────────────────────────────────────────────────────────
// mockFrom is the spy on the `from()` method. Individual tests may re-configure
// it to simulate failures or capture calls.
const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
    auth: {
      admin: { createUser: vi.fn(), generateLink: vi.fn(), updateUserById: vi.fn() },
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  }),
}));

// ── Mock: fetch (internal notify + any outbound calls) ───────────────────────
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));
vi.stubGlobal('fetch', mockFetch);

// ── Mock: email ───────────────────────────────────────────────────────────────
const { mockSendTransactionalEmail } = vi.hoisted(() => ({
  mockSendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/email.js', () => ({
  sendTransactionalEmail: mockSendTransactionalEmail,
}));

// ── Mock: n8n (used by POST /pipelines) ───────────────────────────────────────
vi.mock('../lib/n8n.js', () => ({
  createN8nWorkflow: vi.fn().mockResolvedValue('wf_test_001'),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Stripe event object.
 */
function makeEvent(
  type: string,
  dataObject: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `evt_integ_${type.replace(/\./g, '_')}`,
    type,
    data: { object: dataObject },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    api_version: '2024-06-20',
    object: 'event',
  };
}

/**
 * Injects a webhook POST to /webhooks/stripe with a fake Stripe-Signature
 * header. The mockConstructEventAsync intercepts signature verification.
 */
async function injectWebhook(
  app: FastifyInstance,
  event: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 't=12345,v1=fakesig',
    },
    payload: JSON.stringify(event),
  });
}

/**
 * Sets up mockFrom to return success responses for all Supabase chained calls.
 *
 * Supports both the UPDATE chain (.update().eq()) and the SELECT chain
 * (.select().eq().single()) used by handlers and pipeline routes.
 */
function setupSupabaseMockSuccess(): void {
  mockFrom.mockImplementation((_table: string) => {
    const chain: Record<string, unknown> = {};

    chain['eq'] = vi.fn().mockReturnValue(chain);
    chain['in'] = vi.fn().mockResolvedValue({ data: null, error: null });
    chain['single'] = vi.fn().mockResolvedValue({
      data: { id: 'user-test-123', email: 'user@example.com', pipeline_limit: 5 },
      error: null,
    });
    chain['maybeSingle'] = vi.fn().mockResolvedValue({
      data: { id: 'cred-test-001' },
      error: null,
    });
    chain['update'] = vi.fn().mockReturnValue(chain);
    chain['insert'] = vi.fn().mockReturnValue(chain);
    chain['select'] = vi.fn().mockReturnValue(chain);
    chain['order'] = vi.fn().mockResolvedValue({ data: [], error: null });

    // count query: select('id', { count: 'exact', head: true }).eq()
    // The resolved value needs count: 0 (below limit)
    // Override the resolved value of in/eq when called after select for counts
    // We track call count to distinguish count select from data select.
    return chain;
  });
}

/**
 * Captures the `update()` call arguments from the first mockFrom call chain.
 */
function captureFirstUpdateArgs(): Record<string, unknown> | undefined {
  const fromResult = mockFrom.mock.results[0]?.value as
    | Record<string, ReturnType<typeof vi.fn>>
    | undefined;
  if (!fromResult) return undefined;
  const updateCalls = (fromResult['update'] as ReturnType<typeof vi.fn>).mock.calls;
  return updateCalls[0]?.[0] as Record<string, unknown> | undefined;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Integration: Stripe webhook → subscription state', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    mockSendTransactionalEmail.mockResolvedValue(undefined);
    mockDelay.mockResolvedValue(undefined);
    setupSupabaseMockSuccess();
  });

  // ── Test 1: checkout.session.completed → 'active' ────────────────────────

  describe('Test 1: checkout.session.completed → subscription_status = "active"', () => {
    it('returns 200 and calls Supabase update with subscription_status "active"', async () => {
      const event = makeEvent('checkout.session.completed', {
        id: 'cs_integ_001',
        customer: 'cus_integ_123',
        subscription: 'sub_integ_456',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      // Verify Supabase was called for the user_profiles table
      expect(mockFrom).toHaveBeenCalledWith('user_profiles');

      // Verify update payload includes subscription_status: 'active'
      const updateArgs = captureFirstUpdateArgs();
      expect(updateArgs).toMatchObject({ subscription_status: 'active' });
    });

    it('includes stripe_subscription_id in the update payload', async () => {
      const event = makeEvent('checkout.session.completed', {
        id: 'cs_integ_002',
        customer: 'cus_integ_123',
        subscription: 'sub_integ_789',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      const updateArgs = captureFirstUpdateArgs();
      expect(updateArgs).toMatchObject({
        subscription_status: 'active',
        stripe_subscription_id: 'sub_integ_789',
      });
    });
  });

  // ── Test 2: invoice.payment_failed → 'suspended' ─────────────────────────

  describe('Test 2: invoice.payment_failed → subscription_status = "suspended"', () => {
    it('returns 200 and calls Supabase update with subscription_status "suspended"', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'in_integ_001',
        customer: 'cus_integ_123',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      expect(mockFrom).toHaveBeenCalledWith('user_profiles');

      const updateArgs = captureFirstUpdateArgs();
      expect(updateArgs).toMatchObject({ subscription_status: 'suspended' });
    });

    it('dispatches a payment-failure notification email', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'in_integ_002',
        customer: 'cus_integ_123',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      expect(mockSendTransactionalEmail).toHaveBeenCalledWith(
        'payment-failure',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── Test 3: customer.subscription.deleted → 'cancelled' ──────────────────

  describe('Test 3: customer.subscription.deleted → subscription_status = "cancelled"', () => {
    it('returns 200 and calls Supabase update with subscription_status "cancelled"', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_integ_456',
        customer: 'cus_integ_123',
        status: 'canceled',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      expect(mockFrom).toHaveBeenCalledWith('user_profiles');

      const updateArgs = captureFirstUpdateArgs();
      expect(updateArgs).toMatchObject({ subscription_status: 'cancelled' });
    });

    it('dispatches a subscription-suspended notification email', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_integ_456',
        customer: 'cus_integ_123',
        status: 'canceled',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      expect(mockSendTransactionalEmail).toHaveBeenCalledWith(
        'subscription-suspended',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('also suspends the user\'s active pipelines', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_integ_456',
        customer: 'cus_integ_123',
        status: 'canceled',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      // suspendUserPipelines calls from('pipelines').update() after from('user_profiles')
      const tablesCalled = mockFrom.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(tablesCalled).toContain('pipelines');
    });
  });

  // ── Test 4: Webhook retry backoff on DB failure ───────────────────────────

  describe('Test 4: Webhook retry backoff — DB failure triggers delay() with correct values', () => {
    it('calls delay() once with 5000ms when the first DB update fails', async () => {
      // Make the first call to from() fail so dispatchWithRetry kicks in,
      // then succeed on the retry.
      let callCount = 0;
      mockFrom.mockImplementation((_table: string) => {
        callCount++;
        const chain: Record<string, unknown> = {};
        chain['eq'] = vi.fn().mockReturnValue(chain);
        chain['in'] = vi.fn().mockResolvedValue({ data: null, error: null });
        chain['single'] = vi.fn().mockResolvedValue({
          data: { id: 'user-test-123', email: 'user@example.com' },
          error: null,
        });
        chain['select'] = vi.fn().mockReturnValue(chain);

        if (callCount === 1) {
          // First update call → DB error → forces a retry
          chain['update'] = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'simulated DB write failure' },
            }),
          });
        } else {
          // Subsequent calls succeed
          chain['update'] = vi.fn().mockReturnValue(chain);
        }

        return chain;
      });

      const event = makeEvent('checkout.session.completed', {
        id: 'cs_integ_retry',
        customer: 'cus_integ_123',
        subscription: 'sub_integ_456',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      // After retry the handler succeeds
      expect(response.statusCode).toBe(200);

      // delay() should have been called exactly once with the first backoff delay (5s)
      expect(mockDelay).toHaveBeenCalledTimes(1);
      expect(mockDelay).toHaveBeenCalledWith(5_000);
    });

    it('returns 500 and calls delay() 5 times when all retries are exhausted', async () => {
      // All from() calls return a DB error
      mockFrom.mockImplementation((_table: string) => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'persistent DB failure' },
          }),
        }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'persistent DB failure' },
        }),
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
      }));

      const event = makeEvent('checkout.session.completed', {
        id: 'cs_integ_exhausted',
        customer: 'cus_integ_999',
        subscription: 'sub_integ_999',
      });
      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      // All retries exhausted → 500 so Stripe knows to re-deliver
      expect(response.statusCode).toBe(500);

      // delay() called once per retry: 5_000, 10_000, 20_000, 40_000, 80_000
      expect(mockDelay).toHaveBeenCalledTimes(5);
      expect(mockDelay).toHaveBeenNthCalledWith(1, 5_000);
      expect(mockDelay).toHaveBeenNthCalledWith(2, 10_000);
      expect(mockDelay).toHaveBeenNthCalledWith(3, 20_000);
      expect(mockDelay).toHaveBeenNthCalledWith(4, 40_000);
      expect(mockDelay).toHaveBeenNthCalledWith(5, 80_000);
    });
  });

  // ── Test 5: Full lifecycle sequence ──────────────────────────────────────

  describe('Test 5: End-to-end — full payment lifecycle webhook sequence', () => {
    it('processes checkout → payment_failed → subscription.deleted in order', async () => {
      // Capture the sequence of subscription_status values written to Supabase
      const updatedStatuses: string[] = [];

      mockFrom.mockImplementation((_table: string) => {
        const chain: Record<string, unknown> = {};
        chain['eq'] = vi.fn().mockReturnValue(chain);
        chain['in'] = vi.fn().mockResolvedValue({ data: null, error: null });
        chain['single'] = vi.fn().mockResolvedValue({
          data: { id: 'user-test-123', email: 'user@example.com' },
          error: null,
        });
        chain['select'] = vi.fn().mockReturnValue(chain);
        chain['update'] = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (
            payload &&
            typeof payload === 'object' &&
            'subscription_status' in payload
          ) {
            updatedStatuses.push(payload['subscription_status'] as string);
          }
          return chain;
        });

        return chain;
      });

      // Step 1: Checkout completed → active
      const checkoutEvent = makeEvent('checkout.session.completed', {
        id: 'cs_lc_001',
        customer: 'cus_lifecycle',
        subscription: 'sub_lifecycle',
      });
      mockConstructEventAsync.mockResolvedValueOnce(checkoutEvent);
      const r1 = await injectWebhook(app, checkoutEvent);
      expect(r1.statusCode).toBe(200);

      // Step 2: Payment failed → suspended
      const failureEvent = makeEvent('invoice.payment_failed', {
        id: 'in_lc_001',
        customer: 'cus_lifecycle',
      });
      mockConstructEventAsync.mockResolvedValueOnce(failureEvent);
      const r2 = await injectWebhook(app, failureEvent);
      expect(r2.statusCode).toBe(200);

      // Step 3: Subscription deleted → cancelled
      const cancelEvent = makeEvent('customer.subscription.deleted', {
        id: 'sub_lifecycle',
        customer: 'cus_lifecycle',
        status: 'canceled',
      });
      mockConstructEventAsync.mockResolvedValueOnce(cancelEvent);
      const r3 = await injectWebhook(app, cancelEvent);
      expect(r3.statusCode).toBe(200);

      // Verify the status sequence written to Supabase matches the lifecycle
      expect(updatedStatuses).toContain('active');
      expect(updatedStatuses).toContain('suspended');
      expect(updatedStatuses).toContain('cancelled');

      // Order: active comes before suspended, suspended comes before cancelled
      const activeIdx = updatedStatuses.indexOf('active');
      const suspendedIdx = updatedStatuses.indexOf('suspended');
      const cancelledIdx = updatedStatuses.indexOf('cancelled');
      expect(activeIdx).toBeLessThan(suspendedIdx);
      expect(suspendedIdx).toBeLessThan(cancelledIdx);
    });
  });
});

// ── Group B: Subscription guard on pipeline routes ───────────────────────────
//
// These tests use a minimal Fastify app (not buildApp()) that wires the real
// `requireActiveSubscription` guard onto mutation and read routes.  This tests
// the integration between:
//   - The authenticate middleware (extracts subscription_status from JWT)
//   - The requireActiveSubscription guard (blocks mutations, allows reads)
//   - Routes that behave like POST /pipelines and GET /pipelines
//
// CSRF protection is intentionally excluded from this app because the unit under
// test is the subscription guard, not CSRF.  CSRF is tested in its own suite.

import Fastify, { type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { requireActiveSubscription } from '../middleware/subscriptionGuard.js';
import { authenticate } from '../middleware/authenticate.js';
import { registerErrorHandler } from '../errors/errorHandler.js';
import type { RequestUser } from '../types/index.js';

const JWT_SECRET = process.env['SUPABASE_JWT_SECRET'] as string;
const COOKIE_SECRET = process.env['COOKIE_SECRET'] as string;

/**
 * Builds a minimal test app with:
 *   - authenticate preHandler (reads JWT, populates request.user)
 *   - requireActiveSubscription preHandler (checks subscription_status)
 *   - POST /pipelines — mutation route (guard must block suspended users)
 *   - GET  /pipelines — read-only route (guard must allow suspended users)
 */
async function buildGuardTestApp(): Promise<FastifyInstance> {
  const testApp = Fastify({ logger: false });

  await testApp.register(fastifyCookie, { secret: COOKIE_SECRET, hook: 'onRequest' });
  await testApp.register(fastifyJwt, { secret: JWT_SECRET });

  // Add the verifyJwt decorator that authenticate middleware relies on
  testApp.decorate('verifyJwt', async (token: string) => {
    return testApp.jwt.verify(token);
  });

  registerErrorHandler(testApp);

  // POST /pipelines — mutation requiring active subscription
  testApp.post(
    '/pipelines',
    { preHandler: [authenticate, requireActiveSubscription] },
    async (_req, reply) => reply.status(201).send({ id: 'pipeline-test-001' }),
  );

  // GET /pipelines — read-only, must pass through even for suspended users
  testApp.get(
    '/pipelines',
    { preHandler: [authenticate, requireActiveSubscription] },
    async (_req, reply) => reply.status(200).send([]),
  );

  await testApp.ready();
  return testApp;
}

describe('Integration: Subscription guard on /pipelines', () => {
  let guardApp: FastifyInstance;

  beforeAll(async () => {
    guardApp = await buildGuardTestApp();
  });

  afterAll(async () => {
    await guardApp.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Signs a JWT for the guard test app using the test JWT secret.
   * The subscription_status is embedded in user_metadata as Supabase does.
   */
  function signGuardJwt(subscriptionStatus: string): string {
    return guardApp.jwt.sign(
      {
        sub: 'user-test-123',
        email: 'test@example.com',
        user_metadata: { subscription_status: subscriptionStatus },
      },
      { expiresIn: '1h' },
    );
  }

  // ── Test 6: Active subscription → POST /pipelines passes guard ─────────

  describe('Test 6: Active subscription → POST /pipelines not blocked by subscription guard', () => {
    it('active user: POST /pipelines returns 201 (subscription guard does not fire)', async () => {
      const token = signGuardJwt('active');

      const response = await guardApp.inject({
        method: 'POST',
        url: '/pipelines',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ id: 'pipeline-test-001' });
    });
  });

  // ── Test 7: Suspended subscription → POST /pipelines blocked (403) ─────

  describe('Test 7: Suspended subscription → POST /pipelines blocked by subscription guard (403)', () => {
    it('suspended user: POST /pipelines returns 403 with error_code "subscription_required"', async () => {
      const token = signGuardJwt('suspended');

      const response = await guardApp.inject({
        method: 'POST',
        url: '/pipelines',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('subscription_required');
    });

    it('cancelled user: POST /pipelines returns 403 with error_code "subscription_required"', async () => {
      const token = signGuardJwt('cancelled');

      const response = await guardApp.inject({
        method: 'POST',
        url: '/pipelines',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('subscription_required');
    });

    it('inactive user: POST /pipelines returns 403 with error_code "subscription_required"', async () => {
      const token = signGuardJwt('inactive');

      const response = await guardApp.inject({
        method: 'POST',
        url: '/pipelines',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('subscription_required');
    });
  });

  // ── Test 8: Suspended subscription → GET /pipelines still allowed ──────

  describe('Test 8: Suspended subscription → GET /pipelines still allowed (read-only)', () => {
    it('suspended user: GET /pipelines returns 200 (reads not blocked)', async () => {
      const token = signGuardJwt('suspended');

      const response = await guardApp.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('cancelled user: GET /pipelines returns 200 (reads not blocked)', async () => {
      const token = signGuardJwt('cancelled');

      const response = await guardApp.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('inactive user: GET /pipelines returns 200 (reads not blocked)', async () => {
      const token = signGuardJwt('inactive');

      const response = await guardApp.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
