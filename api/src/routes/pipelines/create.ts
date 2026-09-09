import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { computeUtcCron } from '../../lib/cronUtils.js';

/** Request body for POST /pipelines */
interface CreatePipelineBody {
  name: string;
  niche_keyword: string;
  publishing_platforms: string[];
  schedule_recurrence: 'daily' | 'weekdays' | 'custom';
  schedule_time_hhmm: string;
  schedule_timezone: string;
  schedule_days_of_week?: number[];
  // Content source — the primary discriminator
  content_source?: string; // 'openai' | 'agent' | 'custom_script' | 'drive'
  heygen_custom_script?: string;
  // AI / content config
  openai_model?: string;
  heygen_avatar_id?: string;
  heygen_engine?: string;
  heygen_mode?: string;
  heygen_voice_id?: string;
  heygen_resolution?: string;
  heygen_aspect_ratio?: string;
  heygen_motion_prompt?: string;
  heygen_agent_prompt?: string;
  heygen_orientation?: string;
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
 *  5. Return 201 with created pipeline
 *
 * Scheduling is owned entirely by the API's in-process scheduler
 * (lib/scheduler.ts), which reads `schedule_cron_utc` directly — there is no
 * per-pipeline n8n workflow to create or activate.
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
            content_source: {
              type: 'string',
              enum: ['openai', 'agent', 'custom_script', 'drive'],
            },
            heygen_custom_script: { type: 'string', maxLength: 5000 },
            openai_model: { type: 'string' },
            heygen_avatar_id: { type: 'string' },
            heygen_engine: {
              type: 'string',
              enum: ['avatar_v', 'avatar_iv', 'avatar_iii'],
            },
            heygen_mode: {
              type: 'string',
              enum: ['classic', 'agent'],
            },
            heygen_voice_id: { type: 'string' },
            heygen_resolution: {
              type: 'string',
              enum: ['1080p', '720p', '4k'],
            },
            heygen_aspect_ratio: {
              type: 'string',
              enum: ['9:16', '16:9', '1:1', '4:5'],
            },
            heygen_motion_prompt: { type: 'string' },
            heygen_agent_prompt: { type: 'string' },
            heygen_orientation: {
              type: 'string',
              enum: ['portrait', 'landscape'],
            },
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
      // Not required for drive-only pipelines
      const contentSource = body.content_source ?? 'openai';
      if (contentSource !== 'drive') {
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
            'HeyGen API key required. Add your key in Settings → Credentials before creating a pipeline.',
          );
        }
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
          content_source: body.content_source ?? 'openai',
          heygen_custom_script: body.heygen_custom_script ?? null,
          openai_model: body.openai_model ?? null,
          heygen_avatar_id: body.heygen_avatar_id ?? null,
          heygen_engine: body.heygen_engine ?? 'avatar_iv',
          heygen_mode: body.heygen_mode ?? 'classic',
          heygen_voice_id: body.heygen_voice_id ?? null,
          heygen_resolution: body.heygen_resolution ?? '1080p',
          heygen_aspect_ratio: body.heygen_aspect_ratio ?? '9:16',
          heygen_motion_prompt: body.heygen_motion_prompt ?? null,
          heygen_agent_prompt: body.heygen_agent_prompt ?? null,
          heygen_orientation: body.heygen_orientation ?? 'portrait',
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

      // ── Step 5: Return 201 with created pipeline ─────────────────────────
      // The scheduler picks up this pipeline on its next minute tick — no
      // n8n workflow creation or activation step required.
      return reply.status(201).send(pipeline);
    },
  );
}
