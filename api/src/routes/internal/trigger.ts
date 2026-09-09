import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { getDecryptedSecret } from '../../lib/vault.js';
import { triggerN8nWorkflow } from '../../lib/n8n.js';

/** Request body shape for POST /internal/trigger-pipeline. */
interface TriggerPipelineBody {
  pipeline_id: string;
}

/** Shape of a credentials row (with vault metadata). */
interface CredentialRow {
  credential_type: string;
  vault_secret_id: string;
  status: string;
}

/**
 * POST /internal/trigger-pipeline
 *
 * Called by n8n's Schedule Trigger to start a pipeline execution. The route:
 *   1. Validates the pipeline exists and has `status = 'active'`.
 *   2. Validates the pipeline owner has an active subscription.
 *   3. Fetches all user credentials from Vault using short-lived service access.
 *   4. Enqueues the workflow execution in n8n with the decrypted credentials.
 *
 * Credentials are passed in-memory to n8n and are NEVER written to n8n's DB.
 * Service-token protected (no user JWT).
 *
 * Requirements: 3.7, 12.8, 18.5
 */
export async function triggerPipelineRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TriggerPipelineBody }>(
    '/trigger-pipeline',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pipeline_id'],
          additionalProperties: false,
          properties: {
            pipeline_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { pipeline_id } = request.body;
      const supabase = createSupabaseAdminClient();

      // ── Step 1: Fetch pipeline and validate it is active ────────────────

      const { data: pipeline, error: pipelineError } = await supabase
        .from('pipelines')
        .select(
          'id, user_id, status, n8n_workflow_id, name, niche_keyword, publishing_platforms, schedule_cron_utc, ' +
          'heygen_mode, heygen_engine, heygen_avatar_id, heygen_voice_id, heygen_resolution, heygen_aspect_ratio, ' +
          'heygen_motion_prompt, heygen_agent_prompt, heygen_orientation, ' +
          'video_language, script_tone, openai_model, target_duration_secs, gdrive_folder_id',
        )
        .eq('id', pipeline_id)
        .maybeSingle();

      if (pipelineError) {
        request.log.error(
          { pipeline_id, err: pipelineError.message },
          '[internal/trigger-pipeline] Failed to fetch pipeline',
        );
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      const p = pipeline as unknown as Record<string, unknown>;
      const userId = p['user_id'] as string;
      const pipelineStatus = p['status'] as string;

      // Guard: pipeline must be active (not paused or disabled)
      if (pipelineStatus !== 'active') {
        request.log.info(
          { pipeline_id, status: pipelineStatus },
          '[internal/trigger-pipeline] Pipeline is not active — skipping trigger',
        );
        return reply.status(200).send({
          message: `Pipeline is ${pipelineStatus} — execution skipped`,
          skipped: true,
        });
      }

      // ── Step 2: Validate subscription is active ─────────────────────────

      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('subscription_status')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        request.log.error(
          { userId, err: profileError.message },
          '[internal/trigger-pipeline] Failed to fetch user profile',
        );
        throw AppError.internal('Failed to validate subscription');
      }

      const subscriptionStatus =
        (userProfile as Record<string, unknown> | null)?.['subscription_status'] as string ?? 'inactive';

      if (subscriptionStatus !== 'active') {
        request.log.info(
          { pipeline_id, userId, subscriptionStatus },
          '[internal/trigger-pipeline] Subscription not active — skipping trigger',
        );
        return reply.status(200).send({
          message: 'Subscription is not active — execution skipped',
          skipped: true,
        });
      }

      // ── Step 3: Fetch credentials from Vault ────────────────────────────

      const { data: credentialRows, error: credError } = await supabase
        .from('credentials')
        .select('credential_type, vault_secret_id, status')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (credError) {
        request.log.error(
          { userId, err: credError.message },
          '[internal/trigger-pipeline] Failed to fetch credential metadata',
        );
        throw AppError.internal('Failed to retrieve credentials');
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
              request.log.warn(
                { userId, credential_type: row.credential_type, err },
                '[internal/trigger-pipeline] Failed to decrypt credential — skipping',
              );
            }
          }),
        );
      }

      // ── Step 4: Enqueue n8n workflow execution ──────────────────────────

      const workflowId = (p['n8n_workflow_id'] as string | null) ?? pipeline_id;
      const pipelineConfig: Record<string, unknown> = {
        pipeline_id,
        user_id: userId,
        pipeline_name: p['name'],
        niche_keyword: p['niche_keyword'],
        publishing_platforms: p['publishing_platforms'],
        schedule_cron_utc: p['schedule_cron_utc'],
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

      let executionId: string;
      try {
        const result = await triggerN8nWorkflow(workflowId, credentials, pipelineConfig);
        executionId = result.executionId;
      } catch (err) {
        request.log.error(
          { pipeline_id, workflowId, err },
          '[internal/trigger-pipeline] Failed to enqueue n8n workflow',
        );
        throw AppError.internal('Failed to enqueue pipeline execution');
      }

      request.log.info(
        { pipeline_id, executionId },
        '[internal/trigger-pipeline] Pipeline execution enqueued',
      );

      return reply.status(200).send({ message: 'Pipeline execution enqueued', executionId });
    },
  );
}
