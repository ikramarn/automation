/**
 * Property-based tests for notification preference enforcement (Property 8).
 *
 * **Validates: Requirements 14.5**
 *
 * Uses fast-check to verify that:
 *   - Property A: Disabled outcome notification preferences always suppress email dispatch.
 *   - Property B: Auth/critical email types are always sent regardless of preference values.
 *   - Property C: Enabled outcome notification preferences always allow email dispatch.
 *   - Property D: Missing preference rows (null DB result) default to sending (true).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Environment setup (must run before module import) ────────────────────────
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Supabase mock ────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// Lazy import after mock registration
const { shouldSendEmail } = await import('./notificationPreferences.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Outcome email types that are controlled by user preferences. */
const OUTCOME_TYPES = ['execution-success', 'execution-failure', 'pipeline-paused'] as const;
type OutcomeType = (typeof OUTCOME_TYPES)[number];

/** Maps an outcome email type to its preference column name. */
const PREFERENCE_COLUMN: Record<OutcomeType, string> = {
  'execution-success': 'notify_on_success',
  'execution-failure': 'notify_on_failure',
  'pipeline-paused': 'notify_on_pipeline_paused',
};

/** Auth + critical email types that must always be sent. */
const ALWAYS_SEND_TYPES = [
  'email-verify',
  'password-reset',
  'email-change',
  'account-locked',
  'payment-failure',
  'subscription-suspended',
  'token-expired',
] as const;

/**
 * Configure the Supabase mock so that
 * `.from('notification_preferences').select(col).eq('user_id', uid).maybeSingle()`
 * resolves to `{ data, error: null }`.
 */
function setupPreferenceMock(data: Record<string, unknown> | null): void {
  mockMaybeSingle.mockResolvedValue({ data, error: null });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
}

// ── Property 8: Notification Preference Enforcement ──────────────────────────

describe('Property 8: Notification Preference Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Property A — Disabled outcome notifications are never sent ────────────

  it(
    'Property A — any outcome type with its preference set to false → shouldSendEmail always returns false',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...OUTCOME_TYPES),
          fc.uuidV(4),
          async (emailType, userId) => {
            const col = PREFERENCE_COLUMN[emailType];
            // Preference row exists with the column set to false
            setupPreferenceMock({ [col]: false });

            const result = await shouldSendEmail(emailType, userId);
            expect(result).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property B — Auth/critical emails always sent regardless ──────────────

  it(
    'Property B — any auth/critical email type with any preference value → shouldSendEmail always returns true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ALWAYS_SEND_TYPES),
          fc.uuidV(4),
          fc.boolean(),
          async (emailType, userId, _prefValue) => {
            // Even if the DB would return a preference, auth/critical types
            // must never consult it — mock it anyway to confirm it's ignored.
            setupPreferenceMock({ notify_on_success: _prefValue });

            const result = await shouldSendEmail(emailType, userId);
            expect(result).toBe(true);

            // The DB must not have been queried for these types
            expect(mockFrom).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property C — Enabled outcome notifications are sent ──────────────────

  it(
    'Property C — any outcome type with its preference set to true → shouldSendEmail always returns true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...OUTCOME_TYPES),
          fc.uuidV(4),
          async (emailType, userId) => {
            const col = PREFERENCE_COLUMN[emailType];
            // Preference row exists with the column set to true
            setupPreferenceMock({ [col]: true });

            const result = await shouldSendEmail(emailType, userId);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property D — Missing preferences default to true ─────────────────────

  it(
    'Property D — DB returns null (no preference row) for any email type → shouldSendEmail always returns true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...OUTCOME_TYPES),
          fc.uuidV(4),
          async (emailType, userId) => {
            // maybeSingle returns { data: null } — simulates missing row
            setupPreferenceMock(null);

            const result = await shouldSendEmail(emailType, userId);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});
