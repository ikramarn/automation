/**
 * Subscription route tests.
 *
 * Tests use Fastify's app.inject() — no real HTTP server, no real Stripe API
 * calls, and no real Supabase connection. Both Stripe and Supabase are mocked
 * via vi.mock() so each test controls exact responses.
 *
 * Covered scenarios:
 *   POST /subscription/checkout → 200 with redirect URL
 *   POST /subscription/checkout → creates a new Stripe customer when none exists
 *   GET  /subscription/portal   → 200 with portal URL
 *   GET  /subscription/status   → 200 with subscription info
 *   GET  /subscription/portal   → 400 when no Stripe customer exists
 *
 * Requirements: 2.1, 2.2, 2.8
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake_key_for_tests';
process.env['STRIPE_PRICE_ID'] = 'price_test_123';
process.env['STRIPE_SUCCESS_URL'] = 'https://example.com/success';
process.env['STRIPE_CANCEL_URL'] = 'https://example.com/cancel';
process.env['STRIPE_PORTAL_RETURN_URL'] = 'https://example.com/dashboard';

// ── Mock Stripe client ───────────────────────────────────────────────────────
const mockStripeCustomersCreate = vi.fn();
const mockStripeCheckoutSessionsCreate = vi.fn();
const mockStripeBillingPortalSessionsCreate = vi.fn();

const mockStripeInstance = {
  customers: {
    create: mockStripeCustomersCreate,
  },
  checkout: {
    sessions: {
      create: mockStripeCheckoutSessionsCreate,
    },
  },
  billingPortal: {
    sessions: {
      create: mockStripeBillingPortalSessionsCreate,
    },
  },
};

vi.mock('../../lib/stripe.js', () => ({
  createStripeClient: () => mockStripeInstance,
}));

// ── Mock Supabase admin client ───────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {},
    },
    from: mockFrom,
  }),
}));

// ── Helper: build JWT for a test user ────────────────────────────────────────
// We sign a JWT using @fastify/jwt directly via the built app.
let testJwt: string;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  // Sign a token that authenticate middleware will accept
  testJwt = app.jwt.sign(
    {
      sub: 'user-test-123',
      email: 'test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Subscription routes', () => {
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

    // Default Stripe mocks
    mockStripeCustomersCreate.mockResolvedValue({
      id: 'cus_new_123',
      email: 'test@example.com',
    });

    mockStripeCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_abc',
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
    });

    mockStripeBillingPortalSessionsCreate.mockResolvedValue({
      id: 'bps_test_xyz',
      url: 'https://billing.stripe.com/session/bps_test_xyz',
    });

    // Default Supabase: user already has a stripe_customer_id
    setupSupabaseMockWithCustomer('cus_existing_456');
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Sets up the Supabase from() mock to return the given stripe_customer_id
   * for SELECT queries and succeed for UPDATE queries.
   */
  function setupSupabaseMockWithCustomer(customerId: string | null): void {
    const singleResult = {
      data: {
        stripe_customer_id: customerId,
        subscription_status: 'active',
        stripe_subscription_id: 'sub_existing_789',
        subscription_expires_at: '2025-12-31T23:59:59Z',
      },
      error: null,
    };

    const eqChain = {
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue(singleResult),
    };
    // eq returns itself so we can chain multiple .eq() calls
    eqChain.eq.mockReturnValue(eqChain);

    const selectChain = {
      select: vi.fn().mockReturnValue(eqChain),
    };

    const updateEqChain = {
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const updateChain = {
      update: vi.fn().mockReturnValue(updateEqChain),
    };

    mockFrom.mockImplementation((_table: string) => ({
      ...selectChain,
      ...updateChain,
    }));
  }

  function setupSupabaseMockNoCustomer(): void {
    const singleResult = {
      data: {
        stripe_customer_id: null,
        subscription_status: 'inactive',
        stripe_subscription_id: null,
        subscription_expires_at: null,
      },
      error: null,
    };

    const eqChain = {
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue(singleResult),
    };
    eqChain.eq.mockReturnValue(eqChain);

    const selectChain = {
      select: vi.fn().mockReturnValue(eqChain),
    };

    const updateEqChain = {
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const updateChain = {
      update: vi.fn().mockReturnValue(updateEqChain),
    };

    mockFrom.mockImplementation((_table: string) => ({
      ...selectChain,
      ...updateChain,
    }));
  }

  // ── POST /subscription/checkout ──────────────────────────────────────────

  describe('POST /subscription/checkout', () => {
    it('returns 200 with a Stripe checkout redirect URL when customer already exists', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'POST',
        url: '/subscription/checkout',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ url: string }>();
      expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
    });

    it('creates a new Stripe customer when none exists and returns checkout URL', async () => {
      setupSupabaseMockNoCustomer();
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'POST',
        url: '/subscription/checkout',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ url: string }>();
      expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');

      // Verify a new customer was created in Stripe
      expect(mockStripeCustomersCreate).toHaveBeenCalledOnce();
      expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com' }),
      );
    });

    it('creates the checkout session with correct parameters', async () => {
      const token = await getTestJwt(app);

      await app.inject({
        method: 'POST',
        url: '/subscription/checkout',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledOnce();
      expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer: 'cus_existing_456',
          client_reference_id: 'user-test-123',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        }),
      );
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/subscription/checkout',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /subscription/portal ─────────────────────────────────────────────

  describe('GET /subscription/portal', () => {
    it('returns 200 with a Stripe Customer Portal URL', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'GET',
        url: '/subscription/portal',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ url: string }>();
      expect(body.url).toBe('https://billing.stripe.com/session/bps_test_xyz');
    });

    it('creates the portal session with the correct customer ID', async () => {
      const token = await getTestJwt(app);

      await app.inject({
        method: 'GET',
        url: '/subscription/portal',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledOnce();
      expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_existing_456',
          return_url: 'https://example.com/dashboard',
        }),
      );
    });

    it('returns 400 when user has no Stripe customer ID', async () => {
      setupSupabaseMockNoCustomer();
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'GET',
        url: '/subscription/portal',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('no_subscription');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/subscription/portal',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /subscription/status ─────────────────────────────────────────────

  describe('GET /subscription/status', () => {
    it('returns 200 with subscription status fields', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'GET',
        url: '/subscription/status',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        subscription_status: string;
        stripe_subscription_id: string | null;
        subscription_expires_at: string | null;
      }>();
      expect(body.subscription_status).toBe('active');
      expect(body.stripe_subscription_id).toBe('sub_existing_789');
      expect(body.subscription_expires_at).toBe('2025-12-31T23:59:59Z');
    });

    it('returns inactive status with null expiry for user without subscription', async () => {
      setupSupabaseMockNoCustomer();
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'GET',
        url: '/subscription/status',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        subscription_status: string;
        stripe_subscription_id: string | null;
        subscription_expires_at: string | null;
      }>();
      expect(body.subscription_status).toBe('inactive');
      expect(body.stripe_subscription_id).toBeNull();
      expect(body.subscription_expires_at).toBeNull();
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/subscription/status',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
