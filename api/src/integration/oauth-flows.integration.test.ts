/**
 * OAuth Flows Integration Tests
 *
 * End-to-end integration tests covering the full OAuth redirect flow across
 * multiple components: Supabase auth, Vault storage, and DB metadata rows.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase
 * connection. Supabase admin client and vault helpers are mocked via vi.mock()
 * so each test controls exact responses while exercising the full request path
 * through Fastify plugins, middleware, and route handlers.
 *
 * ── Test scenarios ─────────────────────────────────────────────────────────
 *
 * Google OAuth Login (auth/google)
 *   1. GET /auth/google → 302 redirect to Google OAuth URL
 *   2. GET /auth/google/callback (valid code) → exchanges code, sets
 *      session_token cookie, redirects to dashboard
 *   3. GET /auth/google/callback (user denied) → redirects to
 *      /login?error=oauth_failed
 *
 * Google Drive OAuth (credentials/google)
 *   4. GET /credentials/google/connect → 302 redirect to Google OAuth URL
 *      with drive.file scope
 *   5. GET /credentials/google/callback (valid code) → stores refresh token
 *      in vault, redirects to /settings/credentials?drive=connected
 *   6. GET /credentials/google/callback (user denied) → redirects to
 *      /settings/credentials?error=drive_oauth_failed
 *   7. GET /credentials/google/callback (no refresh token in session) →
 *      redirects with error
 *   8. DELETE /credentials/google (authenticated) → deletes vault secret,
 *      returns 200
 *
 * Social Platform OAuth (credentials/social/:platform)
 *   9.  GET /credentials/social/youtube/connect → 302 to OAuth URL with
 *       youtube.upload scope
 *  10.  GET /credentials/social/youtube/callback (valid code) → stores
 *       access + refresh tokens, redirects with social=connected
 *  11.  GET /credentials/social/youtube/callback (error) → redirects with
 *       error query param
 *  12.  DELETE /credentials/social/youtube (authenticated) → pauses
 *       pipelines, deletes tokens, returns 200
 *
 * Validates: Requirements 1.2, 4.1, 4.2, 4.4, 4.7, 4.8, 5.1, 5.5, 5.8, 5.11
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
process.env['GOOGLE_OAUTH_REDIRECT_URL'] = 'https://example.com/auth/google/callback';
process.env['GOOGLE_DRIVE_REDIRECT_URL'] = 'https://example.com/credentials/google/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL'] = 'https://example.com/credentials/social/callback';
process.env['API_BASE_URL'] = 'https://example.com';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';

// ── Mock: vault helpers ──────────────────────────────────────────────────────
const mockStoreSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('../lib/vault.js', () => ({
  storeSecret: (...args: unknown[]) => mockStoreSecret(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  maskValue: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
  maskApiKey: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
}));

// ── Mock: Supabase admin client ──────────────────────────────────────────────
const mockSignInWithOAuth = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockDbFrom = vi.fn();

vi.mock('../lib/supabase.js', () => ({
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
    from: (table: string) => mockDbFrom(table),
  }),
}));

// ── Mock: email (used by register/forgot-password routes loaded by buildApp) ─
vi.mock('../lib/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Returns a fully fluent Supabase DB chain mock that resolves terminal
 * calls (maybeSingle, upsert, order, insert, in, select with await) to the
 * provided terminalValue.
 */
function buildFluentChain(terminalValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn().mockResolvedValue(terminalValue),
    maybeSingle: vi.fn().mockResolvedValue(terminalValue),
    order: vi.fn().mockResolvedValue(terminalValue),
    insert: vi.fn().mockResolvedValue(terminalValue),
    update: vi.fn(),
    in: vi.fn().mockResolvedValue(terminalValue),
    contains: vi.fn(),
    gte: vi.fn(),
  };
  chain['select']!.mockReturnValue(chain);
  chain['eq']!.mockReturnValue(chain);
  chain['delete']!.mockReturnValue(chain);
  chain['update']!.mockReturnValue(chain);
  chain['in']!.mockReturnValue(chain);
  chain['contains']!.mockReturnValue(chain);
  chain['gte']!.mockReturnValue(chain);
  return chain;
}

