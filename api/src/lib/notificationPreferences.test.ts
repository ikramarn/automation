/**
 * Unit tests for notificationPreferences.ts — shouldSendEmail()
 *
 * The Supabase admin client is mocked so no real DB calls are made.
 *
 * Covered scenarios:
 *   - execution-success with notify_on_success=false  → returns false
 *   - execution-success with notify_on_success=true   → returns true
 *   - execution-failure with notify_on_failure=false  → returns false
 *   - pipeline-paused with notify_on_pipeline_paused=false → returns false
 *   - email-verify always returns true (auth type)
 *   - account-locked always returns true (auth type)
 *   - payment-failure always returns true (critical type)
 *   - No preference row (data === null) → defaults to true
 *   - DB error → fails open (returns true)
 *
 * Requirements: 14.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Environment stubs ────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Supabase mock ────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();

function buildChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  return chain;
}

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: (_table: string) => buildChain(),
  }),
}));

// Import AFTER mocking
import { shouldSendEmail } from './notificationPreferences.js';

// ── Tests ────────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';

describe('shouldSendEmail — pipeline-outcome types (controlled by preferences)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for execution-success when notify_on_success is false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { notify_on_success: false },
      error: null,
    });

    const result = await shouldSendEmail('execution-success', USER_ID);

    expect(result).toBe(false);
  });

  it('returns true for execution-success when notify_on_success is true', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { notify_on_success: true },
      error: null,
    });

    const result = await shouldSendEmail('execution-success', USER_ID);

    expect(result).toBe(true);
  });

  it('returns false for execution-failure when notify_on_failure is false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { notify_on_failure: false },
      error: null,
    });

    const result = await shouldSendEmail('execution-failure', USER_ID);

    expect(result).toBe(false);
  });

  it('returns false for pipeline-paused when notify_on_pipeline_paused is false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { notify_on_pipeline_paused: false },
      error: null,
    });

    const result = await shouldSendEmail('pipeline-paused', USER_ID);

    expect(result).toBe(false);
  });
});

describe('shouldSendEmail — auth types (always sent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for email-verify regardless of preferences (no DB call)', async () => {
    const result = await shouldSendEmail('email-verify', USER_ID);

    expect(result).toBe(true);
    // Auth types must bypass the DB entirely
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns true for password-reset regardless of preferences', async () => {
    const result = await shouldSendEmail('password-reset', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns true for email-change regardless of preferences', async () => {
    const result = await shouldSendEmail('email-change', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns true for account-locked regardless of preferences', async () => {
    const result = await shouldSendEmail('account-locked', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });
});

describe('shouldSendEmail — billing/critical types (always sent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for payment-failure regardless of preferences', async () => {
    const result = await shouldSendEmail('payment-failure', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns true for subscription-suspended regardless of preferences', async () => {
    const result = await shouldSendEmail('subscription-suspended', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns true for token-expired regardless of preferences', async () => {
    const result = await shouldSendEmail('token-expired', USER_ID);

    expect(result).toBe(true);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });
});

describe('shouldSendEmail — missing preference row (defaults)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for execution-success when no preference row exists', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await shouldSendEmail('execution-success', USER_ID);

    expect(result).toBe(true);
  });

  it('returns true for execution-failure when no preference row exists', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await shouldSendEmail('execution-failure', USER_ID);

    expect(result).toBe(true);
  });

  it('returns true for pipeline-paused when no preference row exists', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await shouldSendEmail('pipeline-paused', USER_ID);

    expect(result).toBe(true);
  });
});

describe('shouldSendEmail — DB error handling (fail open)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for execution-success when the DB returns an error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    });

    const result = await shouldSendEmail('execution-success', USER_ID);

    expect(result).toBe(true);
  });

  it('returns true for execution-failure when the DB returns an error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    });

    const result = await shouldSendEmail('execution-failure', USER_ID);

    expect(result).toBe(true);
  });

  it('returns true for pipeline-paused when the DB throws unexpectedly', async () => {
    mockMaybeSingle.mockRejectedValueOnce(new Error('unexpected DB failure'));

    const result = await shouldSendEmail('pipeline-paused', USER_ID);

    expect(result).toBe(true);
  });
});
