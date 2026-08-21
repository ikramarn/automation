/**
 * Google OAuth route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase connection.
 * The Supabase admin client is mocked via vi.mock() so each test controls the
 * exact Supabase responses.
 *
 * Covered scenarios:
 *   - GET /auth/google → 302 redirect to a Google OAuth URL
 *   - GET /auth/google/callback with valid code → 302 to DASHBOARD_URL + cookie set
 *   - GET /auth/google/callback with missing code → 302 to /login?error=oauth_failed
 *   - GET /auth/google/callback with error query param → 302 to /login?error=oauth_failed
 *   - GET /auth/google/callback with Supabase exchange error → 302 to /login?error=oauth_failed
 *
 * Validates: Requirements 1.2
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
process.env['GOOGLE_OAUTH_REDIRECT_URL'] = 'https://example.com/auth/google/callback';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';

// ── Mock Supabase admin client ───────────────────────────────────────────────
const mockSignInWithOAuth = vi.fn();
const mockExchangeCodeForSession = vi.fn();

// Minimal stubs for methods used by other routes (login attempts etc.)
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbEq = vi.fn();
const mockDbGte = vi.fn();
const mockDbOrder = vi.fn();

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
        createUser: vi.fn(),
        generateLink: vi.fn().mockResolvedValue({ data: {}, error: null }),
        updateUserById: vi.fn(),
      },
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: (_table: string) => buildDbChain(),
  }),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Google OAuth routes', () => {
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
    // Default stubs for login-attempts chain (used by other auth routes)
    mockDbOrder.mockResolvedValue({ data: [], error: null });
    mockDbInsert.mockResolvedValue({ error: null });
  });

  // ── GET /auth/google ───────────────────────────────────────────────────────

  describe('GET /auth/google', () => {
    it('returns 302 redirect to a Google OAuth URL', async () => {
      const googleOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fgoogle%2Fcallback&response_type=code&scope=openid+email+profile';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: googleOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'];
      expect(location).toBe(googleOAuthUrl);
    });

    it('calls signInWithOAuth with google provider and GOOGLE_OAUTH_REDIRECT_URL', async () => {
      const googleOAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: googleOAuthUrl, provider: 'google' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/auth/google',
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            redirectTo: 'https://example.com/auth/google/callback',
          }),
        }),
      );
    });

    it('returns 502 when Supabase returns an error', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'Provider not enabled' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google',
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error_code).toBe('oauth_initiation_failed');
    });
  });

  // ── GET /auth/google/callback ──────────────────────────────────────────────

  describe('GET /auth/google/callback', () => {
    it('redirects to DASHBOARD_URL and sets session_token cookie on valid code', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'valid-google-jwt-token',
            expires_in: 86400,
          },
          user: {
            id: 'user-google-123',
            email: 'user@gmail.com',
          },
        },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=valid-auth-code&state=some-state',
      });

      expect(response.statusCode).toBe(302);

      // Should redirect to the dashboard URL
      const location = response.headers['location'];
      expect(location).toBe('https://example.com/dashboard');

      // session_token cookie should be set as HttpOnly
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : setCookieHeader;
      expect(cookieStr).toMatch(/session_token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);
    });

    it('calls exchangeCodeForSession with the code from query string', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          session: { access_token: 'jwt-token', expires_in: 86400 },
          user: { id: 'user-123', email: 'user@gmail.com' },
        },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=my-auth-code',
      });

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('my-auth-code');
    });

    it('redirects to /login?error=oauth_failed when no code is present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'];
      expect(location).toBe('/login?error=oauth_failed');
    });

    it('redirects to /login?error=oauth_failed when Google returns error param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?error=access_denied&error_description=User+denied+access',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'];
      expect(location).toBe('/login?error=oauth_failed');
    });

    it('redirects to /login?error=oauth_failed when Supabase exchangeCodeForSession fails', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid code' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=invalid-code',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'];
      expect(location).toBe('/login?error=oauth_failed');
    });

    it('redirects to /login?error=oauth_failed when session is null in response', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { session: null, user: null },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=some-code',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'];
      expect(location).toBe('/login?error=oauth_failed');
    });
  });
});
