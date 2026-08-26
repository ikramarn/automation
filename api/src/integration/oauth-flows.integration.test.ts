/**
 * OAuth Flows Integration Tests
 *
 * End-to-end integration tests covering the full OAuth redirect flow across
 * multiple components: Supabase auth, Vault storage, and DB metadata rows.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase
 * connection. Supabase admin client, vault helpers, and global fetch are
 * mocked so each test controls exact responses while exercising the full
 * request path through Fastify plugins, middleware, and route handlers.
 *
 * ── Architecture overview ─────────────────────────────────────────────────
 *
 *   /auth/google           — still uses Supabase signInWithOAuth + exchangeCodeForSession
 *   /credentials/google    — uses direct fetch to oauth2.googleapis.com/token + listUsers()
 *   /credentials/social/*  — uses direct fetch to platform token endpoints + HMAC state
 *
 * ── Test scenarios ────────────────────────────────────────────────────────
 *
 * Google OAuth Login (auth/google)
 *   1. GET /auth/google → 302 redirect to Google OAuth URL
 *   2. GET /auth/google/callback (valid code) → exchanges code, sets
 *      session_token cookie, redirects to dashboard
 *   3. GET /auth/google/callback (user denied) → redirects to
 *      /login?error=oauth_failed
 *
 * Google Drive OAuth (credentials/google)
 *   4. GET /credentials/google/connect → 302 to Google OAuth URL with drive.file scope
 *   5. GET /credentials/google/callback (valid code) → stores refresh token in vault
 *   6. GET /credentials/google/callback (user denied) → error redirect
 *   7. GET /credentials/google/callback (no refresh token) → error redirect
 *   8. DELETE /credentials/google (authenticated) → deletes vault secret, 200
 *
 * Social Platform OAuth (credentials/social/:platform)
 *   9.  GET /credentials/social/youtube/connect + ?token → 302 to OAuth URL
 *  10.  GET /credentials/social/youtube/callback (valid code+state) → stores tokens
 *  11.  GET /credentials/social/youtube/callback (error) → error redirect
 *  12.  DELETE /credentials/social/youtube (authenticated) → 200
 *
 * Validates: Requirements 1.2, 4.1, 4.2, 4.4, 4.7, 4.8, 5.1, 5.5, 5.8, 5.11
 */

import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters';
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = COOKIE_SECRET;
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['GOOGLE_OAUTH_REDIRECT_URL'] = 'https://example.com/auth/google/callback';
process.env['GOOGLE_DRIVE_REDIRECT_URL'] = 'https://example.com/credentials/google/callback';
process.env['GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-client-secret';
process.env['TIKTOK_CLIENT_KEY'] = 'test-tiktok-client-key';
process.env['TIKTOK_CLIENT_SECRET'] = 'test-tiktok-client-secret';
process.env['FACEBOOK_APP_ID'] = 'test-facebook-app-id';
process.env['FACEBOOK_APP_SECRET'] = 'test-facebook-app-secret';
process.env['SOCIAL_OAUTH_REDIRECT_URL_YOUTUBE'] = 'https://example.com/credentials/social/youtube/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_TIKTOK'] = 'https://example.com/credentials/social/tiktok/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_FACEBOOK'] = 'https://example.com/credentials/social/facebook/callback';
process.env['SOCIAL_OAUTH_REDIRECT_URL_INSTAGRAM'] = 'https://example.com/credentials/social/instagram/callback';
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
// /auth/google still uses signInWithOAuth + exchangeCodeForSession.
// /credentials/google uses listUsers() for user lookup.
// /credentials/social/* does NOT use supabase auth at all (direct fetch).
const mockSignInWithOAuth = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockListUsers = vi.fn();
const mockDbFrom = vi.fn();

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn().mockResolvedValue({ data: {}, error: null }),
        updateUserById: vi.fn(),
        listUsers: mockListUsers,
      },
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: (table: string) => mockDbFrom(table),
  }),
}));

// ── State helpers (mirrors social-oauth.ts logic) ────────────────────────────

