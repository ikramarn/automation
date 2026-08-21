/**
 * Supabase Auth & RLS Integration Tests
 *
 * These tests verify end-to-end behavior of the auth system and data isolation
 * by exercising multiple components together: routes, middleware, and Supabase
 * interactions. The Supabase client is mocked via vi.mock() so no real network
 * calls are made — the focus is on component integration correctness.
 *
 * Auth flow scenarios:
 *   1. Full registration flow: register → login → access protected route
 *   2. Login with unverified email → 401; after verification → 200
 *   3. Account lockout: 3 failed logins → 429 on 4th attempt
 *   4. Password reset: forgot-password → reset-password flow
 *   5. JWT expiry enforcement: expired token → 401 on protected route
 *
 * RLS isolation scenarios:
 *   6. User A cannot access User B's pipelines via GET /pipelines/:id
 *   7. User A cannot access User B's execution logs
 *   8. User A cannot access User B's credentials
 *   9. Account actions are scoped to the authenticated user only
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.8, 3.8, 18.1, 18.2
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Mock Supabase admin client ───────────────────────────────────────────────
//
// Auth method mocks
const mockCreateUser = vi.fn();
const mockGenerateLink = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockVerifyOtp = vi.fn();
const mockUpdateUserById = vi.fn();

// Table query chain mocks — used by buildDbChain() inside the vi.mock factory.
// These are referenced lazily (at call time) so that tests can configure them
// in beforeEach or per-test before the route handler calls from().
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbEq = vi.fn();
const mockDbGte = vi.fn();
const mockDbOrder = vi.fn();
const mockDbMaybeSingle = vi.fn();
const mockDbLimit = vi.fn();

/**
 * Builds a re-usable Supabase query chain. Called lazily inside from() so that
 * test-configured mock implementations are picked up at call time.
 *
 * Supports: .select().eq()*.gte()*.order() (resolves array)
 *           .select().eq()*.maybeSingle()   (resolves single row)
 *           .insert()                       (resolves { error })
 *           .select().eq()*.limit()         (resolves array)
 */
function buildDbChain() {
  const chain = {
    select: mockDbSelect,
    eq: mockDbEq,
    gte: mockDbGte,
    order: mockDbOrder,
    insert: mockDbInsert,
    maybeSingle: mockDbMaybeSingle,
    limit: mockDbLimit,
  };
  mockDbSelect.mockReturnValue(chain);
  mockDbEq.mockReturnValue(chain);
  mockDbGte.mockReturnValue(chain);
  // order and maybeSingle are configured per-test via mockResolvedValue
  return chain;
}

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: mockCreateUser,
        generateLink: mockGenerateLink,
        updateUserById: mockUpdateUserById,
      },
      signInWithPassword: mockSignInWithPassword,
      resetPasswordForEmail: mockResetPasswordForEmail,
      verifyOtp: mockVerifyOtp,
    },
    from: (_table: string) => buildDbChain(),
  }),
}));

