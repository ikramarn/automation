import { createSupabaseAdminClient } from './supabase.js';
import { sendTransactionalEmail } from './email.js';

/**
 * Token expiry management for social platform connections and Google Drive.
 *
 * Social platform token expiry (Requirement 5.7):
 *   WHEN a social platform token expires and cannot be refreshed after
 *   3 consecutive failed refresh attempts over a period not exceeding 15 minutes,
 *   THE Platform SHALL mark the connection as "token_expired", pause any Pipelines
 *   targeting that platform, and send the User an email notification within 15 minutes.
 *
 * Google Drive token expiry (Requirement 4.5):
 *   IF the Google OAuth refresh token is revoked, expired, OR the token refresh
 *   request fails with a non-retryable error, THEN THE Pipeline_Engine SHALL abort
 *   the upload step and record the failure in the Execution_Log with the reason
 *   "Google Drive authorization expired".
 *
 * Requirements: 4.3, 4.5, 5.7
 */

/** Duration (ms) of the failure tracking window: 15 minutes */
const WINDOW_MS = 15 * 60 * 1000;

/** Number of consecutive refresh failures that trigger token expiry */
const FAILURE_THRESHOLD = 3;

/** Settings link passed to token-expired email template */
const SETTINGS_LINK = '/settings/connections';

// ── Social platform token expiry ─────────────────────────────────────────────

/**
 * Records a token refresh failure for a social platform connection.
 *
 * Increments the failure counter for the given (userId, platform) pair by
 * upserting a row into `token_refresh_failures`. After the upsert it queries
 * for the count of failures within the last 15 minutes.
 *
 * When the failure count reaches FAILURE_THRESHOLD (3):
 *  1. Updates `credentials.status` to `'token_expired'` for all credential
 *     types belonging to the platform.
 *  2. Pauses all active/running pipelines that target the platform.
 *  3. Sends a `token-expired` transactional email to the user.
 *
 * Returns `{ expired: true }` when the threshold is met, otherwise
 * `{ expired: false }`.
 *
 * Requirements: 5.7
 */
export async function recordTokenRefreshFailure(
  userId: string,
  platform: string,
): Promise<{ expired: boolean }> {
  const supabase = createSupabaseAdminClient();

  // Insert a failure record
  const { error: insertError } = await supabase.from('token_refresh_failures').insert({
    user_id: userId,
    platform,
    failed_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error(
      `[tokenExpiry] Failed to insert token refresh failure for user=${userId} platform=${platform}:`,
      insertError.message,
    );
    // Non-fatal: continue to check existing count
  }

  // Count failures within the 15-minute window
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: failures, error: countError } = await supabase
    .from('token_refresh_failures')
    .select('failed_at')
    .eq('user_id', userId)
    .eq('platform', platform)
    .gte('failed_at', windowStart);

  if (countError) {
    console.error(
      `[tokenExpiry] Failed to count token refresh failures for user=${userId} platform=${platform}:`,
      countError.message,
    );
    return { expired: false };
  }

  const failureCount = (failures ?? []).length;

  if (failureCount < FAILURE_THRESHOLD) {
    return { expired: false };
  }

  // Threshold met — mark connection as token_expired, pause pipelines, send email
  console.log(
    `[tokenExpiry] Threshold met (${failureCount} failures) for user=${userId} platform=${platform} — marking token_expired`,
  );

  // Determine credential types for this platform
  const credentialTypes = getPlatformCredentialTypes(platform);

  // 1. Update credentials.status to 'token_expired' for all platform tokens
  if (credentialTypes.length > 0) {
    const { error: credUpdateError } = await supabase
      .from('credentials')
      .update({ status: 'token_expired', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('credential_type', credentialTypes);

    if (credUpdateError) {
      console.error(
        `[tokenExpiry] Failed to update credential status for user=${userId} platform=${platform}:`,
        credUpdateError.message,
      );
    }
  }

  // 2. Pause all active/running pipelines targeting this platform
  const { error: pauseError } = await supabase
    .from('pipelines')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .contains('publishing_platforms', [platform])
    .in('status', ['active', 'running']);

  if (pauseError) {
    console.error(
      `[tokenExpiry] Failed to pause pipelines for user=${userId} platform=${platform}:`,
      pauseError.message,
    );
  }

  // 3. Send token-expired notification email to the user
  const userEmail = await getUserEmail(userId);
  if (userEmail) {
    const platformDisplayName = capitalize(platform);
    await sendTransactionalEmail('token-expired', userEmail, {
      platform_name: platformDisplayName,
      settings_link: SETTINGS_LINK,
    });
  }

  return { expired: true };
}

/**
 * Resets the token refresh failure counter for a social platform connection.
 *
 * Should be called after a successful token refresh to clear accumulated
 * failures, preventing a stale counter from triggering expiry on the next
 * failure cycle.
 *
 * Requirements: 5.7
 */
export async function resetTokenRefreshFailures(
  userId: string,
  platform: string,
): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('token_refresh_failures')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform);

  if (error) {
    console.error(
      `[tokenExpiry] Failed to reset token refresh failures for user=${userId} platform=${platform}:`,
      error.message,
    );
    // Non-fatal — a stale counter is acceptable; next expiry check uses time window
  }
}

// ── Google Drive token validation ─────────────────────────────────────────────

/**
 * Determines whether a Google Drive token refresh error is non-retryable.
 *
 * Non-retryable errors include:
 *  - Token revocation (invalid_grant)
 *  - Refresh token expired
 *  - Insufficient permissions / access denied
 *
 * Retryable errors include network failures and transient server errors.
 *
 * Requirements: 4.5
 */
export function isNonRetryableTokenError(error: { message?: string; code?: string | number }): boolean {
  const message = (error.message ?? '').toLowerCase();
  const code = String(error.code ?? '');

  // Google OAuth error codes that indicate permanent token failure
  const nonRetryablePatterns = [
    'invalid_grant',
    'token has been expired or revoked',
    'token expired',
    'access_denied',
    'unauthorized_client',
    'invalid_client',
    '401',
    '403',
  ];

  return nonRetryablePatterns.some(
    (pattern) => message.includes(pattern) || code.includes(pattern),
  );
}

/**
 * Returns the execution log failure reason for a non-retryable Google Drive
 * token failure, as required by Req 4.5.
 *
 * Requirements: 4.5
 */
export const GOOGLE_DRIVE_AUTH_EXPIRED_REASON = 'Google Drive authorization expired';

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Returns all credential_type values stored in the `credentials` table for
 * the given social platform.
 */
function getPlatformCredentialTypes(platform: string): string[] {
  const credentialMap: Record<string, string[]> = {
    youtube: ['youtube_access_token', 'youtube_refresh_token'],
    tiktok: ['tiktok_access_token', 'tiktok_refresh_token'],
    facebook: ['facebook_access_token'],
    instagram: ['instagram_access_token'],
  };
  return credentialMap[platform] ?? [];
}

/**
 * Fetches the email address for the given user ID from Supabase Auth.
 * Returns null if the lookup fails (email sending is best-effort).
 */
async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) {
      console.error(`[tokenExpiry] Failed to fetch email for user=${userId}:`, error?.message);
      return null;
    }
    return data.user.email;
  } catch (err) {
    console.error(`[tokenExpiry] Unexpected error fetching email for user=${userId}:`, err);
    return null;
  }
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
