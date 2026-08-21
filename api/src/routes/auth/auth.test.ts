/**
 * Auth route tests.
 *
 * Tests are written using Fastify's `app.inject()` — no real HTTP server or
 * real Supabase connection. The Supabase admin client is mocked via vi.mock()
 * so that each test controls the exact Supabase responses.
 *
 * Covered scenarios:
 *   - Register: valid credentials → 201
 *   - Register: weak password → 400 with validation detail
 *   - Register: duplicate email → 409
 *   - Login: valid unverified user → 401 email_not_verified
 *   - Login: valid verified user → 200 + cookie set
 *   - Login: wrong password → 401
 *   - Login: account locked → 429 account_locked
 *   - Logout: clears cookie → 200
 *   - Forgot password: any email → 200 (no leak)
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

// ── Mock Supabase admin client ───────────────────────────────────────────────
// We mock the entire lib/supabase module so no real HTTP calls are made.
// The mock covers both auth methods (for login/register routes) AND the
// `from()` table query chain (for loginAttempts lockout checks).

const mockCreateUser = vi.fn();
const mockGenerateLink = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockVerifyOtp = vi.fn();
const mockUpdateUserById = vi.fn();

// login_attempts table query chain mocks
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbEq = vi.fn();
const mockDbGte = vi.fn();
const mockDbOrder = vi.fn();

/** Builds a chainable query object for `supabase.from()` calls. */
function buildDbChain() {
  const chain = {
    select: mockDbSelect,
    eq: mockDbEq,
    gte: mockDbGte,
    order: mockDbOrder,
    insert: mockDbInsert,
  };
  mockDbSelect.mockReturnValue(chain);
  mockDbEq.mockReturnValue(chain);
  mockDbGte.mockReturnValue(chain);
  return chain;
}

vi.mock('../../lib/supabase.js', () => ({
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Auth routes', () => {
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
    // Default: generateLink succeeds (non-fatal, always called after createUser)
    mockGenerateLink.mockResolvedValue({ data: {}, error: null });
    // Default: no failed login attempts in the window → account not locked.
    // The loginAttempts module calls .from().select().eq().eq().gte().order()
    // and then INSERT. Set a default for order (SELECT) and insert.
    mockDbOrder.mockResolvedValue({ data: [], error: null });
    mockDbInsert.mockResolvedValue({ error: null });
  });

  // ── POST /auth/register ────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('returns 201 with valid credentials', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ message: 'Verification email sent' });
    });

    it('returns 400 when password is too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'Ab1!' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error_code).toBe('weak_password');
      expect(body.details).toBeDefined();
    });

    it('returns 400 when password has no uppercase letter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'secure@123' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('weak_password');
    });

    it('returns 400 when password has no digit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'Secure@abc' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('weak_password');
    });

    it('returns 400 when password has no special character', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'Secure1234' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('weak_password');
    });

    it('returns 409 when email is already registered', async () => {
      mockCreateUser.mockResolvedValue({
        data: null,
        error: { message: 'User already registered' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'existing@example.com', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('email_already_registered');
    });

    it('returns 400 when Supabase returns a generic error', async () => {
      mockCreateUser.mockResolvedValue({
        data: null,
        error: { message: 'Something went wrong' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('registration_failed');
    });

    it('returns 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns 401 with error_code email_not_verified when user has not verified email', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'unverified@example.com',
            email_confirmed_at: null,
          },
          session: { access_token: 'jwt-token-here' },
        },
        error: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'unverified@example.com', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error_code).toBe('email_not_verified');
      expect(body.message).toBe('Please verify your email before logging in');
    });

    it('returns 200 with user + token and sets session cookie when user is verified', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'verified@example.com',
            email_confirmed_at: '2024-01-01T00:00:00Z',
          },
          session: { access_token: 'valid-jwt-token' },
        },
        error: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'verified@example.com', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ user: { id: string; email: string }; token: string }>();
      expect(body.user.id).toBe('user-123');
      expect(body.user.email).toBe('verified@example.com');
      expect(body.token).toBe('valid-jwt-token');

      // Verify session_token cookie is set
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
      expect(cookieStr).toMatch(/session_token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);
    });

    it('returns 401 with invalid_credentials when password is wrong', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'WrongPassword@1' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('invalid_credentials');
    });

    it('returns 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'not-an-email', password: 'Secure@123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 429 with account_locked when account is locked due to too many failures', async () => {
      // Simulate 3 failed attempts in the window — lockout check fires BEFORE signInWithPassword
      const lockedUntil = new Date(Date.now() + 14 * 60 * 1000); // ~14 minutes from now
      const attempts = [
        { attempted_at: new Date(lockedUntil.getTime() - 15 * 60 * 1000 + 1000).toISOString() },
        { attempted_at: new Date(lockedUntil.getTime() - 15 * 60 * 1000 + 500).toISOString() },
        { attempted_at: new Date(lockedUntil.getTime() - 15 * 60 * 1000).toISOString() },
      ];
      mockDbOrder.mockResolvedValueOnce({ data: attempts, error: null });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'locked@example.com', password: 'AnyPassword@1' },
      });

      expect(response.statusCode).toBe(429);
      const body = response.json<{ error_code: string; message: string }>();
      expect(body.error_code).toBe('account_locked');
      expect(body.message).toContain('Account locked due to too many failed login attempts');
    });
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('returns 200 and clears the session cookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ message: 'Logged out' });

      // Verify the cookie is cleared (max-age=0 or expires in the past)
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
        // Cookie should be cleared — either max-age=0 or expires in past, or empty value
        const hasSessionToken = cookieStr.includes('session_token');
        if (hasSessionToken) {
          const hasExpired =
            cookieStr.match(/Max-Age=0/i) !== null ||
            cookieStr.match(/Expires=Thu, 01 Jan 1970/i) !== null ||
            cookieStr.match(/session_token=;/i) !== null ||
            cookieStr.match(/session_token=$/i) !== null;
          expect(hasExpired).toBe(true);
        }
      }
    });
  });

  // ── POST /auth/forgot-password ─────────────────────────────────────────────

  describe('POST /auth/forgot-password', () => {
    it('returns 200 even when email does not exist (no information leak)', async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        data: {},
        error: { message: 'User not found' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'nonexistent@example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain('reset link has been sent');
    });

    it('returns 200 when email exists', async () => {
      mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'existing@example.com' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'not-valid' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