/** Builds a realistic Supabase exchangeCodeForSession response for OAuth login. */
function buildLoginSession(userId = 'user-oauth-123') {
  return {
    data: {
      session: {
        access_token: 'valid-access-token',
        expires_in: 86400,
        user: { id: userId, email: 'user@example.com' },
      },
      user: { id: userId, email: 'user@example.com' },
    },
    error: null,
  };
}

/** Builds a Supabase session response with Drive provider tokens. */
function buildDriveSession(opts: { userId?: string; hasRefreshToken?: boolean } = {}) {
  const userId = opts.userId ?? 'user-drive-123';
  const hasRefreshToken = opts.hasRefreshToken ?? true;
  return {
    data: {
      session: {
        access_token: 'supabase-jwt',
        expires_in: 3600,
        provider_token: 'provider-access-token',
        ...(hasRefreshToken ? { provider_refresh_token: 'drive-refresh-token-value' } : {}),
        user: { id: userId, email: 'user@example.com' },
      },
      user: { id: userId, email: 'user@example.com' },
    },
    error: null,
  };
}

/** Builds a Supabase session response with social provider tokens. */
function buildSocialSession(
  userId = 'user-social-123',
  providerToken = 'social-access-token',
  refreshToken: string | null = 'social-refresh-token',
) {
  return {
    data: {
      session: {
        access_token: 'supabase-jwt',
        expires_in: 3600,
        provider_token: providerToken,
        ...(refreshToken !== null ? { provider_refresh_token: refreshToken } : {}),
        user: { id: userId, email: 'user@example.com' },
      },
      user: { id: userId, email: 'user@example.com' },
    },
    error: null,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('OAuth Flows Integration Tests', () => {
  let app: FastifyInstance;

  /** Signs a JWT using the app's configured @fastify/jwt instance. */
  function signJwt(userId = 'user-test-123', subscriptionStatus = 'active'): string {
    return app.jwt.sign({
      sub: userId,
      email: 'user@example.com',
      user_metadata: { subscription_status: subscriptionStatus },
    });
  }

  /**
   * Returns Authorization + CSRF headers/cookies for a protected DELETE request.
   * Uses app.signCookie() so the cookie passes the unsign check in csrfProtect.
   */
  function authAndCsrfHeaders(userId = 'user-test-123', csrfToken = 'a'.repeat(64)) {
    const jwt = signJwt(userId);
    const signedCsrfCookie = app.signCookie(csrfToken);
    return {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'x-csrf-token': csrfToken,
      },
      cookies: {
        csrf_token: signedCsrfCookie,
      },
    };
  }

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Vault ops succeed by default
    mockStoreSecret.mockResolvedValue('new-vault-secret-id');
    mockDeleteSecret.mockResolvedValue(undefined);

    // DB: default no-data chain (safe for login-attempts and other middleware)
    mockDbFrom.mockReturnValue(
      buildFluentChain({ data: null, error: null }),
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1–3: Google OAuth Login (/auth/google)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Google OAuth Login — /auth/google', () => {
    // ── Test 1 ──────────────────────────────────────────────────────────────
    it('1. GET /auth/google → 302 redirect to Google OAuth URL', async () => {
      const googleOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&scope=openid+email+profile';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: googleOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(googleOAuthUrl);

      // Verify correct provider and redirect URL were used
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            redirectTo: 'https://example.com/auth/google/callback',
          }),
        }),
      );
    });

    // ── Test 2 ──────────────────────────────────────────────────────────────
    it('2. GET /auth/google/callback (valid code) → exchanges code, sets session cookie, redirects to dashboard', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildLoginSession('user-google-456'));

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=valid-auth-code&state=state-value',
      });

      expect(response.statusCode).toBe(302);

      // Redirects to dashboard URL
      expect(response.headers['location']).toBe('https://example.com/dashboard');

      // Sets an HttpOnly session_token cookie
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader);
      expect(cookieStr).toMatch(/session_token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);

      // Code was exchanged via Supabase
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
    });

    // ── Test 3 ──────────────────────────────────────────────────────────────
    it('3. GET /auth/google/callback (user denied) → redirects to /login?error=oauth_failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?error=access_denied&error_description=User+denied+access',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login?error=oauth_failed');

      // No code exchange should have been attempted
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4–8: Google Drive OAuth (/credentials/google)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Google Drive OAuth — /credentials/google', () => {
    // ── Test 4 ──────────────────────────────────────────────────────────────
    it('4. GET /credentials/google/connect → 302 redirect to Google OAuth URL with drive.file scope', async () => {
      const driveOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?scope=drive.file&access_type=offline';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: driveOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(driveOAuthUrl);

      // Must request drive.file scope with offline access for refresh token
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            scopes: 'https://www.googleapis.com/auth/drive.file',
            redirectTo: 'https://example.com/credentials/google/callback',
          }),
        }),
      );
    });

    // ── Test 5 ──────────────────────────────────────────────────────────────
    it('5. GET /credentials/google/callback (valid code) → stores refresh token in vault, redirects to settings', async () => {
      mockExchangeCodeForSession.mockResolvedValue(
        buildDriveSession({ userId: 'user-drive-789' }),
      );

      // DB chain: no existing credential (clean connect), upsert succeeds
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-drive-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/settings/credentials?drive=connected');

      // Refresh token stored in Vault with correct user + credential type
      expect(mockStoreSecret).toHaveBeenCalledWith(
        'user-drive-789',
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );

      // Credentials metadata row upserted with masked value and active status
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-drive-789',
          credential_type: 'google_drive_refresh_token',
          masked_value: '••••[connected]',
          vault_secret_id: 'new-vault-secret-id',
          status: 'active',
        }),
        expect.objectContaining({ onConflict: 'user_id,credential_type' }),
      );
    });

    // ── Test 6 ──────────────────────────────────────────────────────────────
    it('6. GET /credentials/google/callback (user denied) → redirects to /settings/credentials?error=drive_oauth_failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?error=access_denied&error_description=User+denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(
        '/settings/credentials?error=drive_oauth_failed',
      );

      // No vault or DB operations should be performed (previous status retained, Req 4.7)
      expect(mockStoreSecret).not.toHaveBeenCalled();
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    });

    // ── Test 7 ──────────────────────────────────────────────────────────────
    it('7. GET /credentials/google/callback (no refresh token in session) → redirects with error', async () => {
      mockExchangeCodeForSession.mockResolvedValue(
        buildDriveSession({ hasRefreshToken: false }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=code-no-refresh',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(
        '/settings/credentials?error=drive_oauth_failed',
      );

      // Code was exchanged but refresh token was absent — vault must not be called
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('code-no-refresh');
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    // ── Test 8 ──────────────────────────────────────────────────────────────
    it('8. DELETE /credentials/google (authenticated) → deletes vault secret, returns 200', async () => {
      const { headers, cookies } = authAndCsrfHeaders('user-del-drive');

      // First DB call: SELECT to find credential
      // Second DB call: DELETE row
      let callCount = 0;
      mockDbFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { id: 'cred-drive-1', vault_secret_id: 'vault-drive-secret' },
                error: null,
              }),
          };
        }
        // DELETE chain
        const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
        const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
        return {
          delete: vi.fn().mockReturnValue({ eq: deleteEq1 }),
        };
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: 'Google Drive disconnected' });

      // Vault secret was deleted
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-drive-secret');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9–12: Social Platform OAuth (/credentials/social/youtube)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Social Platform OAuth — /credentials/social/youtube', () => {
    // ── Test 9 ──────────────────────────────────────────────────────────────
    it('9. GET /credentials/social/youtube/connect → 302 to OAuth URL with correct scopes', async () => {
      const youtubeOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?scope=youtube.upload';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: youtubeOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(youtubeOAuthUrl);

      // Must use google provider and youtube.upload scope
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            scopes: 'https://www.googleapis.com/auth/youtube.upload',
          }),
        }),
      );
    });

    // ── Test 10 ─────────────────────────────────────────────────────────────
    it('10. GET /credentials/social/youtube/callback (valid code) → stores access + refresh tokens, redirects with social=connected', async () => {
      const userId = 'user-yt-999';
      mockExchangeCodeForSession.mockResolvedValue(
        buildSocialSession(userId, 'yt-access-token', 'yt-refresh-token'),
      );
      mockStoreSecret
        .mockResolvedValueOnce('vault-yt-access')
        .mockResolvedValueOnce('vault-yt-refresh');

      // DB: no existing credentials
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=valid-yt-code',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;

      // Redirects to settings with social=connected and platform=youtube
      expect(location).toContain('social=connected');
      expect(location).toContain('platform=youtube');
      expect(location).toContain('/settings/credentials');

      // Both access and refresh tokens stored in Vault
      expect(mockStoreSecret).toHaveBeenCalledWith(
        userId,
        'youtube_access_token',
        'yt-access-token',
      );
      expect(mockStoreSecret).toHaveBeenCalledWith(
        userId,
        'youtube_refresh_token',
        'yt-refresh-token',
      );

      // Code was exchanged with the authorization code from query
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-yt-code');
    });

    // ── Test 11 ─────────────────────────────────────────────────────────────
    it('11. GET /credentials/social/youtube/callback (error) → redirects with error query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?error=access_denied&error_description=User+denied',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;

      // Redirects to /settings/credentials with error (not /login)
      expect(location).toContain('/settings/credentials');
      expect(location).toContain('error=social_oauth_failed');
      expect(location).toContain('platform=youtube');
      expect(location).not.toContain('/login');

      // No vault or code exchange operations (Req 5.11: previous status retained)
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    // ── Test 12 ─────────────────────────────────────────────────────────────
    it('12. DELETE /credentials/social/youtube (authenticated) → pauses pipelines, deletes tokens, returns 200', async () => {
      const userId = 'user-yt-delete';
      const { headers, cookies } = authAndCsrfHeaders(userId);

      // DB mock: supports pipeline pause (.update().eq().contains().in().select())
      // and credential fetch/delete for both access and refresh token types
      const pipelinePauseMock = vi.fn().mockResolvedValue({
        data: [{ id: 'pipeline-1', name: 'My YouTube Pipeline' }],
        error: null,
      });

      // deleteCredentialAndSecret() for each token type does:
      //   1. SELECT … maybeSingle()   — fetch the credential row
      //   2. DELETE … eq().eq()       — delete the row
      // YouTube has 2 token types (access + refresh) → 4 credentials table calls total.
      const credentialCalls: Array<() => ReturnType<typeof buildFluentChain>> = [
        // Call 1: SELECT for youtube_access_token
        () => ({
          ...buildFluentChain({ data: { id: 'cred-access-1', vault_secret_id: 'vault-yt-access' }, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'cred-access-1', vault_secret_id: 'vault-yt-access' },
            error: null,
          }),
        }),
        // Call 2: DELETE for youtube_access_token
        () => {
          const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
          const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
          return { ...buildFluentChain({ data: null, error: null }), delete: vi.fn().mockReturnValue({ eq: deleteEq1 }) };
        },
        // Call 3: SELECT for youtube_refresh_token
        () => ({
          ...buildFluentChain({ data: { id: 'cred-refresh-1', vault_secret_id: 'vault-yt-refresh' }, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'cred-refresh-1', vault_secret_id: 'vault-yt-refresh' },
            error: null,
          }),
        }),
        // Call 4: DELETE for youtube_refresh_token
        () => {
          const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
          const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
          return { ...buildFluentChain({ data: null, error: null }), delete: vi.fn().mockReturnValue({ eq: deleteEq1 }) };
        },
      ];
      let credFetchCount = 0;

      mockDbFrom.mockImplementation((table: string) => {
        if (table === 'pipelines') {
          // Pipeline update chain: .update().eq().contains().in().select()
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                contains: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    select: pipelinePauseMock,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'credentials') {
          const factory = credentialCalls[credFetchCount];
          credFetchCount++;
          return factory ? factory() : buildFluentChain({ data: null, error: null });
        }

        return buildFluentChain({ data: null, error: null });
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: 'Platform disconnected' });

      // Pipelines were paused
      expect(pipelinePauseMock).toHaveBeenCalled();

      // Both token vault secrets were deleted
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-yt-access');
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-yt-refresh');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OAuth Error Handling — cross-flow verification
  // ══════════════════════════════════════════════════════════════════════════

  describe('OAuth error handling', () => {
    it('GET /auth/google/callback with invalid/expired code → 302 to /login?error=oauth_failed', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid authorization code' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=expired-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login?error=oauth_failed');
    });

    it('GET /credentials/google/callback with invalid code → 302 to settings with error', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Code verifier mismatch' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(
        '/settings/credentials?error=drive_oauth_failed',
      );
    });

    it('GET /credentials/social/youtube/callback with invalid code → 302 to settings with error', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid grant' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=invalid-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('Token storage in Vault after successful Google Drive OAuth', async () => {
      const userId = 'user-vault-verify';
      mockExchangeCodeForSession.mockResolvedValue(
        buildDriveSession({ userId }),
      );

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=vault-test-code',
      });

      // Vault stores the token — storeSecret called with correct params
      expect(mockStoreSecret).toHaveBeenCalledTimes(1);
      expect(mockStoreSecret).toHaveBeenCalledWith(
        userId,
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );

      // The vault secret ID returned by storeSecret is saved to the DB
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ vault_secret_id: 'new-vault-secret-id' }),
        expect.anything(),
      );
    });

    it('Token storage in Vault after successful YouTube OAuth', async () => {
      const userId = 'user-vault-yt';
      mockExchangeCodeForSession.mockResolvedValue(
        buildSocialSession(userId, 'yt-access', 'yt-refresh'),
      );

      mockStoreSecret
        .mockResolvedValueOnce('vault-yt-access-id')
        .mockResolvedValueOnce('vault-yt-refresh-id');

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=vault-yt-code',
      });

      // Both tokens written to Vault
      expect(mockStoreSecret).toHaveBeenCalledTimes(2);
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_access_token', 'yt-access');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_refresh_token', 'yt-refresh');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // All 4 social platforms — connect redirect
  // ══════════════════════════════════════════════════════════════════════════

  describe('Social platform OAuth connect — all 4 platforms', () => {
    const platforms = [
      { name: 'youtube', provider: 'google', scope: 'https://www.googleapis.com/auth/youtube.upload' },
      { name: 'tiktok', provider: 'tiktok', scope: 'user.info.basic,video.upload,video.publish' },
      { name: 'facebook', provider: 'facebook', scope: 'pages_manage_posts,pages_read_engagement' },
      { name: 'instagram', provider: 'facebook', scope: 'instagram_content_publish' },
    ] as const;

    for (const { name, provider, scope } of platforms) {
      it(`GET /credentials/social/${name}/connect → 302 to OAuth URL (provider: ${provider})`, async () => {
        const oauthUrl = `https://oauth.example.com/${name}`;
        mockSignInWithOAuth.mockResolvedValue({
          data: { url: oauthUrl, provider },
          error: null,
        });

        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${name}/connect`,
        });

        expect(response.statusCode).toBe(302);
        expect(response.headers['location']).toBe(oauthUrl);

        expect(mockSignInWithOAuth).toHaveBeenCalledWith(
          expect.objectContaining({
            provider,
            options: expect.objectContaining({ scopes: scope }),
          }),
        );
      });
    }
  });
});
