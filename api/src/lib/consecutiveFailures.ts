import { createSupabaseAdminClient } from './supabase.js';
import { sendTransactionalEmail } from './email.js';

/** Default number of consecutive failures before a pipeline is auto-paused. */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/** Return value from recordExecutionOutcome. */
export interface ExecutionOutcomeResult {
  /** Whether the pipeline was just transitioned to paused state. */
  paused: boolean;
  /** Current value of consecutive_failures after this update. */
  consecutiveFailures: number;
}

/**
 * Records the outcome of a pipeline execution and manages the consecutive
 * failure counter and auto-pause logic.
 *
 * Behaviour:
 *  - Success: resets `consecutive_failures` to 0.
 *  - Failure: increments `consecutive_failures` by 1.
 *    If the new count reaches `max_consecutive_failures`, the pipeline status
 *    is set to 'paused' and a pipeline-paused notification is sent.
 *
 * The function reads the current pipeline row to obtain the current counter
 * value and `max_consecutive_failures`, then writes the updated values back.
 * Both the read and write use the Supabase admin client, which bypasses RLS.
 *
 * Requirements: 12.7, 12.8, 12.9
 *
 * @param pipelineId    - UUID of the pipeline being updated.
 * @param success       - Whether the execution succeeded.
 * @param failureReason - Human-readable reason for the failure (failure case only).
 * @returns             - Object describing whether the pipeline was paused and the new counter value.
 */
export async function recordExecutionOutcome(
  pipelineId: string,
  success: boolean,
  failureReason?: string,
): Promise<ExecutionOutcomeResult> {
  const supabase = createSupabaseAdminClient();

  // ── Fetch current pipeline state ─────────────────────────────────────────
  const { data: pipeline, error: fetchError } = await supabase
    .from('pipelines')
    .select('consecutive_failures, max_consecutive_failures, name, user_id')
    .eq('id', pipelineId)
    .maybeSingle();

  if (fetchError || !pipeline) {
    console.error(
      '[consecutiveFailures] Failed to fetch pipeline:',
      fetchError?.message ?? 'not found',
    );
    // Return a safe default — caller should treat this as a non-fatal logging failure.
    return { paused: false, consecutiveFailures: 0 };
  }

  const p = pipeline as {
    consecutive_failures: number;
    max_consecutive_failures: number | null;
    name: string;
    user_id: string;
  };

  const currentFailures: number = p.consecutive_failures ?? 0;
  const maxFailures: number = p.max_consecutive_failures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  // ── Success path: reset counter ───────────────────────────────────────────
  if (success) {
    const { error: updateError } = await supabase
      .from('pipelines')
      .update({ consecutive_failures: 0 })
      .eq('id', pipelineId);

    if (updateError) {
      console.error(
        '[consecutiveFailures] Failed to reset consecutive_failures:',
        updateError.message,
      );
    }

    return { paused: false, consecutiveFailures: 0 };
  }

  // ── Failure path: increment counter ──────────────────────────────────────
  const newFailures = currentFailures + 1;
  const shouldPause = newFailures >= maxFailures;

  const updatePayload: Record<string, unknown> = {
    consecutive_failures: newFailures,
  };

  if (shouldPause) {
    updatePayload['status'] = 'paused';
    updatePayload['auto_paused_due_to_failures'] = true;
  }

  const { error: updateError } = await supabase
    .from('pipelines')
    .update(updatePayload)
    .eq('id', pipelineId);

  if (updateError) {
    console.error(
      '[consecutiveFailures] Failed to update consecutive_failures:',
      updateError.message,
    );
    return { paused: false, consecutiveFailures: newFailures };
  }

  // ── Notify on auto-pause (Req 12.8) ──────────────────────────────────────
  if (shouldPause) {
    await notifyPipelinePaused(pipelineId, p.name, p.user_id, newFailures, failureReason);
  }

  return { paused: shouldPause, consecutiveFailures: newFailures };
}

/**
 * Sends a pipeline-paused notification email to the pipeline owner.
 *
 * The email is dispatched via the transactional email module which handles
 * missing API keys and template errors gracefully (never throws).
 *
 * Req 12.8: Notify user via email when pipeline is auto-paused.
 */
async function notifyPipelinePaused(
  pipelineId: string,
  pipelineName: string,
  userId: string,
  consecutiveFailures: number,
  lastFailureReason?: string,
): Promise<void> {
  const supabase = createSupabaseAdminClient();

  // Retrieve user email for notification
  const { data: userRecord, error: userError } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !userRecord) {
    console.warn(
      '[consecutiveFailures] Could not fetch user email for pipeline-paused notification:',
      userError?.message ?? 'not found',
    );
    return;
  }

  const userProfile = userRecord as { email: string };

  console.log(
    `[consecutiveFailures] Sending pipeline-paused notification — pipelineId: ${pipelineId}, failures: ${consecutiveFailures}`,
  );

  await sendTransactionalEmail('pipeline-paused', userProfile.email, {
    pipeline_name: pipelineName,
    timestamp: new Date().toUTCString(),
    consecutive_failures: String(consecutiveFailures),
    last_failure_reason: lastFailureReason ?? 'Unknown',
  });
}

/**
 * Resets the consecutive failure counter for a pipeline to zero.
 *
 * This is called when a user re-enables a paused pipeline (Req 12.9)
 * so that the pipeline starts fresh on its next execution cycle.
 *
 * Requirements: 12.9
 *
 * @param pipelineId - UUID of the pipeline to reset.
 */
export async function resetConsecutiveFailures(pipelineId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('pipelines')
    .update({ consecutive_failures: 0 })
    .eq('id', pipelineId);

  if (error) {
    console.error(
      '[consecutiveFailures] Failed to reset consecutive_failures on re-enable:',
      error.message,
    );
  }
}
