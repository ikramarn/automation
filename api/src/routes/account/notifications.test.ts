/**
 * Notification preference route tests.
 *
 * Uses Fastify's app.inject() — no real HTTP server or Supabase calls.
 * Supabase admin client is mocked via vi.mock().
 *
 * Covered scenarios:
 *   GET /account/notifications → 200 with stored preferences
 *   GET /account/notifications → 200 with defaults when no row exists
 *   GET /account/notifications → 401 when unauthenticated
 *   PUT /account/notifications → 200 full update
 *   PUT /account/notifications → 200 partial update (only one field)
 *   PUT /account/notifications → 200 defaults preserved for unspecified fields on new user
 *   PUT /account/notifications → 400 when no fields provided
 *   PUT /account/notifications → 401 when unauthenticated
 *   PUT /account/notifications → 403 when CSRF missing
 *
 * Requirements: 14.5, 21.6
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
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: vi.fn(),
        deleteUser: vi.fn(),
      },
      signInWithPassword: vi.fn(),
    },
    from: mockFrom,
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────
const TEST_USER_ID = 'user-notifications-test-456';
const TEST_USER_EMAIL = 'notifications-test@example.com';

// ── JWT helper ───────────────────────────────────────────────────────────────
let cachedJwt: string | undefined;
async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (cachedJwt) return cachedJwt;
  cachedJwt = app.jwt.sign(
    {
      sub: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return cachedJwt;
}

// ── CSRF helper ──────────────────────────────────────────────────────────────
function buildCsrfHeaders(
  app: FastifyInstance,
  token: string,
): { 'x-csrf-token': string; cookie: string } {
  const signed = app.signCookie(token);
  return {
    'x-csrf-token': token,
    cookie: `csrf_token=${signed}`,
  };
}

// ── Helper: build GET mock chain ──────────────────────────────────────────────
function setupGetMock(
  data: {
    notify_on_success: boolean;
    notify_on_failure: boolean;
    notify_on_pipeline_paused: boolean;
  } | null,
): void {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data, error: null });
  const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  mockFrom.mockReturnValue({ select: selectMock });
}

// ── Helper: build upsert mock ─────────────────────────────────────────────────
function setupUpsertMock(
  existing: {
    notify_on_success: boolean;
    notify_on_failure: boolean;
    notify_on_pipeline_paused: boolean;
  } | null = null,
  upsertError: null | { message: string } = null,
): void {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: existing, error: null });
  const eqSelectChain = { eq: vi.fn(), maybeSingle: maybeSingleMock };
  eqSelectChain.eq.mockReturnValue(eqSelectChain);
  const selectMock = vi.fn().mockReturnValue(eqSelectChain);

  const upsertMock = vi.fn().mockResolvedValue({ data: null, error: upsertError });

  mockFrom.mockReturnValue({
    select: selectMock,
    upsert: upsertMock,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Notification preference routes', () => {
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
    cachedJwt = undefined;
  });

  // ── GET /account/notifications ────────────────────────────────────────────

  describe('GET /account/notifications', () => {
    it('returns 200 with stored preferences', async () => {
      setupGetMock({
        notify_on_success: true,
        notify_on_failure: false,
        notify_on_pipeline_paused: true,
      });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/account/notifications',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        notify_on_success: boolean;
        notify_on_failure: boolean;
        notify_on_pipeline_paused: boolean;
      }>();
      expect(body.notify_on_success).toBe(true);
      expect(body.notify_on_failure).toBe(false);
      expect(body.notify_on_pipeline_paused).toBe(true);
    });

    it('returns 200 with all-true defaults when no preferences row exists (Req 14.5)', async () => {
      setupGetMock(null);

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/account/notifications',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        notify_on_success: boolean;
        notify_on_failure: boolean;
        notify_on_pipeline_paused: boolean;
      }>();
      expect(body.notify_on_success).toBe(true);
      expect(body.notify_on_failure).toBe(true);
      expect(body.notify_on_pipeline_paused).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/account/notifications',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── PUT /account/notifications ────────────────────────────────────────────

  describe('PUT /account/notifications', () => {
    it('returns 200 with updated preferences on full update', async () => {
      setupUpsertMock({
        notify_on_success: true,
        notify_on_failure: true,
        notify_on_pipeline_paused: true,
      });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-full-update',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: {
          notify_on_success: false,
          notify_on_failure: true,
          notify_on_pipeline_paused: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        notify_on_success: boolean;
        notify_on_failure: boolean;
        notify_on_pipeline_paused: boolean;
      }>();
      expect(body.notify_on_success).toBe(false);
      expect(body.notify_on_failure).toBe(true);
      expect(body.notify_on_pipeline_paused).toBe(false);
    });

    it('returns 200 and preserves existing values on partial update', async () => {
      setupUpsertMock({
        notify_on_success: false,
        notify_on_failure: true,
        notify_on_pipeline_paused: true,
      });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-partial-update',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { notify_on_success: true }, // only updating one field
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        notify_on_success: boolean;
        notify_on_failure: boolean;
        notify_on_pipeline_paused: boolean;
      }>();
      expect(body.notify_on_success).toBe(true);
      // Existing values are preserved
      expect(body.notify_on_failure).toBe(true);
      expect(body.notify_on_pipeline_paused).toBe(true);
    });

    it('defaults unspecified fields to true for new users (Req 14.5)', async () => {
      // No existing row — null means brand new user
      setupUpsertMock(null);

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-new-user-defaults',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { notify_on_success: false }, // only one field, no prior row
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        notify_on_success: boolean;
        notify_on_failure: boolean;
        notify_on_pipeline_paused: boolean;
      }>();
      expect(body.notify_on_success).toBe(false); // explicitly set
      expect(body.notify_on_failure).toBe(true);   // defaulted to true
      expect(body.notify_on_pipeline_paused).toBe(true); // defaulted to true
    });

    it('returns 400 when no preference fields are provided', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-empty-prefs',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        payload: { notify_on_success: false },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when CSRF token is missing', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: { Authorization: `Bearer ${token}` },
        payload: { notify_on_success: false },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<{ error_code: string }>().error_code).toBe('csrf_token_invalid');
    });

    it('upserts using user_id as the conflict key', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqChain = { eq: vi.fn(), maybeSingle: maybeSingleMock };
      eqChain.eq.mockReturnValue(eqChain);
      const selectMock = vi.fn().mockReturnValue(eqChain);
      mockFrom.mockReturnValue({ select: selectMock, upsert: upsertMock });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-upsert-key',
      );

      await app.inject({
        method: 'PUT',
        url: '/account/notifications',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { notify_on_failure: false },
      });

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: TEST_USER_ID }),
        { onConflict: 'user_id' },
      );
    });
  });
});
