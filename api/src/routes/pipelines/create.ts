import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { computeUtcCron } from '../../lib/cronUtils.js';
import { createN8nWorkflow } from '../../lib/n8n.js';

/** Request body for POST /pipelines */
interface CreatePipelineBody {
  name: string;
  niche_keyword: string;
  publishing_platforms: string[];
  schedule_recurrence: 'daily' | 'weekdays' | 'custom';
  schedule_time_hhmm: string;
  schedule_timezone: string;
  schedule_days_of_week?: number[];
  // Optional configuration fields
  openai_model?: string;
  heygen_avatar_id?: string;
  video_language?: string;
  script_tone?: string;
  target_duration_secs?: number;
  gdrive_folder_id?: string;
}

/**
 * POST /pipelines — Create a new pipeline.
 *
 * Logic:
 *  1. Check pipeline limit from user_profiles.pipeline_limit
 *  2. Check HeyGen API key present in credentials table
 *  3. Compute UTC cron expression
 *  4. Insert pipeline record
 *  5. Create n8n workflow and update pipeline record
 *  6. Return 201 with created pipeline
 *
 * Requirements: 6.1, 6.2, 6.3, 6.6
 */
export async function createPipelineRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: [
            'name',
            'niche_keyword',
            'publishing_platforms',
            'schedule_recurrence',
            'schedule_time_hhmm',
            'schedule_timezone',
          ],
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
            },
            niche_keyword: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
            },
            publishing_platforms: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            schedule_recurrence: {
              type: 'string',
              enum: ['daily', 'weekdays', 'custom'],
            },
            schedule_time_hhmm: {
              type: 'string',
              pattern: '^\\d{2}:\\d{2}$',
            },
            schedule_timezone: {
              type: 'string',
              minLength: 1,
            },
            schedule_days_of_week: {
              type: 'array',
              items: { type: 'number' },
            },
            openai_model: { type: 'string' },
            heygen_avatar_id: { type: 'string' },
            video_language: { type: 'string' },
            script_tone: { type: 'string' },
            target_duration_secs: { type: 'number' },
            gdrive_folder_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const body = request.body as CreatePipelineBody;

      const supabase = createSupabaseAdminClient();

      // ── Step 1: Check pipeline limit (Req 6.1) ──────────────────────────
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('pipeline_limit')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        throw AppError.internal('Failed to retrieve user profile');
      }

      const pipelineLimit: number = (profile as { pipeline_limit: number }).pipeline_limit;

      // Count current pipelines for this user
      const { count: currentCount, error: countError } = await supabase
        .from('pipelines')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) {
        throw AppError.internal('Failed to check pipeline count');
      }

      if ((currentCount ?? 0) >= pipelineLimit) {
        throw new AppError(
          403,
          'pipeline_limit',
          'Pipeline limit reached. Upgrade your plan to create more pipelines.',
        );
      }

      // ── Step 2: Check HeyGen API key (Req 6.6) ──────────────────────────
      const { data: credential, error: credentialError } = await supabase
        .from('credentials')
        .select('id')
        .eq('user_id', userId)
        .eq('credential_type', 'heygen_api_key')
        .eq('status', 'active')
        .maybeSingle();

      if (credentialError) {
        throw AppError.internal('Failed to check credentials');
      }

      if (!credential) {
        throw AppError.badRequest(
          'HeyGen API key required. Add your key in Settings > Credentials.',
        );
      }

      // ── Step 3: Compute UTC cron expression (Req 12.1, 12.2) ────────────
      let cronExpression: string;
      try {
        cronExpression = computeUtcCron(
          body.schedule_time_hhmm,
          body.schedule_timezone,
          body.schedule_recurrence,
          body.schedule_days_of_week,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid schedule configuration';
        throw AppError.badRequest(message);
      }

      // ── Step 4: Insert pipeline record ───────────────────────────────────
      const { data: pipeline, error: insertError } = await supabase
        .from('pipelines')
        .insert({
          user_id: userId,
          name: body.name,
          niche_keyword: body.niche_keyword,
          publishing_platforms: body.publishing_platforms,
          schedule_recurrence: body.schedule_recurrence,
          schedule_time_hhmm: body.schedule_time_hhmm,
          schedule_timezone: body.schedule_timezone,
          schedule_days_of_week: body.schedule_days_of_week ?? null,
          schedule_cron_utc: cronExpression,
          openai_model: body.openai_model ?? null,
          heygen_avatar_id: body.heygen_avatar_id ?? null,
          video_language: body.video_language ?? null,
          script_tone: body.script_tone ?? null,
          target_duration_secs: body.target_duration_secs ?? null,
          gdrive_folder_id: body.gdrive_folder_id ?? null,
          status: 'active',
        })
        .select()
        .single();

      if (insertError || !pipeline) {
        throw AppError.internal('Failed to create pipeline');
      }

      const createdPipeline = pipeline as Record<string, unknown>;

      // ── Step 5: Create n8n workflow and update pipeline ──────────────────
      let n8nWorkflowId: string;
      try {
        n8nWorkflowId = await createN8nWorkflow(createdPipeline['id'] as string, cronExpression);
      } catch (err) {
        // Log but don't fail the request — pipeline is created, n8n can be linked later
        request.log.error({ err, pipelineId: createdPipeline['id'] }, 'Failed to create n8n workflow');
        n8nWorkflowId = `n8n-placeholder-${createdPipeline['id'] as string}`;
      }

      // Update the pipeline with the n8n workflow ID
      const { data: updatedPipeline, error: updateError } = await supabase
        .from('pipelines')
        .update({ n8n_workflow_id: n8nWorkflowId })
        .eq('id', createdPipeline['id'] as string)
        .select()
        .single();

      if (updateError || !updatedPipeline) {
        // Return the pipeline without the workflow ID rather than failing
        return reply.status(201).send(createdPipeline);
      }

      // ── Step 6: Return 201 with created pipeline ─────────────────────────
      return reply.status(201).send(updatedPipeline);
    },
  );
}
