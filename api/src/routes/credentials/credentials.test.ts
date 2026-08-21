/**
 * Credential route tests.
 *
 * Uses Fastify's app.inject() — no real HTTP server, no real Supabase or
 * Vault calls. Both Supabase and the vault helpers are mocked via vi.mock().
 *
 * Covered scenarios:
 *   GET  /credentials          → 200 with masked list
 *   PUT  /credentials/:type    → 200 with masked value
 *   PUT  /credentials/:type    → 400 with invalid type
 *   DELETE /credentials/:type  → 200
 *   DELETE /credentials/:type  → 400 with invalid type
 *   DELETE /credentials/:type  → 404 when not found
 *   Raw key never appears in response
 *   401 when unauthenticated (all methods)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 18.4
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

// ── Mock vault helpers ───────────────────────────────────────────────────────
const mockStoreSecret = vi.fn<() => Promise<string>>().mockResolvedValue('vault-uuid-123');
const mockDeleteSecret = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('../../lib/vault.js', () => ({
  storeSecret: (...args: unknown[]) => mockStoreSecret(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  maskApiKey: (key: string) => (key.length >= 4 ? `\u2022\u2022\u2022\u2022${key.slice(-4)}` : '\u2022\u2022\u2022\u2022'),
  maskValue: (key: string) => (key.length >= 4 ? `\u2022\u2022\u2022\u2022${key.slice(-4)}` : '\u2022\u2022\u2022\u2022'),
}));

// ── Mock Supabase admin client ───────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: {} },
    from: mockFrom,
  }),
}));

// ── Helper: build a signed JWT for tests ────────────────────────────────────
const TEST_USER_ID = 'user-cred-test-123';
let testJwt: string;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  testJwt = app.jwt.sign(
    {
      sub: TEST_USER_ID,
      email: 'cred-test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

// ── CSRF token helper ────────────────────────────────────────────────────────
// State-changing requests (PUT/DELETE) require a matching CSRF token + cookie.
// We bypass this by using unsigned cookie + matching header (same raw value).
// The csrfProtect middleware unsigns the cookie; in tests we use a plain value
// and set an unsigned cookie so the check is effectively: header === cookie.
//
// Since our test environment uses @fastify/cookie with a secret, we work around
// CSRF by directly calling app.inject with both the header and signed cookie.
// The simplest approach: we sign the cookie ourselves using the app's cookie
// signing, then pass both the signed cookie and the plain value in the header.
function buildCsrfHeaders(
  app: FastifyInstance,
  token: string,
): { 'x-csrf-token': string; cookie: string } {
  // Sign the cookie using the same mechanism as the app
  const signed = app.signCookie(token);
  return {
    'x-csrf-token': token,
    cookie: `csrf_token=${signed}`,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Credential routes', () => {
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
    mockStoreSecret.mockResolvedValue('vault-uuid-new');
    mockDeleteSecret.mockResolvedValue(undefined);
  });

  // ── GET /credentials ─────────────────────────────────────────────────────

  describe('GET /credentials', () => {
    it('returns 200 with the list of credentials (masked values)', async () => {
      // Mock: supabase.from('credentials').select(...).eq(...).order(...)
      const orderMock = vi.fn().mockResolvedValue({
        data: [
          {
            credential_type: 'heygen_api_key',
            masked_value: '••••abcd',
            status: 'active',
            updated_at: '2024-06-01T12:00:00Z',
          },
          {
            credential_type: 'openai_api_key',
            masked_value: '••••efgh',
            status: 'active',
            updated_at: '2024-06-02T09:00:00Z',
          },
        ],
        error: null,
      });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockFrom.mockReturnValue({ select: selectMock });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/credentials',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<
        Array<{
          credential_type: string;
          masked_value: string;
          status: string;
          updated_at: string;
        }>
      >();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0]?.credential_type).toBe('heygen_api_key');
      expect(body[0]?.masked_value).toBe('••••abcd');
      expect(body[0]?.status).toBe('active');
    });

    it('returns 200 with an empty array when no credentials are stored', async () => {
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockFrom.mockReturnValue({ select: selectMock });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/credentials',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/credentials',
      });

      expect(response.statusCode).toBe(401);
    });

    it('does not expose any raw key value in the response', async () => {
      const rawKey = 'sk-real-openai-key-abcd';
      const orderMock = vi.fn().mockResolvedValue({
        data: [
          {
            credential_type: 'openai_api_key',
            masked_value: '••••abcd',
            status: 'active',
            updated_at: '2024-06-01T00:00:00Z',
          },
        ],
        error: null,
      });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockFrom.mockReturnValue({ select: selectMock });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/credentials',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.body).not.toContain(rawKey);
    });
  });

  // ── PUT /credentials/:type ────────────────────────────────────────────────

  describe('PUT /credentials/:type', () => {
    /**
     * Sets up the Supabase mock for a successful upsert flow:
     * - maybeSingle() returns null (no existing credential)
     * - upsert() returns no error
     */
    function setupUpsertMocks(existing: Record<string, unknown> | null = null): void {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: existing, error: null });
      const eqChain = {
        eq: vi.fn(),
        maybeSingle: maybeSingleMock,
      };
      eqChain.eq.mockReturnValue(eqChain);

      const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

      mockFrom.mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnValue(eqChain),
        upsert: upsertMock,
      }));
    }

    it('returns 200 with masked value for a valid credential type', async () => {
      setupUpsertMocks();

      const token = await getTestJwt(app);
      const csrfToken = 'test-csrf-token-put';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const rawKey = 'sk-openai-key-1234abcd';
      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/openai_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { value: rawKey },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        credential_type: string;
        masked_value: string;
        status: string;
      }>();
      expect(body.credential_type).toBe('openai_api_key');
      expect(body.masked_value).toBe('••••abcd');
      expect(body.status).toBe('active');
    });

    it('masked_value matches the masking rule: "••••" + last 4 chars', async () => {
      setupUpsertMocks();

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-mask-test';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const rawKey = 'heygen-secret-key-XY12';
      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { value: rawKey },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ masked_value: string }>();
      // "••••" + "XY12" = "••••XY12"
      expect(body.masked_value).toBe('••••XY12');
    });

    it('raw key never appears in the response body', async () => {
      setupUpsertMocks();

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-no-leak-test';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const rawKey = 'super-secret-openai-key-9876';
      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/openai_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { value: rawKey },
      });

      expect(response.statusCode).toBe(200);
      // The full raw key must NOT appear anywhere in the response
      expect(response.body).not.toContain(rawKey);
    });

    it('returns 400 for an invalid credential type', async () => {
      const token = await getTestJwt(app);
      const csrfToken = 'csrf-invalid-type';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/not_a_real_type',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { value: 'some-value' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error_code: string; details: { valid_types: string[] } }>();
      expect(body.error_code).toBe('bad_request');
      expect(body.details.valid_types).toContain('heygen_api_key');
    });

    it('returns 400 when value is missing from the request body', async () => {
      const token = await getTestJwt(app);
      const csrfToken = 'csrf-missing-value';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('deletes old vault secret when updating an existing credential', async () => {
      // Existing credential has vault_secret_id = 'old-vault-uuid'
      setupUpsertMocks({ vault_secret_id: 'old-vault-uuid' });

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-update-credential';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      await app.inject({
        method: 'PUT',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { value: 'new-heygen-key-abcd' },
      });

      // storeSecret was called once for the new value
      expect(mockStoreSecret).toHaveBeenCalledOnce();
      // deleteSecret was called once for the old vault secret
      expect(mockDeleteSecret).toHaveBeenCalledWith('old-vault-uuid');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/credentials/heygen_api_key',
        payload: { value: 'some-key' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts all valid credential types', async () => {
      const validTypes = [
        'heygen_api_key',
        'openai_api_key',
        'google_drive_refresh_token',
        'youtube_access_token',
        'youtube_refresh_token',
        'tiktok_access_token',
        'tiktok_refresh_token',
        'facebook_access_token',
        'instagram_access_token',
      ];

      const token = await getTestJwt(app);

      for (const credType of validTypes) {
        setupUpsertMocks();
        const csrfToken = `csrf-valid-${credType}`;
        const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
          app,
          csrfToken,
        );

        const response = await app.inject({
          method: 'PUT',
          url: `/credentials/${credType}`,
          headers: {
            Authorization: `Bearer ${token}`,
            'x-csrf-token': csrfHeader,
            cookie: csrfCookie,
          },
          payload: { value: 'test-value-1234' },
        });

        expect(response.statusCode).toBe(200);
      }
    });
  });

  // ── DELETE /credentials/:type ─────────────────────────────────────────────

  describe('DELETE /credentials/:type', () => {
    /**
     * Sets up Supabase mock for a successful delete flow.
     */
    function setupDeleteMocks(
      credential: { id: string; vault_secret_id: string } | null = {
        id: 'cred-row-id-1',
        vault_secret_id: 'vault-uuid-to-delete',
      },
    ): void {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: credential, error: null });
      const eqSelectChain = {
        eq: vi.fn(),
        maybeSingle: maybeSingleMock,
      };
      eqSelectChain.eq.mockReturnValue(eqSelectChain);

      const eqDeleteChain = {
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      eqDeleteChain.eq.mockReturnValue(eqDeleteChain);

      // Pipeline update mock: .update().eq().in().select()
      const inMock = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
      const eqUpdateChain = {
        eq: vi.fn().mockReturnValue({ in: inMock }),
      };
      const updateMock = vi.fn().mockReturnValue(eqUpdateChain);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'pipelines') {
          return { update: updateMock };
        }
        return {
          select: vi.fn().mockReturnValue(eqSelectChain),
          delete: vi.fn().mockReturnValue(eqDeleteChain),
        };
      });
    }

    it('returns 200 with message "Credential deleted"', async () => {
      setupDeleteMocks();

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-delete-test';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toBe('Credential deleted');
    });

    it('deletes the vault secret when credential is deleted', async () => {
      setupDeleteMocks({ id: 'row-id', vault_secret_id: 'vault-secret-xyz' });

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-vault-delete';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      await app.inject({
        method: 'DELETE',
        url: '/credentials/openai_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
      });

      expect(mockDeleteSecret).toHaveBeenCalledWith('vault-secret-xyz');
    });

    it('returns 400 for an invalid credential type', async () => {
      const token = await getTestJwt(app);
      const csrfToken = 'csrf-invalid-delete';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/not_valid_type',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error_code: string }>().error_code).toBe('bad_request');
    });

    it('returns 404 when credential does not exist', async () => {
      setupDeleteMocks(null);

      const token = await getTestJwt(app);
      const csrfToken = 'csrf-not-found-delete';
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        csrfToken,
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/heygen_api_key',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ error_code: string }>().error_code).toBe('not_found');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/credentials/heygen_api_key',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
