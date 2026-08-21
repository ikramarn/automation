/**
 * Unit tests for tokenExpiry.ts
 *
 * Supabase admin client and email sender are mocked so no real DB or email
 * calls are made.
 *
 * Covered scenarios:
 *   recordTokenRefreshFailure:
 *     - below threshold (< 3 failures) → returns { expired: false }
 *     - at threshold (3+ failures) → marks credential expired, pauses pipelines,
 *       sends email, returns { expired: true }
 *     - DB query error → returns { expired: false } (fail open)
 *
 *   resetTokenRefreshFailures:
 *     - calls Supabase delete for the correct user/platform
 *     - does not throw when Supabase returns an error
 *
 *   isNonRetryableTokenError:
 *     - correctly identifies non-retryable vs retryable error patterns
 *
 * Requirements: 4.3, 4.5, 5.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Environment stubs ────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Hoisted mock refs ─────────────────────────────────────────────────────────
// vi.hoisted() runs before module resolution and allows mock factories to
// reference variables without the hoisting-initialisation issue.
const {
  mockInsert,
  mockSelect,
  mockUpdate,
  mockDelete,
  mockEq,
  mockIn,
  mockGte,
  mockContains,
  mockGetUserById,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockEq: vi.fn(),
  mockIn: vi.fn(),
  mockGte: vi.fn(),
  mockContains: vi.fn(),
  mockGetUserById: vi.fn(),
  mockSendEmail: vi.fn(),
}));

// ── Supabase mock ────────────────────────────────────────────────────────────
//
// We build a chainable query mock. Each Supabase query builder method returns
// the same chain so `.eq().eq().gte()` etc. all work. Terminal methods
// (insert, select resolved by .gte / .in / .maybeSingle, update resolved by
// .in, delete resolved by .eq) are the mocked async endpoints.

function makeChain() {
  const chain: Record<string, unknown> = {};

  chain['insert'] = mockInsert;
  chain['select'] = mockSelect;
  chain['update'] = mockUpdate;
  chain['delete'] = mockDelete;
  chain['eq'] = mockEq;
  chain['in'] = mockIn;
  chain['gte'] = mockGte;
  chain['contains'] = mockContains;

  // All intermediate builder methods return the same chain
  mockSelect.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  mockDelete.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  mockContains.mockReturnValue(chain);
  // mockGte is configured per-test since it is the terminal call for count query

  return chain;
}

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: (_table: string) => makeChain(),
    auth: {
      admin: {
        getUserById: mockGetUserById,
      },
    },
  }),
}));

// ── Email mock ───────────────────────────────────────────────────────────────
vi.mock('../lib/email.js', () => ({
  sendTransactionalEmail: mockSendEmail,
}));

// Import AFTER mocking
import {
  recordTokenRefreshFailure,
  resetTokenRefreshFailures,
  isNonRetryableTokenError,
  GOOGLE_DRIVE_AUTH_EXPIRED_REASON,
} from './tokenExpiry.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO timestamp N minutes ago. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recordTokenRefreshFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: insert succeeds
    mockInsert.mockResolvedValue({ error: null });
    // Default: getUserById returns a user with email
    mockGetUserById.mockResolvedValue({
      data: { user: { email: 'user@example.com' } },
      error: null,
    });
    // Default: email send succeeds
    mockSendEmail.mockResolvedValue(undefined);
  });

  it('returns { expired: false } when there are fewer than 3 failures in the window', async () => {
    // Simulate 2 failures returned from DB count query
    const twoFailures = [
      { failed_at: minutesAgo(5) },
      { failed_at: minutesAgo(10) },
    ];
    // gte is the terminal call for the count select
    mockGte.mockResolvedValueOnce({ data: twoFailures, error: null });

    const result = await recordTokenRefreshFailure('user-1', 'youtube');

    expect(result).toEqual({ expired: false });
    // Email should NOT have been sent
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns { expired: false } when there is exactly 1 failure', async () => {
    mockGte.mockResolvedValueOnce({ data: [{ failed_at: minutesAgo(2) }], error: null });

    const result = await recordTokenRefreshFailure('user-1', 'tiktok');

    expect(result).toEqual({ expired: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns { expired: true } when there are exactly 3 failures in the window', async () => {
    const threeFailures = [
      { failed_at: minutesAgo(2) },
      { failed_at: minutesAgo(7) },
      { failed_at: minutesAgo(12) },
    ];
    mockGte.mockResolvedValueOnce({ data: threeFailures, error: null });

    // update (for credentials) and second in (for pipelines) both need responses
    mockIn.mockResolvedValue({ error: null });

    const result = await recordTokenRefreshFailure('user-1', 'youtube');

    expect(result).toEqual({ expired: true });
  });

  it('marks credential status as token_expired when threshold is met', async () => {
    const threeFailures = [
      { failed_at: minutesAgo(1) },
      { failed_at: minutesAgo(5) },
      { failed_at: minutesAgo(9) },
    ];
    mockGte.mockResolvedValueOnce({ data: threeFailures, error: null });
    mockIn.mockResolvedValue({ error: null });

    await recordTokenRefreshFailure('user-1', 'youtube');

    // The update chain should have been called — verify mockUpdate was invoked
    // (the chain mock means mockUpdate is called with the update payload)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'token_expired' }),
    );
  });

  it('pauses pipelines targeting the platform when threshold is met', async () => {
    const threeFailures = [
      { failed_at: minutesAgo(3) },
      { failed_at: minutesAgo(6) },
      { failed_at: minutesAgo(11) },
    ];
    mockGte.mockResolvedValueOnce({ data: threeFailures, error: null });
    mockIn.mockResolvedValue({ error: null });

    await recordTokenRefreshFailure('user-1', 'facebook');

    // pipelines.update should have been called with status: 'paused'
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paused' }),
    );
  });

  it('sends token-expired email when threshold is met', async () => {
    const threeFailures = [
      { failed_at: minutesAgo(1) },
      { failed_at: minutesAgo(8) },
      { failed_at: minutesAgo(14) },
    ];
    mockGte.mockResolvedValueOnce({ data: threeFailures, error: null });
    mockIn.mockResolvedValue({ error: null });

    await recordTokenRefreshFailure('user-1', 'youtube');

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      'token-expired',
      'user@example.com',
      expect.objectContaining({
        platform_name: 'Youtube',
        settings_link: expect.any(String),
      }),
    );
  });

  it('returns { expired: true } when there are more than 3 failures in the window', async () => {
    const fiveFailures = [
      { failed_at: minutesAgo(1) },
      { failed_at: minutesAgo(3) },
      { failed_at: minutesAgo(5) },
      { failed_at: minutesAgo(9) },
      { failed_at: minutesAgo(13) },
    ];
    mockGte.mockResolvedValueOnce({ data: fiveFailures, error: null });
    mockIn.mockResolvedValue({ error: null });

    const result = await recordTokenRefreshFailure('user-1', 'instagram');

    expect(result).toEqual({ expired: true });
  });

  it('returns { expired: false } when DB count query returns an error (fail open)', async () => {
    mockGte.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

    const result = await recordTokenRefreshFailure('user-1', 'youtube');

    expect(result).toEqual({ expired: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does not throw when the insert fails (failure recording is non-fatal)', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } });
    // count query returns below threshold
    mockGte.mockResolvedValueOnce({ data: [{ failed_at: minutesAgo(2) }], error: null });

    await expect(
      recordTokenRefreshFailure('user-1', 'tiktok'),
    ).resolves.toEqual({ expired: false });
  });
});

// ── resetTokenRefreshFailures ─────────────────────────────────────────────────

describe('resetTokenRefreshFailures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Supabase delete for the correct user and platform', async () => {
    // The delete chain calls .delete().eq('user_id', ...).eq('platform', ...)
    // We configure mockEq so the first call returns the chain and the second
    // resolves with a result, matching the chained query structure.
    const chain = {
      eq: mockEq,
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      delete: mockDelete,
      in: mockIn,
      gte: mockGte,
      contains: mockContains,
    };
    mockEq
      .mockReturnValueOnce(chain)               // first .eq('user_id', ...) → chain
      .mockResolvedValueOnce({ error: null });   // second .eq('platform', ...) → resolves

    await resetTokenRefreshFailures('user-1', 'youtube');

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mockEq).toHaveBeenCalledWith('platform', 'youtube');
  });

  it('does not throw when Supabase delete returns an error', async () => {
    const chain = {
      eq: mockEq,
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      delete: mockDelete,
      in: mockIn,
      gte: mockGte,
      contains: mockContains,
    };
    mockEq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: { message: 'delete failed' } });

    await expect(
      resetTokenRefreshFailures('user-1', 'youtube'),
    ).resolves.toBeUndefined();
  });
});

// ── isNonRetryableTokenError ──────────────────────────────────────────────────

describe('isNonRetryableTokenError', () => {
  it('returns true for invalid_grant error message', () => {
    expect(isNonRetryableTokenError({ message: 'invalid_grant' })).toBe(true);
  });

  it('returns true for "token has been expired or revoked" message', () => {
    expect(
      isNonRetryableTokenError({ message: 'Token has been expired or revoked' }),
    ).toBe(true);
  });

  it('returns true for "token expired" message', () => {
    expect(isNonRetryableTokenError({ message: 'token expired' })).toBe(true);
  });

  it('returns true for 401 HTTP status code', () => {
    expect(isNonRetryableTokenError({ code: 401 })).toBe(true);
  });

  it('returns true for 403 HTTP status code', () => {
    expect(isNonRetryableTokenError({ code: 403 })).toBe(true);
  });

  it('returns true for access_denied error', () => {
    expect(isNonRetryableTokenError({ message: 'access_denied' })).toBe(true);
  });

  it('returns false for network timeout error', () => {
    expect(isNonRetryableTokenError({ message: 'network timeout' })).toBe(false);
  });

  it('returns false for transient server error', () => {
    expect(isNonRetryableTokenError({ message: 'Internal Server Error', code: 500 })).toBe(false);
  });

  it('returns false for empty error object', () => {
    expect(isNonRetryableTokenError({})).toBe(false);
  });
});

// ── GOOGLE_DRIVE_AUTH_EXPIRED_REASON ─────────────────────────────────────────

describe('GOOGLE_DRIVE_AUTH_EXPIRED_REASON', () => {
  it('equals the exact string required by Requirement 4.5', () => {
    expect(GOOGLE_DRIVE_AUTH_EXPIRED_REASON).toBe('Google Drive authorization expired');
  });
});
