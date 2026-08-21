/**
 * Unit tests for loginAttempts.ts
 *
 * The Supabase admin client is mocked so no real DB calls are made.
 *
 * Covered scenarios:
 *   - checkAccountLocked: 0 failures in window → not locked
 *   - checkAccountLocked: 2 failures in window → not locked
 *   - checkAccountLocked: 3 failures in window → locked with correct unlockTime
 *   - checkAccountLocked: failures older than 15 min window → not locked
 *   - recordLoginAttempt: calls Supabase insert with correct schema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Environment stubs (required by createSupabaseAdminClient) ────────────────
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();

// Chain builder: each method returns `this` (the chain object) so calls can
// be chained freely; the terminal call (order) resolves with the mock value.
function buildChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    gte: mockGte,
    order: mockOrder,
    insert: mockInsert,
  };
  // Make every method return the same chain object so chaining works
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockGte.mockReturnValue(chain);
  // `order` is the terminal call for SELECT queries in checkAccountLocked
  return chain;
}

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: (_table: string) => buildChain(),
  }),
}));

// Import AFTER mocking
import {
  checkAccountLocked,
  recordLoginAttempt,
} from './loginAttempts.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO timestamp N minutes ago. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('checkAccountLocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { locked: false } when there are 0 failures in the window', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await checkAccountLocked('user@example.com');

    expect(result).toEqual({ locked: false });
  });

  it('returns { locked: false } when there are 2 failures in the window (below threshold)', async () => {
    const attempts = [
      { attempted_at: minutesAgo(5) },
      { attempted_at: minutesAgo(10) },
    ];
    mockOrder.mockResolvedValueOnce({ data: attempts, error: null });

    const result = await checkAccountLocked('user@example.com');

    expect(result).toEqual({ locked: false });
  });

  it('returns { locked: true, lockedUntil } when there are exactly 3 failures in the window', async () => {
    const mostRecent = minutesAgo(3);
    const attempts = [
      { attempted_at: mostRecent },
      { attempted_at: minutesAgo(7) },
      { attempted_at: minutesAgo(12) },
    ];
    mockOrder.mockResolvedValueOnce({ data: attempts, error: null });

    const result = await checkAccountLocked('user@example.com');

    expect(result.locked).toBe(true);
    expect(result.lockedUntil).toBeInstanceOf(Date);

    // lockedUntil should be mostRecentAttempt + 15 minutes
    const expectedUnlock = new Date(new Date(mostRecent).getTime() + 15 * 60 * 1000);
    // Allow ±1 second tolerance for timing
    expect(Math.abs(result.lockedUntil!.getTime() - expectedUnlock.getTime())).toBeLessThan(1000);
  });

  it('returns { locked: false } when failures exist but are older than 15 minutes (outside window)', async () => {
    // The query filters by `gte(attempted_at, windowStart)` so the DB already
    // excludes old records. We simulate the DB returning an empty result.
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await checkAccountLocked('user@example.com');

    expect(result).toEqual({ locked: false });
  });

  it('returns { locked: false } when the Supabase query returns an error (fail open)', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

    const result = await checkAccountLocked('user@example.com');

    expect(result).toEqual({ locked: false });
  });

  it('returns { locked: true } when there are more than 3 failures in the window', async () => {
    const mostRecent = minutesAgo(1);
    const attempts = [
      { attempted_at: mostRecent },
      { attempted_at: minutesAgo(4) },
      { attempted_at: minutesAgo(8) },
      { attempted_at: minutesAgo(11) },
    ];
    mockOrder.mockResolvedValueOnce({ data: attempts, error: null });

    const result = await checkAccountLocked('user@example.com');

    expect(result.locked).toBe(true);
    expect(result.lockedUntil).toBeInstanceOf(Date);
  });
});

describe('recordLoginAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Supabase insert with correct schema for a failed attempt', async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordLoginAttempt('user@example.com', false);

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0]![0] as {
      email: string;
      success: boolean;
      attempted_at: string;
    };
    expect(insertArg.email).toBe('user@example.com');
    expect(insertArg.success).toBe(false);
    expect(typeof insertArg.attempted_at).toBe('string');
    // attempted_at should be a valid ISO date string close to now
    expect(new Date(insertArg.attempted_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('calls Supabase insert with correct schema for a successful attempt', async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordLoginAttempt('user@example.com', true);

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0]![0] as {
      email: string;
      success: boolean;
      attempted_at: string;
    };
    expect(insertArg.email).toBe('user@example.com');
    expect(insertArg.success).toBe(true);
  });

  it('does not throw when Supabase insert returns an error', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } });

    // Should not throw — recording failures are non-fatal
    await expect(recordLoginAttempt('user@example.com', false)).resolves.toBeUndefined();
  });
});
