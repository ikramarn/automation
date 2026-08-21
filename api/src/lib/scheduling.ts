/**
 * Scheduling helpers for the pipeline execution scheduler.
 *
 * These utilities support the scheduler-side pipeline trigger flow,
 * including skip logic when a pipeline is already running.
 *
 * Requirements: 12.4
 */

import { createSupabaseAdminClient } from './supabase.js';

/**
 * Records a skipped execution in `execution_logs` when the scheduler fires
 * a trigger for a pipeline that is already running.
 *
 * A skipped execution:
 *  - Has status = 'skipped'
 *  - Has failure_reason = 'skipped: already running'
 *  - Has both started_at and ended_at set to now (instant record)
 *  - Does NOT touch the pipelines table — consecutive_failures is NOT modified
 *
 * Requirements: 12.4
 */
export async function recordSkippedExecution(pipelineId: string, userId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const now = new Date().toISOString();

  const { error } = await supabase.from('execution_logs').insert({
    pipeline_id: pipelineId,
    user_id: userId,
    status: 'skipped',
    failure_reason: 'skipped: already running',
    started_at: now,
    ended_at: now,
  });

  if (error) {
    throw new Error(`Failed to record skipped execution: ${error.message}`);
  }
}
