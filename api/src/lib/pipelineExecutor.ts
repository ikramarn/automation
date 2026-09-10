/**
 * Shared pipeline execution logic.
 *
 * This is the single implementation of "start a pipeline run" used by both:
 *   - POST /internal/trigger-pipeline (HTTP entrypoint, e.g. for external
 *     callers or manual debugging)
 *   - The in-process scheduler (lib/scheduler.ts), which calls this function
 *     directly — no HTTP round-trip needed since it runs in the same process.
 *
 * Extracting this avoids duplicating the pipeline/subscription/credential
 * lookup logic in two places and keeps a single source of truth for what
 * "triggering a pipeline" means.
 *
 * Requirements: 3.7, 12.8, 18.5
 */
import { createSupabaseAdminClient } from './supabase.js';
import { getDecryptedSecret } from './vault.js';
import { triggerN8nWorkflow } from './n8n.js';

/**
 * Minimal logger shape accepted by `executePipeline` — compatible with both
 * Fastify's request-scoped logger (`request.log`, a `FastifyBaseLogger`) and
 * the app-level logger (`app.log`) used by the scheduler outside a request
 * context. Using a narrow structural type instead of importing pino's
 * `Logger` avoids a type mismatch between pino's and Fastify's logger
 * interfaces while still giving callers real type-checking.
 */
export interface ExecutePipelineLogger {
  info?: (objOrMsg: unknown, msg?: string, ...args: unknown[]) => void;
  warn?: (objOrMsg: unknown, msg?: string, ...args: unknown[]) => void;
  error?: (objOrMsg: unknown, msg?: string, ...args: unknown[]) => void;
}

/** Shape of a credentials row (with vault metadata). */
interface CredentialRow {
  credential_type: string;
  vault_secret_id: string;
  status: string;
}

/** Result of attempting to execute a pipeline. */
export type ExecutePipelineResult =
  | { outcome: 'not_found' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'triggered'; executionId: string }
  | { outcome: 'error'; error: unknown };

/**
 * Executes the full pipeline trigger flow:
 *   1. Fetch the pipeline and validate `status = 'active'`.
 *   2. Validate the owner has an active subscription.
 *   3. Fetch and decrypt all active credentials from Vault.
 *   4. Call the n8n webhook to start the automation workflow.
 *
 * Credentials are decrypted in-memory only and passed directly to n8n —
 * never logged, never persisted outside the existing Vault storage.
 *
 * @param pipelineId - UUID of the pipeline to execute
 * @param log        - Optional pino logger for structured log output
 *                      (falls back to console if not provided, e.g. when
 *                      called from the scheduler outside a request context)
 */