function encodeState(userId: string, platform: string): string {
  const payload = `${userId}:${platform}`;
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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

/**
 * Stubs global fetch for Google Drive callback:
 * - First call (oauth2.googleapis.com/token) returns tokens
 * - Second call (googleapis.com/oauth2/v2/userinfo) returns email
 */
function stubDriveFetch(opts: {
  accessToken?: string;
  refreshToken?: string | null;
  email?: string;
} = {}) {
  const {
    accessToken = 'drive-access-token',
    refreshToken = 'drive-refresh-token-value',
    email = 'user@example.com',
  } = opts;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: accessToken,
            ...(refreshToken !== null ? { refresh_token: refreshToken } : {}),
          }),
          text: async () => '',
        };
      }
      if (u.includes('googleapis.com/oauth2/v2/userinfo')) {
        return { ok: true, json: async () => ({ email }) };
      }
      return { ok: false, status: 500, text: async () => 'unexpected' };
    }),
  );
}

/**
 * Stubs global fetch for Social YouTube callback:
 * - oauth2.googleapis.com/token → access + refresh tokens
 */
function stubYouTubeFetch(accessToken = 'yt-access-token', refreshToken = 'yt-refresh-token') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: accessToken, refresh_token: refreshToken }),
          text: async () => '',
        };
      }
      return { ok: false, status: 500, text: async () => 'unexpected' };
    }),
  );
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('OAuth Flows Integration Tests', () => {
  let app: FastifyInstance;

  function signJwt(userId = 'user-test-123', subscriptionStatus = 'active'): string {
    return app.jwt.sign({
      sub: userId,
      email: 'user@example.com',
      user_metadata: { subscription_status: subscriptionStatus },
    });
  }

  function authAndCsrfHeaders(userId = 'user-test-123', csrfToken = 'a'.repeat(64)) {
    const jwt = signJwt(userId);
    const signedCsrfCookie = app.signCookie(csrfToken);
    return {
      headers: { Authorization: `Bearer ${jwt}`, 'x-csrf-token': csrfToken },
      cookies: { csrf_token: signedCsrfCookie },
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

    mockStoreSecret.mockResolvedValue('new-vault-secret-id');
    mockDeleteSecret.mockResolvedValue(undefined);

    // listUsers default: returns the test user
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'user-drive-123', email: 'user@example.com' }] },
      error: null,
    });

    // DB default: safe no-data chain
    mockDbFrom.mockReturnValue(buildFluentChain({ data: null, error: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1–3: Google OAuth Login (/auth/google) — still uses Supabase signInWithOAuth
  // ══════════════════════════════════════════════════════════════════════════

  describe('Google OAuth Login — /auth/google', () => {
    it('1. GET /auth/google → 302 redirect to Google OAuth URL', async () => {
      const googleOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&scope=openid+email+profile';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: googleOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({ method: 'GET', url: '/auth/google' });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(googleOAuthUrl);
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          options: expect.objectContaining({
            redirectTo: 'https://example.com/auth/google/callback',
          }),
        }),
      );
    });

    it('2. GET /auth/google/callback (valid code) → exchanges code, sets session cookie, redirects to dashboard', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'valid-access-token',
            expires_in: 86400,
            user: { id: 'user-google-456', email: 'user@example.com' },
          },
          user: { id: 'user-google-456', email: 'user@example.com' },
        },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=valid-auth-code&state=state-value',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('https://example.com/dashboard');

      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader);
      expect(cookieStr).toMatch(/session_token=/);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
    });

    it('3. GET /auth/google/callback (user denied) → redirects to /login?error=oauth_failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?error=access_denied&error_description=User+denied+access',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login?error=oauth_failed');
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4–8: Google Drive OAuth (/credentials/google) — uses direct fetch + listUsers
  // ══════════════════════════════════════════════════════════════════════════

  describe('Google Drive OAuth — /credentials/google', () => {
    it('4. GET /credentials/google/connect → 302 to Google OAuth URL with drive.file scope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('drive.file');
      expect(location).toContain('test-google-client-id');
      expect(location).toContain('offline');
      // Does NOT use Supabase signInWithOAuth anymore
      expect(mockSignInWithOAuth).not.toHaveBeenCalled();
    });

    it('5. GET /credentials/google/callback (valid code) → stores refresh token in vault, redirects to settings', async () => {
      const userId = 'user-drive-789';
      stubDriveFetch({ email: 'user@example.com', refreshToken: 'drive-refresh-token-value' });

      mockListUsers.mockResolvedValue({
        data: { users: [{ id: userId, email: 'user@example.com' }] },
        error: null,
      });

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

      expect(mockStoreSecret).toHaveBeenCalledWith(
        userId,
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          credential_type: 'google_drive_refresh_token',
          masked_value: '••••[connected]',
          vault_secret_id: 'new-vault-secret-id',
          status: 'active',
        }),
        expect.objectContaining({ onConflict: 'user_id,credential_type' }),
      );
    });

    it('6. GET /credentials/google/callback (user denied) → redirects to /settings/credentials?error=drive_oauth_failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?error=access_denied&error_description=User+denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/settings/credentials?error=drive_oauth_failed');
      expect(mockStoreSecret).not.toHaveBeenCalled();
      expect(mockDbFrom).not.toHaveBeenCalled();
    });

    it('7. GET /credentials/google/callback (no refresh token in response) → redirects with error', async () => {
      stubDriveFetch({ refreshToken: null });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=code-no-refresh',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/settings/credentials?error=drive_oauth_failed');
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('8. DELETE /credentials/google (authenticated) → deletes vault secret, returns 200', async () => {
      const { headers, cookies } = authAndCsrfHeaders('user-del-drive');

      let callCount = 0;
      mockDbFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'cred-drive-1', vault_secret_id: 'vault-drive-secret' },
              error: null,
            }),
          };
        }
        const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
        const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
        return { delete: vi.fn().mockReturnValue({ eq: deleteEq1 }) };
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: 'Google Drive disconnected' });
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-drive-secret');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9–12: Social Platform OAuth (/credentials/social/youtube)
  // Uses direct fetch + HMAC-signed state (no Supabase auth calls)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Social Platform OAuth — /credentials/social/youtube', () => {
    it('9. GET /credentials/social/youtube/connect (with token) → 302 to Google OAuth URL with youtube.upload scope', async () => {
      const token = signJwt('user-yt-connect');
      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/connect?token=${token}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('accounts.google.com');
      expect(location).toContain('youtube.upload');
      // Does NOT use Supabase signInWithOAuth
      expect(mockSignInWithOAuth).not.toHaveBeenCalled();
    });

    it('10. GET /credentials/social/youtube/callback (valid code+state) → stores access + refresh tokens, redirects with social=connected', async () => {
      const userId = 'user-yt-999';
      stubYouTubeFetch('yt-access-token', 'yt-refresh-token');

      mockStoreSecret
        .mockResolvedValueOnce('vault-yt-access')
        .mockResolvedValueOnce('vault-yt-refresh');

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      const state = encodeState(userId, 'youtube');

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=valid-yt-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('social=connected');
      expect(location).toContain('platform=youtube');
      expect(location).toContain('/settings/credentials');

      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_access_token', 'yt-access-token');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_refresh_token', 'yt-refresh-token');
    });

    it('11. GET /credentials/social/youtube/callback (error) → redirects with error query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/social/youtube/callback?error=access_denied&error_description=User+denied',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('/settings/credentials');
      expect(location).toContain('error=social_oauth_failed');
      expect(location).toContain('platform=youtube');
      expect(location).not.toContain('/login');
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('12. DELETE /credentials/social/youtube (authenticated) → pauses pipelines, deletes tokens, returns 200', async () => {
      const userId = 'user-yt-delete';
      const { headers, cookies } = authAndCsrfHeaders(userId);

      const pipelinePauseMock = vi.fn().mockResolvedValue({
        data: [{ id: 'pipeline-1', name: 'My YouTube Pipeline' }],
        error: null,
      });

      // deleteCredentialAndSecret() for each token type:
      //   1. SELECT … maybeSingle() — fetch credential
      //   2. DELETE … eq().eq()     — delete row
      // YouTube has 2 token types → 4 'credentials' table calls
      const makeSelectChain = (vaultId: string, credId: string) => {
        const maybeSingleFn = vi.fn().mockResolvedValue({
          data: { id: credId, vault_secret_id: vaultId },
          error: null,
        });
        const eqFn = vi.fn();
        const selectFn = vi.fn();
        const chain = { select: selectFn, eq: eqFn, maybeSingle: maybeSingleFn };
        selectFn.mockReturnValue(chain);
        eqFn.mockReturnValue(chain);
        return chain;
      };

      const makeDeleteChain = () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        return { delete: vi.fn().mockReturnValue({ eq: eq1 }) };
      };

      const credentialCalls = [
        () => makeSelectChain('vault-yt-access', 'cred-access-1'),
        () => makeDeleteChain(),
        () => makeSelectChain('vault-yt-refresh', 'cred-refresh-1'),
        () => makeDeleteChain(),
      ];
      let credIdx = 0;

      mockDbFrom.mockImplementation((table: string) => {
        if (table === 'pipelines') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                contains: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({ select: pipelinePauseMock }),
                }),
              }),
            }),
          };
        }
        if (table === 'credentials') {
          const factory = credentialCalls[credIdx++];
          return factory ? factory() : buildFluentChain({ data: null, error: null });
        }
        // All other tables (e.g. login_attempts used by auth middleware) get a safe default
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
      expect(pipelinePauseMock).toHaveBeenCalled();
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-yt-access');
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-yt-refresh');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OAuth error handling — cross-flow verification
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
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/settings/credentials?error=drive_oauth_failed');
    });

    it('GET /credentials/social/youtube/callback with invalid code (bad fetch) → 302 to settings with error', async () => {
      const state = encodeState('user-test', 'youtube');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=invalid-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('error=social_oauth_failed');
    });

    it('Token storage in Vault after successful Google Drive OAuth', async () => {
      const userId = 'user-vault-verify';
      stubDriveFetch({ email: 'vault@example.com', refreshToken: 'drive-refresh-token-value' });
      mockListUsers.mockResolvedValue({
        data: { users: [{ id: userId, email: 'vault@example.com' }] },
        error: null,
      });

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=vault-test-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledTimes(1);
      expect(mockStoreSecret).toHaveBeenCalledWith(
        userId,
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ vault_secret_id: 'new-vault-secret-id' }),
        expect.anything(),
      );
    });

    it('Token storage in Vault after successful YouTube OAuth', async () => {
      const userId = 'user-vault-yt';
      stubYouTubeFetch('yt-access', 'yt-refresh');
      mockStoreSecret
        .mockResolvedValueOnce('vault-yt-access-id')
        .mockResolvedValueOnce('vault-yt-refresh-id');

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      const state = encodeState(userId, 'youtube');

      await app.inject({
        method: 'GET',
        url: `/credentials/social/youtube/callback?code=vault-yt-code&state=${state}`,
      });

      expect(mockStoreSecret).toHaveBeenCalledTimes(2);
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_access_token', 'yt-access');
      expect(mockStoreSecret).toHaveBeenCalledWith(userId, 'youtube_refresh_token', 'yt-refresh');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // All 4 social platforms — connect redirect (with ?token=)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Social platform OAuth connect — all 4 platforms', () => {
    const platforms = [
      { name: 'youtube', urlContains: 'accounts.google.com' },
      { name: 'tiktok', urlContains: 'tiktok.com' },
      { name: 'facebook', urlContains: 'facebook.com' },
      { name: 'instagram', urlContains: 'facebook.com' },
    ] as const;

    for (const { name, urlContains } of platforms) {
      it(`GET /credentials/social/${name}/connect → 302 to OAuth URL (provider: ${urlContains.split('.')[0]})`, async () => {
        const token = signJwt('user-platform-test');
        const response = await app.inject({
          method: 'GET',
          url: `/credentials/social/${name}/connect?token=${token}`,
        });

        expect(response.statusCode).toBe(302);
        const location = response.headers['location'] as string;
        expect(location).toContain(urlContains);
        // No Supabase OAuth calls — all direct
        expect(mockSignInWithOAuth).not.toHaveBeenCalled();
      });
    }
  });
});
