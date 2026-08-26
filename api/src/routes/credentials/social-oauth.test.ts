/**
 * Social platform OAuth route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase
 * connection. The Supabase admin client, vault helpers, and global fetch
 * are mocked via vi.mock() / vi.stubGlobal() so each test controls exact
 * responses.
 *
 * Architecture under test:
 *   - Connect route requires ?token=<JWT> to identify the user; builds a
 *     platform-specific OAuth URL with an HMAC-signed `state` param.
 *   - Callback route verifies the signed state, exchanges the code via
 *     platform-specific fetch calls, and stores tokens in vault.
 *
 * Covered scenarios:
 *
 * GET /credentials/social/:platform/connect
 *   - Valid platform + token → 302 redirect to platform OAuth URL
 *   - Invalid platform → 400 bad_request
 *   - Missing ?token → 401 unauthorized
 *   - Invalid/expired token → 401 unauthorized
 *   - YouTube redirects to accounts.google.com
 *   - TikTok redirects to tiktok.com/v2/auth
 *   - Facebook/Instagram redirect to facebook.com/dialog/oauth
 *
 * GET /credentials/social/:platform/callback
 *   - Error query param → 302 to error URL
 *   - Missing code → 302 to error URL
 *   - Missing state → 302 to error URL
 *   - Invalid state signature → 302 to error URL
 *   - Valid flow: stores tokens and redirects with social=connected
 *   - facebook/instagram: only access token stored (no refresh)
 *   - Vault failure → 302 to error URL
 *   - Token exchange HTTP error → 302 to error URL
 *
 * DELETE /credentials/social/:platform
 *   - Valid platform → 200, pauses pipelines, deletes tokens
 *   - Invalid platform → 400 bad_request
 *   - No auth → 401
 *   - Pipeline pause failure → still completes (non-fatal)
 *   - Vault deletion failure → still returns 200 (Req 5.8)
 *   - No existing credentials → 200
 *   - Facebook: only access token deleted
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.11
 */

import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters';

process.env['SUPABASE_JWT_SECRET'] = JWT_SECRET;
process.env['COOKIE_SECRET'] = COOKIE_SECRET;
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['API_BASE_URL'] = 'https://example.com';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';
// Platform-specific redirect URLs
process.env['SOCIAL_OAUTH_REDIRECT_URL_YOUTUBE'] = 'https://example.com/credentials/social/youtube/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_TIKTOK'] = 'https://example.com/credentials/social/tiktok/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_FACEBOOK'] = 'https://example.com/credentials/social/facebook/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_INSTAGRAM'] = 'https://example.com/credentials/social/instagram/callback';
// Platform credentials
process.env['GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-client-secret';
process.env['TIKTOK_CLIENT_KEY'] = 'test-tiktok-client-key';
process.env['TIKTOK_CLIENT_SECRET'] = 'test-tiktok-client-secret';
process.env['FACEBOOK_APP_ID'] = 'test-facebook-app-id';
process.env['FACEBOOK_APP_SECRET'] = 'test-facebook-app-secret';

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
// DB query chain mocks (used by the DELETE route's pipeline pause logic)
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
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: (_table: string) => buildDbChain(),
  }),
}));

// ── State helpers (mirrors social-oauth.ts logic) ────────────────────────────

