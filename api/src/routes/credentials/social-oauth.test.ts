/**
 * Social platform OAuth route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase
 * connection. The Supabase admin client and vault helpers are mocked via
 * vi.mock() so each test controls exact responses.
 *
 * Covered scenarios:
 *
 * GET /credentials/social/:platform/connect
 *   - Valid platform → 302 redirect to OAuth URL
 *   - Invalid platform → 400 bad_request
 *   - Supabase error → 502 oauth_initiation_failed
 *   - Each supported platform passes correct provider and scopes
 *
 * GET /credentials/social/:platform/callback
 *   - Error query param → redirect to /settings/credentials?error=social_oauth_failed
 *   - Missing code → redirect to error URL
 *   - Invalid platform → redirect to error URL
 *   - Valid code → stores tokens in vault and redirects with social=connected
 *   - Platform without refresh token (facebook/instagram) only stores access token
 *   - Vault storage failure → redirect to error URL
 *   - Code exchange failure → redirect to error URL
 *
 * DELETE /credentials/social/:platform
 *   - Valid platform → pauses pipelines, deletes tokens, returns 200
 *   - Invalid platform → 400 bad_request
 *   - Pipeline pause failure → still completes disconnection
 *   - Token deletion failure → still returns 200 (Req 5.8)
 *   - Platform with no existing credentials → returns 200
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.11
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
process.env['SOCIAL_OAUTH_REDIRECT_URL'] = 'https://example.com/credentials/social/callback';
process.env['API_BASE_URL'] = 'https://example.com';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';

// ── Mock vault helpers ───────────────────────────────────────────────────────
const mockStoreSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('../../lib/vault.js', () => ({
  storeSecret: (...args: unknown[]) => mockStoreSecret(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  maskValue: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
  maskApiKey: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
}));

// ── Mock Supabase admin client ───────────────────────────────────────────────
const mockSignInWithOAuth = vi.fn();
const mockExchangeCodeForSession = vi.fn();

// DB query chain mocks
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockIn = vi.fn();
const mockContains = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();

/** Build a chainable Supabase query stub. */
function buildDbChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    gte: mockGte,
    order: mockOrder,
    insert: mockInsert,
    update: mockUpdate,
    in: mockIn,
    contains: mockContains,
    delete: mockDelete,
    upsert: mockUpsert,
    maybeSingle: mockMaybeSingle,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockGte.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  mockContains.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  mockDelete.mockReturnValue(chain);
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

