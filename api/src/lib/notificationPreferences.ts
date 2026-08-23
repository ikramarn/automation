import { createSupabaseAdminClient } from './supabase.js';

// ── Email type classification ──────────────────────────────────────────────

/**
 * Auth-related email types that are always sent regardless of user preferences.
 * These are critical account/security flows that must never be suppressed.
 */
const AUTH_EMAIL_TYPES = new Set([
  'email-verify',
  'password-reset',
  'email-change',
  'account-locked',
]);

/**
 * Billing / critical email types that are always sent regardless of user preferences.
 */
const CRITICAL_EMAIL_TYPES = new Set([
  'payment-failure',
  'subscription-suspended',
  'token-expired',
]);

// ── Preference column mapping ──────────────────────────────────────────────

/**
 * Maps pipeline-outcome email types to their corresponding column in the
 * `notification_preferences` table.
 */
const PREFERENCE_COLUMN_MAP: Record<string, string> = {
  'execution-success': 'notify_on_success',
  'execution-failure': 'notify_on_failure',
  'pipeline-paused': 'notify_on_pipeline_paused',
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Determines whether an email of the given type should be sent to the given user.
 *
 * Rules (in priority order):
 * 1. Auth-related types (`email-verify`, `password-reset`, `email-change`,
 *    `account-locked`) → always `true`.
 * 2. Billing/critical types (`payment-failure`, `subscription-suspended`,
 *    `token-expired`) → always `true`.
 * 3. Pipeline-outcome types (`execution-success`, `execution-failure`,
 *    `pipeline-paused`) → query `notification_preferences` for the user;
 *    check the corresponding boolean column.
 *    - If no preference row exists: default to `true` (send).
 *    - If a DB error occurs: fail open and return `true` to avoid silently
 *      dropping important emails.
 * 4. Unknown types → return `true` (fail open; the email layer will reject
 *    unknown template types separately).
 *
 * Requirements: 14.5
 */
export async function shouldSendEmail(type: string, userId: string): Promise<boolean> {
  // Rule 1: Auth emails are always sent.
  if (AUTH_EMAIL_TYPES.has(type)) {
    return true;
  }

  // Rule 2: Billing/critical emails are always sent.
  if (CRITICAL_EMAIL_TYPES.has(type)) {
    return true;
  }

  // Rule 3: Pipeline-outcome types — consult notification preferences.
  const preferenceColumn = PREFERENCE_COLUMN_MAP[type];
  if (preferenceColumn) {
    try {
      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('notification_preferences')
        .select(preferenceColumn)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // Fail open: a DB error should not silently drop emails.
        console.error(
          `[notificationPreferences] DB error querying preferences for user ${userId}:`,
          error.message,
        );
        return true;
      }

      // No preference row found — default to sending.
      if (data === null) {
        return true;
      }

      // Row found — honour the stored preference (default true if column is null).
      const preference = (data as unknown as Record<string, unknown>)[preferenceColumn];
      return preference !== false;
    } catch (err) {
      // Fail open on unexpected errors.
      console.error(
        `[notificationPreferences] Unexpected error for user ${userId}:`,
        err,
      );
      return true;
    }
  }

  // Rule 4: Unknown email type — fail open.
  return true;
}