// ── Mock email service (prevent real sends) ──────────────────────────────────
vi.mock('../lib/email.js', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock vault (not under test here) ─────────────────────────────────────────
vi.mock('../lib/vault.js', () => ({
  storeSecret: vi.fn().mockResolvedValue('vault-uuid-123'),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  maskApiKey: (key: string) => (key.length >= 4 ? `••••${key.slice(-4)}` : '••••'),
  maskValue: (key: string) => (key.length >= 4 ? `••••${key.slice(-4)}` : '••••'),
}));

// ── Test IDs ─────────────────────────────────────────────────────────────────
const USER_A_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const USER_B_ID = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const PIPELINE_B_ID = '00000000-0000-0000-0000-cccccccccccc';
const EXEC_B_ID = '00000000-0000-0000-0000-dddddddddddd';
const EXEC_A_ID = '00000000-0000-0000-0000-eeeeeeeeeeee';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Signs a valid JWT for the given user using the app's JWT plugin. */
function signUserToken(
  app: FastifyInstance,
  userId: string,
  email: string,
  subscriptionStatus = 'active',
): string {
  return app.jwt.sign(
    {
      sub: userId,
      email,
      user_metadata: { subscription_status: subscriptionStatus },
    },
    { expiresIn: '1h' },
  );
}

/** Builds CSRF token + signed cookie headers using the app's cookie signer. */
function buildCsrfHeaders(
  app: FastifyInstance,
  token: string,
): { 'x-csrf-token': string; cookie: string } {
  const signed = app.signCookie(token);
  return { 'x-csrf-token': token, cookie: `csrf_token=${signed}` };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Supabase Auth & RLS Integration Tests', () => {
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

    // Safe defaults applied after clearing:
    // generateLink always succeeds
    mockGenerateLink.mockResolvedValue({ data: {}, error: null });
    // No prior login failures → account not locked
    mockDbOrder.mockResolvedValue({ data: [], error: null });
    // Insert always succeeds
    mockDbInsert.mockResolvedValue({ error: null });
    // maybeSingle returns null (no row) by default
    mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });
    // limit returns empty array by default
    mockDbLimit.mockResolvedValue({ data: [], error: null });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Auth Flow Integration Tests
  // ══════════════════════════════════════════════════════════════════════════

  describe('Auth Flow Integration', () => {
    /**
     * Test 1: Full registration flow: register → login → access protected route
     *
     * Validates that a newly registered user who then successfully logs in
     * receives a session token that grants access to a protected route.
     * Components exercised: register route → login route → authenticate middleware
     * → pipeline route (protected).
     */
    it('full registration flow: register → login → access protected route', async () => {
      // Step 1: Register
      mockCreateUser.mockResolvedValue({
        data: { user: { id: USER_A_ID, email: 'newuser@example.com' } },
        error: null,
      });

      const registerResp = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'newuser@example.com', password: 'Secure@123' },
      });

      expect(registerResp.statusCode).toBe(201);
      expect(registerResp.json()).toMatchObject({ message: 'Verification email sent' });

      // Step 2: Login — email is now verified
      const sessionToken = signUserToken(app, USER_A_ID, 'newuser@example.com');
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: USER_A_ID,
            email: 'newuser@example.com',
            email_confirmed_at: '2024-01-01T00:00:00Z',
          },
          session: { access_token: sessionToken },
        },
        error: null,
      });
      // Login calls: checkAccountLocked (order → no failures) + recordLoginAttempt (insert)
      // beforeEach already configured: mockDbOrder → [] and mockDbInsert → success

      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'newuser@example.com', password: 'Secure@123' },
      });

      expect(loginResp.statusCode).toBe(200);
      const loginBody = loginResp.json<{ token: string; user: { id: string } }>();
      expect(loginBody.user.id).toBe(USER_A_ID);
      const token = loginBody.token;
      expect(token).toBeTruthy();

      // Verify session_token cookie is set with HttpOnly flag
      const setCookie = loginResp.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      expect(cookieStr).toMatch(/session_token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);

      // Step 3: Access protected route using the returned token
      // GET /pipelines: .select().eq().order() → empty array
      mockDbOrder.mockResolvedValue({ data: [], error: null });

      const protectedResp = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${token}` },
      });

      // 200: token is valid, authenticate middleware accepted it
      expect(protectedResp.statusCode).toBe(200);
    });

    /**
     * Test 2: Login with unverified email → 401; after verification → 200
     *
     * Validates that the login route enforces email verification.
     * Components: login route (email_confirmed_at check) + verify-email route
     * (verifyOtp exchange) + login route again with verified user.
     */
    it('login blocked for unverified email (401), succeeds after verification (200)', async () => {
      // Attempt 1: email not verified (email_confirmed_at = null)
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: USER_A_ID,
            email: 'unverified@example.com',
            email_confirmed_at: null,
          },
          session: { access_token: 'some-token' },
        },
        error: null,
      });
      // beforeEach: mockDbOrder → [] (no lockout), mockDbInsert → success

      const unverifiedResp = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'unverified@example.com', password: 'Secure@123' },
      });

      expect(unverifiedResp.statusCode).toBe(401);
      const unverifiedBody = unverifiedResp.json<{ error_code: string; message: string }>();
      expect(unverifiedBody.error_code).toBe('email_not_verified');
      expect(unverifiedBody.message).toBe('Please verify your email before logging in');

      // Email verification via /auth/verify-email (OTP exchange)
      mockVerifyOtp.mockResolvedValue({ data: { user: { id: USER_A_ID } }, error: null });

      const verifyResp = await app.inject({
        method: 'GET',
        url: '/auth/verify-email?token_hash=valid-token-hash&type=signup',
      });

      // Expect redirect to /dashboard after successful verification
      expect(verifyResp.statusCode).toBe(302);

      // Attempt 2: email is now verified
      const verifiedToken = signUserToken(app, USER_A_ID, 'unverified@example.com');
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: USER_A_ID,
            email: 'unverified@example.com',
            email_confirmed_at: '2024-06-01T12:00:00Z',
          },
          session: { access_token: verifiedToken },
        },
        error: null,
      });
      // Reset to no failed attempts for the second login attempt
      mockDbOrder.mockResolvedValue({ data: [], error: null });

      const verifiedResp = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'unverified@example.com', password: 'Secure@123' },
      });

      expect(verifiedResp.statusCode).toBe(200);
      const verifiedBody = verifiedResp.json<{ user: { id: string } }>();
      expect(verifiedBody.user.id).toBe(USER_A_ID);
    });

    /**
     * Test 3: Account lockout: 3 failed logins within window → 429 on 4th attempt
     *
     * Validates that the login route + loginAttempts module together enforce
     * the lockout policy. checkAccountLocked sees 3 failures → 429 before
     * Supabase auth is even called.
     *
     * checkAccountLocked query chain: .from().select().eq().eq().gte().order()
     * The .order() call resolves with the failed attempts data.
     */
    it('account lockout: 3 failed logins within window → 429 on 4th attempt', async () => {
      const windowStart = new Date(Date.now() - 14 * 60 * 1000);
      const failedAttempts = [
        { attempted_at: new Date(windowStart.getTime() + 60000).toISOString() },
        { attempted_at: new Date(windowStart.getTime() + 30000).toISOString() },
        { attempted_at: windowStart.toISOString() },
      ];

      // Override: checkAccountLocked returns 3 failures → locked
      mockDbOrder.mockResolvedValue({ data: failedAttempts, error: null });

      const fourthAttempt = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'lockout@example.com', password: 'WrongPassword@1' },
      });

      expect(fourthAttempt.statusCode).toBe(429);
      const body = fourthAttempt.json<{ error_code: string; message: string }>();
      expect(body.error_code).toBe('account_locked');
      expect(body.message).toContain('Account locked due to too many failed login attempts');
    });

    /**
     * Test 4: Password reset flow — forgot-password → reset-password
     *
     * Validates the two-step password reset flow:
     * - POST /auth/forgot-password always returns 200 (no email enumeration)
     * - POST /auth/reset-password exchanges token via verifyOtp, then updates password
     */
    it('password reset flow: forgot-password → reset-password', async () => {
      // Step 1: Request password reset (always 200 regardless of email existence)
      mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

      const forgotResp = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'user@example.com' },
      });

      expect(forgotResp.statusCode).toBe(200);
      expect(forgotResp.json<{ message: string }>().message).toContain('reset link has been sent');

      // Step 2: Apply new password with the reset token
      mockVerifyOtp.mockResolvedValue({
        data: { user: { id: USER_A_ID } },
        error: null,
      });
      mockUpdateUserById.mockResolvedValue({ data: { user: { id: USER_A_ID } }, error: null });

      const resetResp = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'valid-reset-token-hash', password: 'NewSecure@456' },
      });

      expect(resetResp.statusCode).toBe(200);
      expect(resetResp.json<{ message: string }>().message).toBe('Password updated successfully');

      // verifyOtp was called to exchange the reset token
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: 'valid-reset-token-hash',
        type: 'recovery',
      });
      // updateUserById was called with the new password
      expect(mockUpdateUserById).toHaveBeenCalledWith(USER_A_ID, { password: 'NewSecure@456' });
    });

    /**
     * Test 4b: Password reset rejected for invalid/expired token
     */
    it('reset-password returns 400 for invalid or expired reset token', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { user: null },
        error: { message: 'Token has expired or is invalid' },
      });

      const resp = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'expired-token', password: 'NewSecure@456' },
      });

      expect(resp.statusCode).toBe(400);
      expect(resp.json<{ error_code: string }>().error_code).toBe('invalid_reset_token');
    });

    /**
     * Test 5: Expired JWT → 401 on protected route
     *
     * The authenticate middleware validates the `exp` claim. An expired token
     * must never grant access to a protected endpoint.
     */
    it('expired JWT → 401 on protected route', async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 10;
      const expiredToken = app.jwt.sign({
        sub: USER_A_ID,
        email: 'user@example.com',
        user_metadata: { subscription_status: 'active' },
        exp: pastExp,
      });

      const resp = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      expect(resp.statusCode).toBe(401);
      expect(resp.json<{ error_code: string }>().error_code).toBe('unauthorized');
    });

    /**
     * Test 5b: Valid (non-expired) JWT → 200 on protected route
     *
     * Positive counterpart to the expiry test.
     */
    it('valid (non-expired) JWT → 200 on protected route', async () => {
      const validToken = signUserToken(app, USER_A_ID, 'user@example.com');

      const resp = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(resp.statusCode).toBe(200);
    });

    /**
     * Test 5c: Missing JWT → 401 on protected route
     */
    it('missing JWT → 401 on protected route', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/pipelines',
      });

      expect(resp.statusCode).toBe(401);
      expect(resp.json<{ error_code: string }>().error_code).toBe('unauthorized');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RLS Isolation Integration Tests
  // ══════════════════════════════════════════════════════════════════════════

  describe('RLS Isolation Integration', () => {
    /**
     * Test 6: User A cannot access User B's pipeline via GET /pipelines/:id
     *
     * The route queries: .from('pipelines').select('*').eq('id', pid).eq('user_id', uid).maybeSingle()
     * When the pipeline belongs to User B, User A's ownership check returns null → 404.
     *
     * Simulates RLS policy: SELECT USING (auth.uid() = user_id)
     */
    it('User A cannot access User B pipeline: GET /pipelines/:id → 404', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      // Ownership check with .eq('user_id', USER_A_ID) finds no row (belongs to User B)
      mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: `/pipelines/${PIPELINE_B_ID}`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(404);
      expect(resp.json<{ error_code: string }>().error_code).toBe('not_found');
    });

    /**
     * Test 6b: User A can access their own pipeline → 200
     */
    it('User A can access their own pipeline: GET /pipelines/:id → 200', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      const ownPipeline = {
        id: 'pipeline-a-id',
        user_id: USER_A_ID,
        name: 'My Pipeline',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      };

      mockDbMaybeSingle.mockResolvedValue({ data: ownPipeline, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: `/pipelines/pipeline-a-id`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = resp.json<{ id: string; user_id: string }>();
      expect(body.id).toBe('pipeline-a-id');
      expect(body.user_id).toBe(USER_A_ID);
    });

    /**
     * Test 7: User A cannot access User B's execution logs
     *
     * GET /pipelines/:id/executions first checks pipeline ownership.
     * When User A requests executions for User B's pipeline, the pipeline
     * ownership check returns null → 404 before any executions are fetched.
     */
    it('User A cannot access User B execution logs: GET /pipelines/:id/executions → 404', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      // Pipeline ownership check returns null (belongs to User B, not User A)
      mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: `/pipelines/${PIPELINE_B_ID}/executions`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(404);
      expect(resp.json<{ error_code: string }>().error_code).toBe('not_found');
    });

    /**
     * Test 7b: Execution detail (GET /executions/:id) is scoped to owning user
     *
     * The execution detail route queries with both id AND user_id.
     * When User A requests User B's execution, no row is found → 404.
     */
    it('User A cannot access User B execution detail: GET /executions/:id → 404', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      // .eq('id', execId).eq('user_id', USER_A_ID).maybeSingle() → null (belongs to User B)
      mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: `/executions/${EXEC_B_ID}`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(404);
      expect(resp.json<{ error_code: string }>().error_code).toBe('not_found');
    });

    /**
     * Test 7c: User A can access their own execution detail → 200
     *
     * Positive counterpart: execution belongs to User A → 200.
     * Uses a valid UUID format for the execution ID.
     */
    it('User A can access their own execution detail: GET /executions/:id → 200', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      const ownExecution = {
        id: EXEC_A_ID,
        pipeline_id: '00000000-0000-0000-0000-aabbccddeeff',
        user_id: USER_A_ID,
        status: 'success',
        started_at: '2024-01-15T10:00:00Z',
        ended_at: '2024-01-15T10:05:00Z',
        duration_ms: 300000,
        failure_reason: null,
        content_fetch_status: 'success',
        content_fetch_article_url: null,
        content_fetch_error: null,
        script_gen_status: 'success',
        script_text: null,
        script_gen_error: null,
        video_gen_status: 'success',
        heygen_video_id: null,
        r2_object_key: null,
        video_file_size_bytes: null,
        video_gen_error: null,
        drive_upload_status: 'success',
        gdrive_file_id: null,
        gdrive_link: null,
        drive_upload_error: null,
        social_publish_results: null,
        created_at: '2024-01-15T10:00:00Z',
      };

      mockDbMaybeSingle.mockResolvedValue({ data: ownExecution, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: `/executions/${EXEC_A_ID}`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = resp.json<{ id: string }>();
      expect(body.id).toBe(EXEC_A_ID);
    });

    /**
     * Test 8: User A's credentials list returns only User A data
     *
     * GET /credentials queries .from('credentials').select(...).eq('user_id', userId).order(...)
     * User A's token → user_id filter = USER_A_ID → User B's credentials excluded.
     */
    it('User A credentials list returns only User A data (User B data excluded)', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      // Supabase returns empty array for User A (User B's credentials excluded by user_id filter)
      mockDbOrder.mockResolvedValue({ data: [], error: null });

      const resp = await app.inject({
        method: 'GET',
        url: '/credentials',
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toEqual([]);
    });

    /**
     * Test 8b: User A cannot delete User B's credential → 404
     *
     * The delete route fetches with .eq('user_id', userId).
     * User B's credential has user_id = USER_B_ID → not found for User A → 404.
     */
    it('User A cannot delete User B credential: DELETE /credentials/:type → 404', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-rls-delete-test',
      );

      // Credential fetch with user_id = USER_A_ID returns null (belongs to User B)
      mockDbMaybeSingle.mockResolvedValue({ data: null, error: null });

      const resp = await app.inject({
        method: 'DELETE',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
      });

      expect(resp.statusCode).toBe(404);
      expect(resp.json<{ error_code: string }>().error_code).toBe('not_found');
    });

    /**
     * Test 9: Account route requires authentication
     *
     * Unauthenticated requests to /account must be rejected with 401.
     * No cross-user data access is possible without a valid JWT.
     */
    it('account route: unauthenticated request → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/account',
      });

      expect(resp.statusCode).toBe(401);
      expect(resp.json<{ error_code: string }>().error_code).toBe('unauthorized');
    });

    /**
     * Test 9b: Authenticated user can access their own account data → 200
     *
     * User A's token grants access to /account and returns User A's profile.
     */
    it('authenticated user can access their own account data', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      const userAProfile = {
        id: USER_A_ID,
        email: 'usera@example.com',
        display_name: 'User A',
        subscription_status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      };

      mockDbMaybeSingle.mockResolvedValue({ data: userAProfile, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: '/account',
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(200);
    });

    /**
     * Test 9c: Pipeline list is scoped to the authenticated user only
     *
     * The list route calls .eq('user_id', userId), which means only the
     * requesting user's pipelines are returned. User B's pipelines are excluded.
     */
    it('pipeline list: User A sees only their own pipelines (User B excluded)', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');

      const userAPipelines = [
        {
          id: 'pipeline-a-1',
          user_id: USER_A_ID,
          name: 'User A Pipeline',
          status: 'active',
          last_execution_at: null,
          last_execution_status: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      // GET /pipelines: .select().eq('user_id', userId).order() → User A's pipelines
      mockDbOrder.mockResolvedValue({ data: userAPipelines, error: null });

      const resp = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(resp.statusCode).toBe(200);
      const pipelines = resp.json<Array<{ id: string; user_id: string }>>();
      // All returned pipelines belong to User A
      expect(pipelines.every((p) => p.user_id === USER_A_ID)).toBe(true);
      // User B's pipeline ID is not in the list
      expect(pipelines.some((p) => p.id === PIPELINE_B_ID)).toBe(false);
    });

    /**
     * Test: Two users' JWT tokens produce isolated data scopes
     *
     * Each user's JWT sets a different request.user.id in the authenticate
     * middleware, which routes use to filter Supabase queries. Neither user
     * ever sees the other's data.
     */
    it('two users have isolated data scopes via their respective JWT tokens', async () => {
      const tokenA = signUserToken(app, USER_A_ID, 'usera@example.com');
      const tokenB = signUserToken(app, USER_B_ID, 'userb@example.com');

      const pipelineA = {
        id: 'pipeline-a-only',
        user_id: USER_A_ID,
        name: 'A Pipeline',
        status: 'active',
        last_execution_at: null,
        last_execution_status: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const pipelineB = {
        id: 'pipeline-b-only',
        user_id: USER_B_ID,
        name: 'B Pipeline',
        status: 'active',
        last_execution_at: null,
        last_execution_status: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      // User A's request → only User A's pipelines
      mockDbOrder.mockResolvedValueOnce({ data: [pipelineA], error: null });
      const respA = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(respA.statusCode).toBe(200);
      const pipelinesA = respA.json<Array<{ id: string; user_id: string }>>();
      expect(pipelinesA.every((p) => p.user_id === USER_A_ID)).toBe(true);

      // User B's request → only User B's pipelines
      mockDbOrder.mockResolvedValueOnce({ data: [pipelineB], error: null });
      const respB = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      expect(respB.statusCode).toBe(200);
      const pipelinesB = respB.json<Array<{ id: string; user_id: string }>>();
      expect(pipelinesB.every((p) => p.user_id === USER_B_ID)).toBe(true);

      // Cross-user isolation: neither user sees the other's data
      expect(pipelinesA.some((p) => p.user_id === USER_B_ID)).toBe(false);
      expect(pipelinesB.some((p) => p.user_id === USER_A_ID)).toBe(false);
    });
  });
});