describe('Social platform OAuth routes', () => {
  let app: FastifyInstance;

  /** Signs a JWT using the app's configured secret (mirrors authenticate middleware). */
  function jwt(userId = 'user-test-123', email = 'test@example.com'): string {
    return app.jwt.sign(
      {
        sub: userId,
        email,
        user_metadata: { subscription_status: 'active' },
      },
      { expiresIn: '1h' },
    );
  }

  /**
   * Builds CSRF header + signed cookie for state-changing requests (DELETE).
   * The csrfProtect middleware unsigns the cookie using app.unsignCookie(),
   * so we must sign it with app.signCookie() here.
   */
  function csrfHeaders(token: string): { 'x-csrf-token': string; cookie: string } {
    const signed = app.signCookie(token);
    return {
      'x-csrf-token': token,
      cookie: `csrf_token=${signed}`,
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

    // Default: sign-in stub succeeds
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=youtube.upload', provider: 'google' },
      error: null,
    });

    // Default: DB operations succeed with no data
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockIn.mockResolvedValue({ data: [], error: null });
  });

  // ── GET /credentials/social/:platform/connect ────────────────────────────

  describe('GET /credentials/social/:platform/connect', () => {
    it('returns 302 redirect to OAuth URL for youtube', async () => {
      const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?scope=youtube.upload';
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: oauthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(oauthUrl);
    });

    it('calls signInWithOAuth with google provider and youtube.upload scope', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://oauth.url', provider: 'google' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            scopes: 'https://www.googleapis.com/auth/youtube.upload',
          }),
        }),
      );
    });

    it('calls signInWithOAuth with facebook provider and correct scopes for facebook', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://facebook.com/oauth', provider: 'facebook' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/social/facebook/connect',
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'facebook',
          options: expect.objectContaining({
            scopes: 'pages_manage_posts,pages_read_engagement',
          }),
        }),
      );
    });

    it('calls signInWithOAuth with facebook provider and instagram scope for instagram', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://facebook.com/oauth', provider: 'facebook' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/social/instagram/connect',
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'facebook',
          options: expect.objectContaining({
            scopes: 'instagram_content_publish',
          }),
        }),
      );
    });

    it('calls signInWithOAuth with tiktok provider for tiktok', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://tiktok.com/oauth', provider: 'tiktok' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/social/tiktok/connect',
      });

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'tiktok' }),
      );
    });

    it('returns 400 for invalid platform', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/twitter/connect',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('bad_request');
    });

    it('does not require authentication (public route)', async () => {
      // connect route is public — no token needed
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      // 302 = redirect initiated; 502 = Supabase error — either is fine, but NOT 401
      expect(response.statusCode).not.toBe(401);
    });

    it('returns 502 when Supabase signInWithOAuth fails', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'Provider not enabled' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error_code).toBe('oauth_initiation_failed');
    });

    it('returns 502 when Supabase returns null URL', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: null, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(response.statusCode).toBe(502);
    });
  });

  // ── GET /credentials/social/:platform/callback ───────────────────────────

  describe('GET /credentials/social/:platform/callback', () => {
    const userId = 'user-test-123';

    function mockSuccessfulExchange(
      providerToken = 'access-token-abc',
      refreshToken: string | null = 'refresh-token-xyz',
    ) {
      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'supabase-jwt',
            provider_token: providerToken,
            provider_refresh_token: refreshToken,
            user: { id: userId, email: 'test@example.com' },
          },
          user: { id: userId, email: 'test@example.com' },
        },
        error: null,
      });
    }

    it('redirects to error URL when error query param is present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('error=social_oauth_failed');
      expect(location).toContain('platform=youtube');
    });

    it('redirects to error URL when code is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to error URL for invalid platform', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/snapchat/callback?code=abc',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to error URL when code exchange fails', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid code' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('stores access + refresh tokens and redirects with social=connected for youtube', async () => {
      mockSuccessfulExchange('yt-access-token', 'yt-refresh-token');
      mockStoreSecret
        .mockResolvedValueOnce('vault-id-access')
        .mockResolvedValueOnce('vault-id-refresh');

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=valid-code',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('social=connected');
      expect(location).toContain('platform=youtube');

      // Both access and refresh tokens stored
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_access_token', 'yt-access-token');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_refresh_token', 'yt-refresh-token');
    });

    it('stores access + refresh tokens for tiktok', async () => {
      mockSuccessfulExchange('tt-access-token', 'tt-refresh-token');
      mockStoreSecret.mockResolvedValue('vault-id-123');

      await app.inject({
        method: 'GET',
        url: '/credentials/social/tiktok/callback?code=valid-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'tiktok_access_token', 'tt-access-token');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'tiktok_refresh_token', 'tt-refresh-token');
    });

    it('stores only access token for facebook (no refresh token type)', async () => {
      mockSuccessfulExchange('fb-access-token', null);
      mockStoreSecret.mockResolvedValue('vault-id-fb');

      await app.inject({
        method: 'GET',
        url: '/credentials/social/facebook/callback?code=valid-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'facebook_access_token', 'fb-access-token');
      // No refresh token call for facebook
      const callTypes = mockStoreSecret.mock.calls.map((c: unknown[]) => c[1]);
      expect(callTypes).not.toContain('facebook_refresh_token');
    });

    it('stores only access token for instagram (no refresh token type)', async () => {
      mockSuccessfulExchange('ig-access-token', null);
      mockStoreSecret.mockResolvedValue('vault-id-ig');

      await app.inject({
        method: 'GET',
        url: '/credentials/social/instagram/callback?code=valid-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'instagram_access_token', 'ig-access-token');
      const callTypes = mockStoreSecret.mock.calls.map((c: unknown[]) => c[1]);
      expect(callTypes).not.toContain('instagram_refresh_token');
    });

    it('redirects to error URL when vault storeSecret fails', async () => {
      mockSuccessfulExchange();
      mockStoreSecret.mockRejectedValue(new Error('Vault unavailable'));

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=valid-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to error URL when code exchange returns no session', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { session: null, user: null },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to /settings/credentials (not /login) on error', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?error=access_denied',
      });

      const location = response.headers['location'] as string;
      expect(location).toContain('/settings/credentials');
      expect(location).not.toContain('/login');
    });
  });

  // ── DELETE /credentials/social/:platform ─────────────────────────────────

  describe('DELETE /credentials/social/:platform', () => {
    /** Sets up update chain to simulate pipeline pause result. */
    function setupPauseMock(pipelines: Array<{ id: string; name: string }>, error: null | { message: string } = null) {
      mockUpdate.mockReturnValue({
        eq: () => ({
          contains: () => ({
            in: () => ({
              select: () => Promise.resolve({ data: pipelines, error }),
            }),
          }),
        }),
      });
    }

    it('returns 400 for invalid platform', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/pinterest',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('test-csrf-token'),
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('bad_request');
    });

    it('returns 401 when no auth token is provided', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 and disconnects youtube successfully', async () => {
      setupPauseMock([{ id: 'pipe-1', name: 'Test Pipeline' }]);
      mockMaybeSingle.mockResolvedValue({
        data: { id: 'cred-1', vault_secret_id: 'vault-1' },
        error: null,
      });
      mockDeleteSecret.mockResolvedValue(undefined);
      mockDelete.mockReturnValue({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-youtube-disconnect'),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Platform disconnected');
    });

    it('returns 200 even when pipeline pause fails (non-fatal)', async () => {
      setupPauseMock([], { message: 'DB error' });
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockDeleteSecret.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-pause-fail'),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Platform disconnected');
    });

    it('returns 200 even when token deletion fails after pipelines are paused (Req 5.8)', async () => {
      setupPauseMock([{ id: 'pipe-1', name: 'Pipeline' }]);
      mockMaybeSingle.mockResolvedValue({
        data: { id: 'cred-1', vault_secret_id: 'vault-1' },
        error: null,
      });
      // Vault deletion fails — but disconnection must still complete
      mockDeleteSecret.mockRejectedValue(new Error('Vault error'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-vault-fail'),
        },
      });

      // Disconnection still completes per Req 5.8
      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Platform disconnected');
    });

    it('returns 200 when no credentials exist for the platform', async () => {
      setupPauseMock([]);
      // No credentials found
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/facebook',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-no-creds'),
        },
      });

      expect(response.statusCode).toBe(200);
      // No vault deletions attempted (nothing to delete)
      expect(mockDeleteSecret).not.toHaveBeenCalled();
    });

    it('facebook deletion only attempts to delete access token (no refresh token)', async () => {
      setupPauseMock([]);
      const vaultId = 'vault-fb-1';
      mockMaybeSingle.mockResolvedValue({
        data: { id: 'cred-fb', vault_secret_id: vaultId },
        error: null,
      });
      mockDeleteSecret.mockResolvedValue(undefined);
      mockDelete.mockReturnValue({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      });

      await app.inject({
        method: 'DELETE',
        url: '/credentials/social/facebook',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-fb-delete'),
        },
      });

      // Only one vault delete — for the access token
      expect(mockDeleteSecret).toHaveBeenCalledTimes(1);
      expect(mockDeleteSecret).toHaveBeenCalledWith(vaultId);
    });
  });

  // ── Platform validation across all methods ────────────────────────────────

  describe('Platform validation', () => {
    const invalidPlatforms = ['twitter', 'linkedin', 'snapchat', 'YOUTUBE', 'YouTube'];
    const validPlatforms = ['youtube', 'tiktok', 'facebook', 'instagram'] as const;

    for (const platform of invalidPlatforms) {
      it(`rejects invalid platform "${platform}" on connect with 400`, async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${platform}/connect`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error_code).toBe('bad_request');
      });
    }

    for (const platform of validPlatforms) {
      it(`accepts valid platform "${platform}" on connect`, async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${platform}/connect`,
        });

        // 302 = OAuth redirect initiated; 502 = Supabase error — both indicate platform was recognized
        expect([302, 502]).toContain(response.statusCode);
      });
    }
  });
});
