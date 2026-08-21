/**
 * Account profile route tests.
 *
 * Uses Fastify's app.inject() — no real HTTP server or Supabase calls.
 * Supabase admin client is mocked via vi.mock().
 *
 * Covered scenarios:
 *   GET  /account             → 200 with profile data
 *   GET  /account             → 200 with defaults when no profile row exists
 *   GET  /account             → 401 when unauthenticated
 *   PUT  /account             → 200 display name update
 *   PUT  /account             → 200 email change verification initiated
 *   PUT  /account             → 400 when no fields provided
 *   PUT  /account             → 400 display name exceeds 50 chars
 *   PUT  /account             → 401 when unauthenticated
 *   PUT  /account/password    → 200 on valid current + new password
 *   PUT  /account/password    → 400 when current password is wrong
 *   PUT  /account/password    → 400 when new password too short
 *   PUT  /account/password    → 401 when unauthenticated
 *   DELETE /account           → 200 on valid email confirmation
 *   DELETE /account           → 400 when email does not match
 *   DELETE /account           → 401 when unauthenticated
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 16.4
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
const mockUpdateUserById = vi.fn();
const mockDeleteUser = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: mockUpdateUserById,
        deleteUser: mockDeleteUser,
      },
      signInWithPassword: mockSignInWithPassword,
    },
    from: mockFrom,
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────
const TEST_USER_ID = 'user-account-test-123';
const TEST_USER_EMAIL = 'account-test@example.com';

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

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Account profile routes', () => {
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

  // ── GET /account ─────────────────────────────────────────────────────────

  describe('GET /account', () => {
    it('returns 200 with profile data when user_profiles row exists', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: {
          display_name: 'Test User',
          email: TEST_USER_EMAIL,
          subscription_status: 'active',
        },
        error: null,
      });
      const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockFrom.mockReturnValue({ select: selectMock });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/account',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        display_name: string;
        email: string;
        subscription_status: string;
      }>();
      expect(body.display_name).toBe('Test User');
      expect(body.email).toBe(TEST_USER_EMAIL);
      expect(body.subscription_status).toBe('active');
    });

    it('returns 200 with JWT-fallback values when no profile row exists', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockFrom.mockReturnValue({ select: selectMock });

      const token = await getTestJwt(app);
      const response = await app.inject({
        method: 'GET',
        url: '/account',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        display_name: string | null;
        email: string;
        subscription_status: string;
      }>();
      expect(body.display_name).toBeNull();
      expect(body.email).toBe(TEST_USER_EMAIL);
      expect(body.subscription_status).toBe('active');
    });

    it('returns 401 when no Authorization header provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/account',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── PUT /account ──────────────────────────────────────────────────────────

  describe('PUT /account', () => {
    it('returns 200 when updating display name', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({ update: updateMock });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-update-name',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { display_name: 'New Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('Display name updated');
    });

    it('returns 200 when initiating email change', async () => {
      mockUpdateUserById.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-email-change',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { email: 'newemail@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('Verification email sent');
      expect(mockUpdateUserById).toHaveBeenCalledWith(TEST_USER_ID, {
        email: 'newemail@example.com',
        email_confirm: false,
      });
    });

    it('returns 200 when updating both display name and email', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({ update: updateMock });
      mockUpdateUserById.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-both-update',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { display_name: 'Updated', email: 'updated@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('Display name updated');
      expect(body.message).toContain('Verification email sent');
    });

    it('returns 400 when no fields provided', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-no-fields',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when display_name exceeds 50 characters', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-long-name',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { display_name: 'A'.repeat(51) },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when display_name is empty string', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-empty-name',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { display_name: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        payload: { display_name: 'Test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when CSRF token is missing', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'PUT',
        url: '/account',
        headers: { Authorization: `Bearer ${token}` },
        payload: { display_name: 'Test' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<{ error_code: string }>().error_code).toBe('csrf_token_invalid');
    });

    it('email change is not applied immediately (Req 21.2)', async () => {
      mockUpdateUserById.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-email-verify',
      );

      await app.inject({
        method: 'PUT',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { email: 'pending@example.com' },
      });

      // email_confirm: false means the change is NOT applied until verified
      expect(mockUpdateUserById).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ email_confirm: false }),
      );
    });
  });

  // ── PUT /account/password ────────────────────────────────────────────────

  describe('PUT /account/password', () => {
    it('returns 200 when current password is correct and new password meets requirements', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: TEST_USER_ID }, session: {} },
        error: null,
      });
      mockUpdateUserById.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-password-change',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/password',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { current_password: 'OldPass@123', new_password: 'NewPass@456' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toBe('Password updated successfully');
    });

    it('returns 400 when current password is incorrect', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-wrong-password',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/password',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { current_password: 'WrongPass@1', new_password: 'NewPass@456' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('bad_request');
    });

    it('returns 400 when new password is less than 8 characters', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-short-new-pass',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/password',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { current_password: 'OldPass@123', new_password: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when current_password is missing', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-missing-current',
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/account/password',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { new_password: 'NewPass@456' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/account/password',
        payload: { current_password: 'OldPass@123', new_password: 'NewPass@456' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('verifies current password using the user email from JWT', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: { id: TEST_USER_ID }, session: {} },
        error: null,
      });
      mockUpdateUserById.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-email-verify-pass',
      );

      await app.inject({
        method: 'PUT',
        url: '/account/password',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { current_password: 'OldPass@123', new_password: 'NewPass@456' },
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: TEST_USER_EMAIL,
        password: 'OldPass@123',
      });
    });
  });

  // ── DELETE /account ──────────────────────────────────────────────────────

  describe('DELETE /account', () => {
    it('returns 200 when email matches and deletion succeeds', async () => {
      mockDeleteUser.mockResolvedValue({ error: null });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-delete-account',
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { email: TEST_USER_EMAIL },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('deletion initiated');
      expect(mockDeleteUser).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('returns 400 when email does not match registered email (Req 21.5)', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-wrong-email-delete',
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { email: 'wrong@example.com' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('bad_request');
      // deleteUser must NOT have been called
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 400 when email field is missing', async () => {
      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-no-email-delete',
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when Supabase deletion fails (Req 21.4)', async () => {
      mockDeleteUser.mockResolvedValue({
        error: { message: 'Internal deletion error' },
      });

      const token = await getTestJwt(app);
      const { 'x-csrf-token': csrfHeader, cookie: csrfCookie } = buildCsrfHeaders(
        app,
        'csrf-delete-fail',
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfHeader,
          cookie: csrfCookie,
        },
        payload: { email: TEST_USER_EMAIL },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        payload: { email: TEST_USER_EMAIL },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when CSRF token is missing', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'DELETE',
        url: '/account',
        headers: { Authorization: `Bearer ${token}` },
        payload: { email: TEST_USER_EMAIL },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