export async function executePipeline(
  pipelineId: string,
  log?: ExecutePipelineLogger,
): Promise<ExecutePipelineResult> {
  const logger = log ?? console;
  const supabase = createSupabaseAdminClient();

  // ── Step 1: Fetch pipeline and validate it is active ────────────────────

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .select(
      'id, user_id, status, n8n_workflow_id, name, niche_keyword, publishing_platforms, schedule_cron_utc, ' +
      'content_source, heygen_custom_script, ' +
      'heygen_mode, heygen_engine, heygen_avatar_id, heygen_voice_id, heygen_resolution, heygen_aspect_ratio, ' +
      'heygen_motion_prompt, heygen_agent_prompt, heygen_orientation, ' +
      'video_language, script_tone, openai_model, target_duration_secs, gdrive_folder_id',
    )
    .eq('id', pipelineId)
    .maybeSingle();

  if (pipelineError) {
    logger.error?.(
      { pipelineId, err: pipelineError.message },
      '[executePipeline] Failed to fetch pipeline',
    );
    return { outcome: 'error', error: pipelineError };
  }

  if (!pipeline) {
    return { outcome: 'not_found' };
  }

  const p = pipeline as unknown as Record<string, unknown>;
  const userId = p['user_id'] as string;
  const pipelineStatus = p['status'] as string;

  // Guard: pipeline must be active (not paused, disabled, or deleting)
  if (pipelineStatus !== 'active') {
    logger.info?.(
      { pipelineId, status: pipelineStatus },
      '[executePipeline] Pipeline is not active — skipping trigger',
    );
    return { outcome: 'skipped', reason: `Pipeline is ${pipelineStatus} — execution skipped` };
  }

  // Guard: skip if an execution is already running for this pipeline (Req 12.4).
  // This is NOT counted as a failure toward the consecutive-failure threshold.
  const { data: runningExec, error: runningExecError } = await supabase
    .from('execution_logs')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('status', 'running')
    .limit(1)
    .maybeSingle();

  if (runningExecError) {
    logger.warn?.(
      { pipelineId, err: runningExecError.message },
      '[executePipeline] Failed to check running executions — proceeding anyway',
    );
  }

  if (runningExec) {
    const now = new Date().toISOString();
    await supabase.from('execution_logs').insert({
      pipeline_id: pipelineId,
      user_id: userId,
      status: 'skipped',
      failure_reason: 'skipped: already running',
      started_at: now,
      ended_at: now,
    });
    logger.info?.(
      { pipelineId },
      '[executePipeline] Skipped — execution already running',
    );
    return { outcome: 'skipped', reason: 'skipped: already running' };
  }

  // ── Step 2: Validate subscription is active ─────────────────────────────

  const { data: userProfile, error: profileError } = await supabase
    .from('user_profiles')
    .select('subscription_status')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    logger.error?.(
      { userId, err: profileError.message },
      '[executePipeline] Failed to fetch user profile',
    );
    return { outcome: 'error', error: profileError };
  }

  const subscriptionStatus =
    (userProfile as Record<string, unknown> | null)?.['subscription_status'] as string ?? 'inactive';

  if (subscriptionStatus !== 'active') {
    logger.info?.(
      { pipelineId, userId, subscriptionStatus },
      '[executePipeline] Subscription not active — skipping trigger',
    );
    return { outcome: 'skipped', reason: 'Subscription is not active — execution skipped' };
  }

  // ── Step 3: Fetch credentials from Vault ─────────────────────────────────

  const { data: credentialRows, error: credError } = await supabase
    .from('credentials')
    .select('credential_type, vault_secret_id, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (credError) {
    logger.error?.(
      { userId, err: credError.message },
      '[executePipeline] Failed to fetch credential metadata',
    );
    return { outcome: 'error', error: credError };
  }

  // Decrypt all active credentials in parallel (short-lived, in-memory only)
  const credentials: Record<string, string> = {};

  if (credentialRows && credentialRows.length > 0) {
    await Promise.all(
      (credentialRows as CredentialRow[]).map(async (row) => {
        try {
          const decrypted = await getDecryptedSecret(row.vault_secret_id);
          if (decrypted) {
            credentials[row.credential_type] = decrypted;
          }
        } catch (err) {
          // Log but continue — partial credential sets are handled by n8n
          logger.warn?.(
            { userId, credential_type: row.credential_type, err },
            '[executePipeline] Failed to decrypt credential — skipping',
          );
        }
      }),
    );
  }

  // ── Step 4: Create the execution_logs row up front ───────────────────────
  //
  // The n8n workflow needs an execution_id to attach step results to via
  // POST /internal/execution-log/update at the end of the run. Rather than
  // have n8n call back to create this row (the workflow's Initialize_Log
  // node attempts this but there is no matching API endpoint to receive it),
  // the API creates the row itself before triggering n8n and passes the
  // generated id through — a single source of truth, created exactly once,
  // guaranteed to exist before n8n ever runs.
  const { data: execLog, error: execLogError } = await supabase
    .from('execution_logs')
    .insert({
      pipeline_id: pipelineId,
      user_id: userId,
      status: 'running',
    })
    .select('id')
    .single();

  if (execLogError || !execLog) {
    logger.error?.(
      { pipelineId, err: execLogError?.message },
      '[executePipeline] Failed to create execution_logs row',
    );
    return { outcome: 'error', error: execLogError };
  }

  const executionId = (execLog as { id: string }).id;

  // ── Step 5: Trigger the n8n automation workflow ─────────────────────────

  const workflowId = (p['n8n_workflow_id'] as string | null) ?? pipelineId;
  const pipelineConfig: Record<string, unknown> = {
    pipeline_id: pipelineId,
    user_id: userId,
    execution_id: executionId,
    pipeline_name: p['name'],
    niche_keyword: p['niche_keyword'],
    publishing_platforms: p['publishing_platforms'],
    schedule_cron_utc: p['schedule_cron_utc'],
    // Content source config
    content_source:        p['content_source']        ?? 'openai',
    heygen_custom_script:  p['heygen_custom_script']  ?? null,
    // HeyGen generation config
    heygen_mode:          p['heygen_mode']          ?? 'classic',
    heygen_engine:        p['heygen_engine']         ?? 'avatar_iv',
    heygen_avatar_id:     p['heygen_avatar_id']      ?? null,
    heygen_voice_id:      p['heygen_voice_id']       ?? null,
    heygen_resolution:    p['heygen_resolution']     ?? '1080p',
    heygen_aspect_ratio:  p['heygen_aspect_ratio']   ?? '9:16',
    heygen_motion_prompt: p['heygen_motion_prompt']  ?? null,
    heygen_agent_prompt:  p['heygen_agent_prompt']   ?? null,
    heygen_orientation:   p['heygen_orientation']    ?? 'portrait',
    // Content / script config
    video_language:        p['video_language']        ?? 'English',
    script_tone:           p['script_tone']           ?? 'professional',
    openai_model:          p['openai_model']          ?? 'gpt-4o-mini',
    target_duration_secs:  p['target_duration_secs'] ?? 60,
    gdrive_folder_id:      p['gdrive_folder_id']     ?? null,
    triggered_by: 'scheduler',
  };

  try {
    await triggerN8nWorkflow(workflowId, credentials, pipelineConfig);
    logger.info?.(
      { pipelineId, executionId },
      '[executePipeline] Pipeline execution triggered',
    );
    return { outcome: 'triggered', executionId };
  } catch (err) {
    // The execution_logs row already exists (status: 'running') — mark it
    // failed rather than leaving it stuck in 'running' forever, since n8n
    // was never successfully called and will never send an update.
    try {
      await supabase
        .from('execution_logs')
        .update({
          status: 'failed',
          ended_at: new Date().toISOString(),
          failure_reason: `Failed to trigger n8n workflow: ${err instanceof Error ? err.message : String(err)}`,
        })
        .eq('id', executionId);
    } catch {
      // Best-effort — if this also fails, the row stays 'running' and
      // will show up as a stale/stuck execution for manual investigation.
    }

    logger.error?.(
      { pipelineId, workflowId, executionId, err },
      '[executePipeline] Failed to trigger n8n workflow',
    );
    return { outcome: 'error', error: err };
  }
}