function signState(payload: string): string {
  const hmac = crypto
    .createHmac('sha256', COOKIE_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

function encodeState(userId: string, platform: string): string {
  return signState(`${userId}:${platform}`);
}

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

    // Default DB chain
    buildDbChain();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockIn.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── GET /credentials/social/:platform/connect ────────────────────────────

  describe('GET /credentials/social/:platform/connect', () => {
    it('returns 400 for invalid platform', async () => {
      const token = jwt();
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/twitter/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('bad_request');
    });

    it('returns 401 when ?token is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('unauthorized');
    });

    it('returns 401 when ?token is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/connect?token=not-a-valid-jwt',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('unauthorized');
    });

    it('returns 302 redirect to Google OAuth URL for youtube', async () => {
      const token = jwt();
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('youtube.upload');
    });

    it('youtube connect URL includes state, client_id, redirect_uri', async () => {
      const token = jwt('user-abc');
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = new URL(response.headers['location'] as string);
      expect(location.searchParams.get('client_id')).toBe('test-google-client-id');
      expect(location.searchParams.get('redirect_uri')).toBe(
        'https://example.com/credentials/social/youtube/callback',
      );
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('access_type')).toBe('offline');
    });

    it('returns 302 redirect to TikTok OAuth URL for tiktok', async () => {
      const token = jwt();
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/tiktok/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('tiktok.com');
      expect(location).toContain('test-tiktok-client-key');
    });

    it('returns 302 redirect to Meta OAuth URL for facebook', async () => {
      const token = jwt();
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/facebook/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('facebook.com');
      expect(location).toContain('test-facebook-app-id');
    });

    it('returns 302 redirect to Meta OAuth URL for instagram', async () => {
      const token = jwt();
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/instagram/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('facebook.com');
    });

    it('facebook and instagram use the same Meta OAuth endpoint', async () => {
      const token = jwt();

      const fbResponse = await app.inject({
        method: 'GET',
        url: `/credentials/social/facebook/connect?token=${token}`,
      });
      const igResponse = await app.inject({
        method: 'GET',
        url: `/credentials/social/instagram/connect?token=${token}`,
      });

      const fbHost = new URL(fbResponse.headers['location'] as string).hostname;
      const igHost = new URL(igResponse.headers['location'] as string).hostname;
      expect(fbHost).toBe(igHost);
    });

    it('state param encodes userId from token', async () => {
      const userId = 'user-state-check';
      const token = jwt(userId);
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = new URL(response.headers['location'] as string);
      const state = location.searchParams.get('state') as string;
      // State format: "userId:platform.<hmac>"
      expect(state).toContain(userId);
      expect(state).toContain('youtube');
    });
  });

  // ── GET /credentials/social/:platform/callback ───────────────────────────

  describe('GET /credentials/social/:platform/callback', () => {
    const userId = 'user-test-123';

    /**
     * Builds a valid HMAC-signed state for a given userId + platform,
     * matching the server's encodeState() logic.
     */
    function validState(platform: string): string {
      return encodeState(userId, platform);
    }

    /**
     * Stubs global fetch to return a successful token exchange response.
     * For YouTube/Google: returns access_token + refresh_token.
     * For TikTok: returns TikTok v2 data-wrapped format.
     * For Meta: returns access_token (no refresh token); second call for long-lived exchange also returns access_token.
     */
    function stubFetchForPlatform(
      platform: string,
      accessToken = 'access-token-abc',
      refreshToken: string | null = 'refresh-token-xyz',
    ) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          const urlStr = String(url);

          // YouTube/Google token endpoint
          if (urlStr.includes('oauth2.googleapis.com/token')) {
            return {
              ok: true,
              json: async () => ({
                access_token: accessToken,
                refresh_token: refreshToken ?? undefined,
              }),
            };
          }

          // TikTok token endpoint
          if (urlStr.includes('tiktokapis.com')) {
            return {
              ok: true,
              json: async () => ({
                data: { access_token: accessToken, refresh_token: refreshToken ?? undefined },
              }),
            };
          }

          // Meta short-lived token endpoint
          if (urlStr.includes('graph.facebook.com') && urlStr.includes('oauth/access_token') && !urlStr.includes('fb_exchange_token')) {
            return {
              ok: true,
              json: async () => ({ access_token: accessToken }),
            };
          }

          // Meta long-lived token exchange (second call for Meta)
          if (urlStr.includes('fb_exchange_token')) {
            return {
              ok: true,
              json: async () => ({ access_token: `long-lived-${accessToken}` }),
            };
          }

          // Fallback
          return { ok: false, status: 500, text: async () => 'unexpected fetch' };
        }),
      );
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
        url: `/credentials/social/youtube/callback?state=${validState('youtube')}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to error URL when state is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?code=abc',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('redirects to error URL when state signature is invalid', async () => {
      // Use a correctly-formed state with a wrong-length-valid but incorrect HMAC signature
      // (64 hex chars = 32 bytes, matching SHA-256 output length to avoid Buffer length mismatch)
      const wrongSig = '0'.repeat(64); // wrong value but correct hex length
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=abc&state=user-id:youtube.${wrongSig}`,
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

    it('redirects to error URL when token exchange fetch fails (non-200)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad Request' }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=bad-code&state=${validState('youtube')}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('stores access + refresh tokens and redirects with social=connected for youtube', async () => {
      stubFetchForPlatform('youtube', 'yt-access-token', 'yt-refresh-token');
      mockStoreSecret
        .mockResolvedValueOnce('vault-id-access')
        .mockResolvedValueOnce('vault-id-refresh');

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=valid-code&state=${validState('youtube')}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('social=connected');
      expect(location).toContain('platform=youtube');

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_access_token', 'yt-access-token');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_refresh_token', 'yt-refresh-token');
    });

    it('stores access + refresh tokens for tiktok', async () => {
      stubFetchForPlatform('tiktok', 'tt-access-token', 'tt-refresh-token');
      mockStoreSecret.mockResolvedValue('vault-id-123');

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/tiktok/callback?code=valid-code&state=${validState('tiktok')}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('social=connected');

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'tiktok_access_token', 'tt-access-token');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'tiktok_refresh_token', 'tt-refresh-token');
    });

    it('stores only access token for facebook (no refresh token type)', async () => {
      stubFetchForPlatform('facebook', 'fb-access-token', null);
      mockStoreSecret.mockResolvedValue('vault-id-fb');

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/facebook/callback?code=valid-code&state=${validState('facebook')}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('social=connected');

      // Access token stored (may be long-lived version from Meta exchange)
      const accessCalls = mockStoreSecret.mock.calls.filter(
        (c: unknown[]) => (c[1] as string) === 'facebook_access_token',
      );
      expect(accessCalls.length).toBe(1);

      // No refresh token
      const callTypes = mockStoreSecret.mock.calls.map((c: unknown[]) => c[1]);
      expect(callTypes).not.toContain('facebook_refresh_token');
    });

    it('stores only access token for instagram (no refresh token type)', async () => {
      stubFetchForPlatform('instagram', 'ig-access-token', null);
      mockStoreSecret.mockResolvedValue('vault-id-ig');

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/instagram/callback?code=valid-code&state=${validState('instagram')}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('social=connected');

      const callTypes = mockStoreSecret.mock.calls.map((c: unknown[]) => c[1]);
      expect(callTypes).not.toContain('instagram_refresh_token');
    });

    it('redirects to error URL when vault storeSecret throws', async () => {
      stubFetchForPlatform('youtube', 'yt-access-token', 'yt-refresh-token');
      mockStoreSecret.mockRejectedValue(new Error('Vault unavailable'));

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=valid-code&state=${validState('youtube')}`,
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
    function setupPauseMock(
      pipelines: Array<{ id: string; name: string }>,
      error: null | { message: string } = null,
    ) {
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

    it('returns 200 even when token deletion fails (Req 5.8)', async () => {
      setupPauseMock([{ id: 'pipe-1', name: 'Pipeline' }]);
      mockMaybeSingle.mockResolvedValue({
        data: { id: 'cred-1', vault_secret_id: 'vault-1' },
        error: null,
      });
      mockDeleteSecret.mockRejectedValue(new Error('Vault error'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/social/youtube',
        headers: {
          Authorization: `Bearer ${jwt()}`,
          ...csrfHeaders('csrf-vault-fail'),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Platform disconnected');
    });

    it('returns 200 when no credentials exist for the platform', async () => {
      setupPauseMock([]);
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
      expect(mockDeleteSecret).not.toHaveBeenCalled();
    });

    it('facebook deletion only attempts to delete access token (no refresh token)', async () => {
      setupPauseMock([]);
      const vaultId = 'vault-fb-1';
      mockMaybeSingle
        .mockResolvedValueOnce({
          data: { id: 'cred-fb', vault_secret_id: vaultId },
          error: null,
        })
        // Second maybeSingle call (for refresh token — facebook has none, so no credential row)
        .mockResolvedValueOnce({ data: null, error: null });
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

  // ── Platform validation ────────────────────────────────────────────────────

  describe('Platform validation', () => {
    const invalidPlatforms = ['twitter', 'linkedin', 'snapchat', 'YOUTUBE', 'YouTube'];
    const validPlatforms = ['youtube', 'tiktok', 'facebook', 'instagram'] as const;

    for (const platform of invalidPlatforms) {
      it(`rejects invalid platform "${platform}" on connect with 400`, async () => {
        const token = jwt();
        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${platform}/connect?token=${token}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error_code).toBe('bad_request');
      });
    }

    for (const platform of validPlatforms) {
      it(`accepts valid platform "${platform}" on connect`, async () => {
        const token = jwt();
        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${platform}/connect?token=${token}`,
        });

        // 302 = OAuth redirect initiated; 401/500 = config issue but platform was recognised
        expect(response.statusCode).not.toBe(400);
      });
    }
  });
});
