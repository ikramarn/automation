import { createSupabaseAdminClient } from './supabase.js';
import { sendTransactionalEmail } from './email.js';

/** Duration (ms) of the failed-attempt tracking window: 15 minutes */
const WINDOW_MS = 15 * 60 * 1000;

/** Number of failures within the window that trigger a lockout */
const LOCKOUT_THRESHOLD = 3;

/**
 * Inserts a record into `login_attempts` for the given email.
 *
 * Req 1.5: Track failed (and successful) login attempts for lockout logic.
 */
export async function recordLoginAttempt(email: string, success: boolean): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from('login_attempts').insert({
    email,
    success,
    attempted_at: new Date().toISOString(),
  });

  if (error) {
    // Log but do not throw — login attempt recording is non-fatal.
    console.error('[loginAttempts] Failed to record login attempt:', error.message);
  }
}

/**
 * Checks whether the account for the given email is currently locked.
 *
 * Returns `{ locked: true, lockedUntil: Date }` when 3+ failed attempts exist
 * within the last 15 minutes. The lock expiry is `mostRecentFailure + 15 min`.
 *
 * Req 1.5: Lock account for 15 minutes after 3 consecutive failures within a
 *          15-minute window.
 */
export async function checkAccountLocked(
  email: string,
): Promise<{ locked: boolean; lockedUntil?: Date }> {
  const supabase = createSupabaseAdminClient();

  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('login_attempts')
    .select('attempted_at')
    .eq('email', email)
    .eq('success', false)
    .gte('attempted_at', windowStart)
    .order('attempted_at', { ascending: false });

  if (error) {
    // On query error, fail open (do not lock) to avoid blocking legitimate logins.
    console.error('[loginAttempts] Failed to query login attempts:', error.message);
    return { locked: false };
  }

  const attempts = data ?? [];

  if (attempts.length >= LOCKOUT_THRESHOLD) {
    // The lock expiry is based on the most recent failed attempt (first row,
    // since we ordered descending).
    const mostRecentAttempt = new Date(attempts[0]!.attempted_at as string);
    const lockedUntil = new Date(mostRecentAttempt.getTime() + WINDOW_MS);
    return { locked: true, lockedUntil };
  }

  return { locked: false };
}

/**
 * Sends an account-locked notification email to the affected user.
 *
 * Uses the transactional email dispatch module (task 14). Errors are
 * swallowed inside `sendTransactionalEmail` — this function will never throw.
 *
 * Req 1.5: Notify the user via email when their account is locked.
 */
export async function sendAccountLockedEmail(email: string, unlockTime: Date): Promise<void> {
  console.log(
    `[loginAttempts] Sending account-locked notification — email: ${email}, unlockTime: ${unlockTime.toISOString()}`,
  );

  await sendTransactionalEmail('account-locked', email, {
    unlock_time: unlockTime.toUTCString(),
  });
}
