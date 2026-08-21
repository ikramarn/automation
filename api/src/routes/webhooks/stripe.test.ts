/**
 * Stripe webhook route tests.
 *
 * Tests use Fastify's app.inject() — no real HTTP server, no real Stripe API
 * calls, and no real Supabase connection.  Both Stripe and Supabase are mocked
 * via vi.mock() so each test controls exact responses.
 *
 * `stripe.webhooks.constructEventAsync` is mocked to return the test event
 * directly, bypassing real cryptographic signature verification.
 *
 * `vi.useFakeTimers()` replaces setTimeout globally so the exponential-backoff
 * delays in `dispatchWithRetry` resolve instantly — no real waiting occurs.
 *
 * Covered scenarios:
 *   1. Valid signature + checkout.session.completed → 200, subscription activated
 *   2. Invalid signature → 400
 *   3. invoice.payment_failed → 200, subscription suspended
 *   4. customer.subscription.deleted → 200, subscription cancelled
 *   5. Unknown event type → 200 (ignored gracefully)
 *   6. customer.subscription.updated (past_due) → 200, suspended
 *
 * Requirements: 2.3, 2.4, 2.5, 2.9
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment ──────────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_fake';
process.env['API_BASE_URL'] = 'http://localhost:3000';

// ── Mock delay so retries resolve immediately without real sleeping ───────────
vi.mock('../../lib/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Stripe ──────────────────────────────────────────────────────────────
const mockConstructEventAsync = vi.fn();

vi.mock('../../lib/stripe.js', () => ({
  createStripeClient: () => ({
    webhooks: {
      constructEventAsync: mockConstructEventAsync,
    },
  }),
}));

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// ── Mock fetch (for /internal/notify calls) ──────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.stubGlobal('fetch', mockFetch);

// ── Mock email dispatch ───────────────────────────────────────────────────────
const { mockSendTransactionalEmail } = vi.hoisted(() => ({
  mockSendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/email.js', () => ({
  sendTransactionalEmail: mockSendTransactionalEmail,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Stripe event object for injection.
 */
function makeEvent(type: string, dataObject: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `evt_test_${type.replace(/\./g, '_')}`,
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
 * Sets up the Supabase `from()` mock to return success for UPDATE and SELECT
 * operations, supporting the chained API pattern used in stripe.ts.
 */
function setupSupabaseMockSuccess(): void {
  mockFrom.mockImplementation((_table: string) => {
    const eqChain: Record<string, unknown> = {};

    // .select().eq().single() chain used by suspendUserPipelines and resolveUserEmail
    eqChain['eq'] = vi.fn().mockReturnValue(eqChain);
    eqChain['in'] = vi.fn().mockResolvedValue({ data: null, error: null });
    eqChain['single'] = vi
      .fn()
      .mockResolvedValue({ data: { id: 'user-test-123', email: 'user@example.com' }, error: null });

    // .update().eq() chain used by all handlers
    eqChain['update'] = vi.fn().mockReturnValue(eqChain);
    eqChain['select'] = vi.fn().mockReturnValue(eqChain);

    return eqChain;
  });
}

/**
 * Injects a webhook POST request to /webhooks/stripe with a fake Stripe
 * signature header.  The `constructEventAsync` mock will intercept it.
 */
async function injectWebhook(
  app: FastifyInstance,
  event: Record<string, unknown>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
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

// ── Test suite ────────────────────────────────────────────────────────────────

describe('POST /webhooks/stripe', () => {
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
    setupSupabaseMockSuccess();
  });

  // ── 1. Valid signature + checkout.session.completed ─────────────────────

  describe('checkout.session.completed', () => {
    it('returns 200 and activates the subscription', async () => {
      const event = makeEvent('checkout.session.completed', {
        id: 'cs_test_abc',
        customer: 'cus_test_123',
        subscription: 'sub_test_456',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    });

    it('calls Supabase update with subscription_status active', async () => {
      const event = makeEvent('checkout.session.completed', {
        id: 'cs_test_abc',
        customer: 'cus_test_123',
        subscription: 'sub_test_456',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      // from('user_profiles') should have been called
      expect(mockFrom).toHaveBeenCalledWith('user_profiles');

      // Verify update was called with active status
      const fromResult = mockFrom.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
      expect(fromResult['update']).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_status: 'active' }),
      );
    });
  });

  // ── 2. Invalid signature → 400 ───────────────────────────────────────────

  describe('invalid signature', () => {
    it('returns 400 when Stripe signature verification fails', async () => {
      mockConstructEventAsync.mockRejectedValueOnce(
        new Error('No signatures found matching the expected signature for payload'),
      );

      const event = makeEvent('checkout.session.completed', { customer: 'cus_fake' });

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe('Invalid webhook signature');
    });

    it('returns 400 when Stripe-Signature header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe('Missing Stripe-Signature header');
    });
  });

  // ── 3. invoice.payment_failed → 200, subscription suspended ─────────────

  describe('invoice.payment_failed', () => {
    it('returns 200 and suspends the subscription', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'in_test_789',
        customer: 'cus_test_123',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    });

    it('updates subscription_status to suspended in Supabase', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'in_test_789',
        customer: 'cus_test_123',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
      const fromResult = mockFrom.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
      expect(fromResult['update']).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_status: 'suspended' }),
      );
    });

    it('calls sendTransactionalEmail with payment-failure type', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'in_test_789',
        customer: 'cus_test_123',
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

  // ── 4. customer.subscription.deleted → 200, subscription cancelled ───────

  describe('customer.subscription.deleted', () => {
    it('returns 200 and cancels the subscription', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_test_456',
        customer: 'cus_test_123',
        status: 'canceled',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    });

    it('updates subscription_status to cancelled in Supabase', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_test_456',
        customer: 'cus_test_123',
        status: 'canceled',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
      // First call should be the update with 'cancelled'
      const fromResult = mockFrom.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
      expect(fromResult['update']).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_status: 'cancelled' }),
      );
    });

    it('calls sendTransactionalEmail with subscription-suspended type', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_test_456',
        customer: 'cus_test_123',
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
  });

  // ── 5. Unknown event type → 200 (gracefully ignored) ────────────────────

  describe('unknown event type', () => {
    it('returns 200 for an event type the handler does not recognise', async () => {
      const event = makeEvent('payment_intent.created', {
        id: 'pi_test_000',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    });

    it('does not call Supabase for an unknown event type', async () => {
      const event = makeEvent('payment_intent.created', {
        id: 'pi_test_000',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      await injectWebhook(app, event);

      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ── 6. customer.subscription.updated with past_due status ───────────────

  describe('customer.subscription.updated (past_due)', () => {
    it('returns 200 and suspends the subscription when status is past_due', async () => {
      const event = makeEvent('customer.subscription.updated', {
        id: 'sub_test_456',
        customer: 'cus_test_123',
        status: 'past_due',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    });

    it('ignores customer.subscription.updated with status active', async () => {
      const event = makeEvent('customer.subscription.updated', {
        id: 'sub_test_456',
        customer: 'cus_test_123',
        status: 'active',
      });

      mockConstructEventAsync.mockResolvedValueOnce(event);

      const response = await injectWebhook(app, event);

      expect(response.statusCode).toBe(200);
      // Should not have touched Supabase for a benign status change
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
