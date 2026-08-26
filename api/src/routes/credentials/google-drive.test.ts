/**
 * Google Drive OAuth credential route tests.
 *
 * Tests use Fastify's `app.inject()` — no real HTTP server or Supabase connection.
 * Vault helpers, global fetch, and the Supabase admin client are mocked so each
 * test controls exact responses.
 *
 * Architecture under test (google-drive.ts):
 *   - GET /credentials/google/connect  — builds direct Google OAuth URL (not
 *     Supabase signInWithOAuth), requires GOOGLE_CLIENT_ID + GOOGLE_DRIVE_REDIRECT_URL
 *   - GET /credentials/google/callback — exchanges code via fetch to
 *     oauth2.googleapis.com/token, looks up user via listUsers() + email match,
 *     stores refresh_token in vault, upserts credentials row
 *   - DELETE /credentials/google       — authenticated; deletes vault secret + DB row
 *
 * Covered scenarios:
 *
 * GET /credentials/google/connect
 *   - 302 redirect to accounts.google.com with drive.file scope
 *   - URL contains client_id, redirect_uri, response_type=code, access_type=offline
 *   - 500 when GOOGLE_DRIVE_REDIRECT_URL env var is not set
 *   - 500 when GOOGLE_CLIENT_ID env var is not set
 *
 * GET /credentials/google/callback
 *   - 302 to success URL on valid code + refresh token
 *   - Stores refresh token in vault with correct userId and credential type
 *   - Upserts credentials row with masked_value '••••[connected]' and status active
 *   - Cleans up old vault secret on reconnect
 *   - 302 to error URL when `error` query param present (user denied)
 *   - 302 to error URL when no `code` param
 *   - 302 to error URL when Google token exchange returns non-200
 *   - 302 to error URL when token response has no refresh_token
 *   - 302 to error URL when vault upsert fails (and cleans up new secret)
 *   - Does NOT touch vault/DB when user denies
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

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
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
process.env['GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-client-secret';
process.env['DASHBOARD_URL'] = 'https://example.com/dashboard';

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
const mockListUsers = vi.fn();
const mockDbFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
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

    // Default: listUsers returns a matching user for user-oauth-123
    mockListUsers.mockResolvedValue({
      data: {
        users: [{ id: 'user-oauth-123', email: 'user@example.com' }],
      },
      error: null,
    });

    // Default: DB chain returns safe defaults
    const defaultChain = buildFluentChain({ data: null, error: null });
    mockDbFrom.mockReturnValue(defaultChain);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Signs a JWT using the app's @fastify/jwt instance (HS256, test secret). */
  function signJwt(userId = 'user-123', subscriptionStatus = 'active'): string {
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
    chain['select']!.mockReturnValue(chain);
    chain['eq']!.mockReturnValue(chain);
    chain['delete']!.mockReturnValue(chain);
    chain['update']!.mockReturnValue(chain);
    chain['in']!.mockReturnValue(chain);
    return chain;
  }

  /**
   * Stubs global fetch to return a successful Google token exchange response.
   * First call: oauth2.googleapis.com/token → access_token + optional refresh_token
   * Second call: googleapis.com/oauth2/v2/userinfo → email
   */
  function stubFetchSuccess(opts: {
    accessToken?: string;
    refreshToken?: string | null;
    email?: string;
  } = {}) {
    const {
      accessToken = 'access-token-value',
      refreshToken = 'drive-refresh-token-value',
      email = 'user@example.com',
    } = opts;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);

        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: accessToken,
              ...(refreshToken !== null ? { refresh_token: refreshToken } : {}),
            }),
            text: async () => '',
          };
        }

        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return {
            ok: true,
            json: async () => ({ email }),
          };
        }

        return { ok: false, status: 500, text: async () => 'unexpected fetch' };
      }),
    );
  }

  /** Sets up DB mock for a clean connect (no existing credential). */
  function setupCleanConnectDb() {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const chain = buildFluentChain({ data: null, error: null });
    chain['upsert'] = upsertMock;
    mockDbFrom.mockReturnValue(chain);
    return { upsertMock, chain };
  }

  /** Builds auth headers for authenticated + CSRF-protected DELETE requests. */
  function authHeaders(userId = 'user-del-123') {
    const token = signJwt(userId);
    const csrfToken = 'a'.repeat(64);
    const signedCsrfCookie = app.signCookie(csrfToken);
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-csrf-token': csrfToken,
      },
      cookies: { csrf_token: signedCsrfCookie },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/google/connect
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/google/connect', () => {
    it('returns 302 redirect to Google OAuth URL', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('accounts.google.com');
    });

    it('redirect URL includes drive.file scope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers['location'] as string;
      expect(location).toContain('drive.file');
    });

    it('redirect URL includes correct OAuth params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/connect',
      });

      expect(response.statusCode).toBe(302);
      const location = new URL(response.headers['location'] as string);
      expect(location.searchParams.get('client_id')).toBe('test-google-client-id');
      expect(location.searchParams.get('redirect_uri')).toBe(
        'https://example.com/credentials/google/callback',
      );
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('access_type')).toBe('offline');
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

    it('returns 500 when GOOGLE_CLIENT_ID env var is not set', async () => {
      const original = process.env['GOOGLE_CLIENT_ID'];
      delete process.env['GOOGLE_CLIENT_ID'];

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/credentials/google/connect',
        });
        expect(response.statusCode).toBe(500);
        expect(response.json().error_code).toBe('configuration_error');
      } finally {
        process.env['GOOGLE_CLIENT_ID'] = original;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /credentials/google/callback
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /credentials/google/callback', () => {
    const SUCCESS_REDIRECT = '/settings/credentials?drive=connected';
    const ERROR_REDIRECT = '/settings/credentials?error=drive_oauth_failed';

    it('redirects to success URL on valid code with refresh token', async () => {
      stubFetchSuccess();
      setupCleanConnectDb();

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-auth-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(SUCCESS_REDIRECT);
    });

    it('stores refresh token in vault with correct userId and credential type', async () => {
      stubFetchSuccess({ email: 'user@example.com' });
      setupCleanConnectDb();

      // listUsers returns the user with matching email
      mockListUsers.mockResolvedValue({
        data: { users: [{ id: 'user-oauth-123', email: 'user@example.com' }] },
        error: null,
      });

      await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-code',
      });

      expect(mockStoreSecret).toHaveBeenCalledWith(
        'user-oauth-123',
        'google_drive_refresh_token',
        'drive-refresh-token-value',
      );
    });

    it('upserts credentials row with masked_value ••••[connected] and status active', async () => {
      stubFetchSuccess();
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
      stubFetchSuccess({ email: 'user@example.com' });

      // DB returns an existing credential with an old vault secret id
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const chain = buildFluentChain({ data: { vault_secret_id: 'old-vault-id' }, error: null });
      chain['upsert'] = upsertMock;
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
      // fetch should NOT be called — user denied before code was issued
      // (fetch stub is not set, so if it were called it would throw)
    });

    it('redirects to error URL when no code param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL when Google token exchange returns non-200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => 'invalid_grant',
        }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=bad-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL when token response has no refresh_token', async () => {
      stubFetchSuccess({ refreshToken: null });

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=no-refresh-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
    });

    it('redirects to error URL and cleans up vault secret when DB upsert fails', async () => {
      stubFetchSuccess();
      mockStoreSecret.mockResolvedValue('vault-to-cleanup');

      const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'DB write error' } });
      const chain = buildFluentChain({ data: null, error: null });
      chain['upsert'] = upsertMock;
      mockDbFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?code=valid-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
      // Orphaned vault secret must be cleaned up
      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-to-cleanup');
    });

    it('does NOT store or change credential when user denies', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials/google/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe(ERROR_REDIRECT);
      expect(mockStoreSecret).not.toHaveBeenCalled();
      expect(mockDbFrom).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DELETE /credentials/google
  // ════════════════════════════════════════════════════════════════════════════

  describe('DELETE /credentials/google', () => {
    /** Sets up DB: first call finds credential, second call deletes row. */
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
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: findData ?? null, error: findError }),
          };
        }
        const deleteEq2 = vi.fn().mockResolvedValue({ error: deleteError });
        const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
        return { delete: vi.fn().mockReturnValue({ eq: deleteEq1 }) };
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
      setupDeleteDb({ findData: { id: 'cred-id-1', vault_secret_id: 'vault-id-1' } });

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
      setupDeleteDb({ findData: { id: 'cred-id-2', vault_secret_id: 'vault-secret-abc' } });

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
      setupDeleteDb({ findData: { id: 'cred-id-3', vault_secret_id: 'vault-id-3' } });

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
