/**
 * Google Drive OAuth credential route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase connection.
 * Supabase admin client and vault helpers are mocked via vi.mock() so each test
 * controls exact responses.
 *
 * Covered scenarios:
 *
 * GET /credentials/google/connect
 *   - 302 redirect to Google OAuth URL on success
 *   - Calls signInWithOAuth with drive.file scope and GOOGLE_DRIVE_REDIRECT_URL
 *   - 502 when Supabase signInWithOAuth returns an error
 *   - 502 when signInWithOAuth returns no URL
 *   - 500 when GOOGLE_DRIVE_REDIRECT_URL env var is not set
 *
 * GET /credentials/google/callback
 *   - 302 to success redirect when valid code + refresh token present
 *   - Stores refresh token in vault with correct userId and credential type
 *   - Upserts credentials row with masked value ••••[connected] and status active
 *   - Cleans up old vault secret on reconnect
 *   - 302 to error redirect when `error` query param present (user denied)
 *   - 302 to error redirect when no `code` param
 *   - 302 to error redirect when exchangeCodeForSession fails
 *   - 302 to error redirect when session has no provider_refresh_token
 *   - 302 to error redirect when vault upsert fails (and cleans up new secret)
 *   - Does NOT touch DB or vault when user denies (previous status retained)
 *
 * DELETE /credentials/google
 *   - 401 when no JWT provided
 *   - 200 with { message: "Google Drive disconnected" } on success
 *   - Calls deleteSecret with correct vault_secret_id
 *   - 404 when no Google Drive credential exists for user
 *   - 500 when vault deleteSecret throws
 *   - 500 when DB fetch returns an error
 *
 * Validates: Requirements 4.1, 4.2, 4.4, 4.7, 4.8
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['SUPABASE_JWT_SECRET'] = JWT_SECRET;
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['GOOGLE_DRIVE_REDIRECT_URL'] = 'https://example.com/credentials/google/callback';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';
process.env['GOOGLE_OAUTH_REDIRECT_URL'] = 'https://example.com/auth/google/callback';

// ── Mock: vault helpers ──────────────────────────────────────────────────────
const mockStoreSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('../../lib/vault.js', () => ({
  storeSecret: (...args: unknown[]) => mockStoreSecret(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  maskApiKey: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
  maskValue: (key: string) => `\u2022\u2022\u2022\u2022${key.slice(-4)}`,
}));

// ── Mock: Supabase admin client ──────────────────────────────────────────────
const mockSignInWithOAuth = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockDbFrom = vi.fn();

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
    from: (table: string) => mockDbFrom(table),
  }),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Google Drive OAuth credential routes', () => {
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

    // Default: vault ops succeed
    mockStoreSecret.mockResolvedValue('new-vault-secret-id');
    mockDeleteSecret.mockResolvedValue(undefined);

    // Default: DB login_attempts chain (used by other auth middleware)
    const defaultChain = buildFluentChain({ data: null, error: null });
    mockDbFrom.mockReturnValue(defaultChain);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Signs a JWT using the app's @fastify/jwt instance (HS256, test secret). */
  function signJwt(
    userId = 'user-123',
    subscriptionStatus = 'active',
  ): string {
    return app.jwt.sign({
      sub: userId,
      email: 'user@example.com',
      user_metadata: { subscription_status: subscriptionStatus },
    });
  }

  /** Returns a fully fluent Supabase DB chain mock. */
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
      in: vi.fn(),
    };
    // Wire fluent returns
    chain['select']!.mockReturnValue(chain);
    chain['eq']!.mockReturnValue(chain);
    chain['delete']!.mockReturnValue(chain);
    chain['update']!.mockReturnValue(chain);
    chain['in']!.mockReturnValue(chain);
    return chain;
  }

  /** Builds a realistic Supabase exchangeCodeForSession response. */
  function buildOAuthSession(opts: {
    userId?: string;
    hasRefreshToken?: boolean;
  } = {}) {
    const userId = opts.userId ?? 'user-oauth-123';
    const hasRefreshToken = opts.hasRefreshToken ?? true;
    return {
      data: {
        session: {
          access_token: 'access-token-value',
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

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/google/connect
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/google/connect', () => {
    it('returns 302 redirect to Google OAuth URL', async () => {
      const googleOAuthUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?scope=drive.file&client_id=test';

      mockSignInWithOAuth.mockResolvedValue({
        data: { url: googleOAuthUrl, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(googleOAuthUrl);
    });

    it('calls signInWithOAuth with drive.file scope and GOOGLE_DRIVE_REDIRECT_URL', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2', provider: 'google' },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

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

    it('returns 502 when Supabase signInWithOAuth returns an error', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'Provider not enabled' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error_code).toBe('drive_oauth_initiation_failed');
    });

    it('returns 502 when signInWithOAuth returns no URL', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: null, provider: 'google' },
        error: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error_code).toBe('drive_oauth_initiation_failed');
    });

    it('returns 500 when GOOGLE_DRIVE_REDIRECT_URL env var is not set', async () => {
      const original = process.env['GOOGLE_DRIVE_REDIRECT_URL'];
      delete process.env['GOOGLE_DRIVE_REDIRECT_URL'];

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/credentials/google/connect',
        });
        expect(response.statusCode).toBe(500);
        expect(response.json().error_code).toBe('configuration_error');
      } finally {
        process.env['GOOGLE_DRIVE_REDIRECT_URL'] = original;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/google/callback
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/google/callback', () => {
    const SUCCESS_REDIRECT = '/settings/credentials?drive=connected';
    const ERROR_REDIRECT = '/settings/credentials?error=drive_oauth_failed';

    /** Shared helper: set up a DB chain that has no existing credential (clean connect). */
    function setupCleanConnectDb() {
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: upsertMock,
        delete: vi.fn(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      chain['select']!.mockReturnValue(chain);
      chain['eq']!.mockReturnValue(chain);
      chain['delete']!.mockReturnValue(chain);
      chain['update']!.mockReturnValue(chain);
      mockDbFrom.mockReturnValue(chain);
      return { upsertMock, chain };
    }

    it('redirects to success URL on valid code with refresh token', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildOAuthSession());
      setupCleanConnectDb();

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-auth-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(SUCCESS_REDIRECT);
    });

    it('calls exchangeCodeForSession with the code from query string', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildOAuthSession());
      setupCleanConnectDb();

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=my-drive-code',
      });

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('my-drive-code');
    });

    it('stores refresh token in vault with correct userId and credential type', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildOAuthSession({ userId: 'user-abc' }));
      setupCleanConnectDb();

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledWith(
        'user-abc',
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );
    });

    it('upserts credentials row with masked value ••••[connected] and status active', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildOAuthSession());
      const { upsertMock } = setupCleanConnectDb();

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-code',
      });

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          credential_type: 'google_drive_refresh_token',
          masked_value: '••••[connected]',
          vault_secret_id: 'new-vault-secret-id',
          status: 'active',
        }),
        expect.objectContaining({ onConflict: 'user_id,credential_type' }),
      );
    });

    it('deletes old vault secret when reconnecting', async () => {
      mockExchangeCodeForSession.mockResolvedValue(
        buildOAuthSession({ userId: 'user-reconnect' }),
      );

      // DB returns an existing credential with an old vault secret id
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { vault_secret_id: 'old-vault-id' }, error: null }),
        upsert: upsertMock,
        delete: vi.fn(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      chain['select']!.mockReturnValue(chain);
      chain['eq']!.mockReturnValue(chain);
      chain['delete']!.mockReturnValue(chain);
      chain['update']!.mockReturnValue(chain);
      mockDbFrom.mockReturnValue(chain);

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=reconnect-code',
      });

      expect(mockDeleteSecret).toHaveBeenCalledWith('old-vault-id');
    });

    it('redirects to error URL when error query param present (user denied)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?error=access_denied&error_description=User+denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('redirects to error URL when no code param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL when exchangeCodeForSession returns an error', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: null,
        error: { message: 'Invalid code verifier' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL when session has no provider_refresh_token', async () => {
      mockExchangeCodeForSession.mockResolvedValue(
        buildOAuthSession({ hasRefreshToken: false }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=no-refresh-token-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL and cleans up vault secret when DB upsert fails', async () => {
      mockExchangeCodeForSession.mockResolvedValue(buildOAuthSession());
      mockStoreSecret.mockResolvedValue('vault-to-cleanup');

      const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'DB write error' } });
      const chain: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: upsertMock,
        delete: vi.fn(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      chain['select']!.mockReturnValue(chain);
      chain['eq']!.mockReturnValue(chain);
      chain['delete']!.mockReturnValue(chain);
      chain['update']!.mockReturnValue(chain);
      mockDbFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
      // Should clean up the orphaned vault secret
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-to-cleanup');
    });

    it('does NOT store or change credential when user denies (previous status retained)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
      // No vault or DB operations should have been performed
      expect(mockStoreSecret).not.toHaveBeenCalled();
      expect(mockDbFrom).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DELETE /credentials/google
  // ════════════════════════════════════════════════════════════════════════════

  describe('DELETE /credentials/google', () => {
    /**
     * Returns headers + cookies for an authenticated + CSRF-protected DELETE request.
     * Uses @fastify/cookie's `app.signCookie()` to produce a valid signed cookie value.
     */
    function authHeaders(userId = 'user-del-123') {
      const jwt = signJwt(userId);
      // Use a fixed 64-char token (same pattern as the CSRF middleware tests)
      const csrfToken = 'a'.repeat(64);
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

    /** Set up DB mock: first call fetches credential, second call deletes row. */
    function setupDeleteDb(opts: {
      findData?: unknown;
      findError?: { message: string } | null;
      deleteError?: { message: string } | null;
    } = {}) {
      const { findData, findError = null, deleteError = null } = opts;
      let callCount = 0;

      mockDbFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: SELECT (find credential)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: findData ?? null, error: findError }),
          };
        }
        // Second call: DELETE (chain .delete().eq().eq())
        const deleteEq2 = vi.fn().mockResolvedValue({ error: deleteError });
        const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
        return {
          delete: vi.fn().mockReturnValue({ eq: deleteEq1 }),
        };
      });
    }

    it('returns 401 when no JWT provided', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 200 with disconnect message on success', async () => {
      const { headers, cookies } = authHeaders('user-del-123');

      setupDeleteDb({
        findData: { id: 'cred-id-1', vault_secret_id: 'vault-id-1' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: 'Google Drive disconnected' });
    });

    it('calls deleteSecret with correct vault_secret_id', async () => {
      const { headers, cookies } = authHeaders('user-del-456');

      setupDeleteDb({
        findData: { id: 'cred-id-2', vault_secret_id: 'vault-secret-abc' },
      });

      await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-secret-abc');
    });

    it('returns 404 when no Google Drive credential exists for user', async () => {
      const { headers, cookies } = authHeaders('user-no-drive');

      setupDeleteDb({ findData: null });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when vault deleteSecret throws', async () => {
      const { headers, cookies } = authHeaders('user-vault-err');

      mockDeleteSecret.mockRejectedValue(new Error('Vault unavailable'));

      setupDeleteDb({
        findData: { id: 'cred-id-3', vault_secret_id: 'vault-id-3' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when DB fetch returns an error', async () => {
      const { headers, cookies } = authHeaders('user-db-err');

      setupDeleteDb({ findError: { message: 'connection timeout' } });

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/google',
        headers,
        cookies,
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
