import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { computeUtcCron } from '../../lib/cronUtils.js';

/** Fields that may be updated on a pipeline (all optional). */
interface UpdatePipelineBody {
  name?: string;
  niche_keyword?: string;
  publishing_platforms?: string[];
  schedule_recurrence?: 'daily' | 'weekdays' | 'custom';
  schedule_time_hhmm?: string;
  schedule_timezone?: string;
  schedule_days_of_week?: number[];
  openai_model?: string;
  heygen_avatar_id?: string;
  video_language?: string;
  script_tone?: string;
  target_duration_secs?: number;
  gdrive_folder_id?: string;
}

/**
 * PUT /pipelines/:id — Update pipeline configuration.
 *
 * When any schedule-related field changes, recomputes the UTC cron expression.
 * Changes take effect on the next scheduled execution (Req 6.7).
 *
 * Requirements: 6.7, 12.1, 12.2
 */
export async function updatePipelineRoute(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { id: string }; Body: UpdatePipelineBody }>(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            niche_keyword: { type: 'string', minLength: 1, maxLength: 200 },
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
            schedule_timezone: { type: 'string', minLength: 1 },
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
      const { id } = request.params;
      const body = request.body;
      const supabase = createSupabaseAdminClient();

      // Verify ownership
      const { data: existing, error: fetchError } = await supabase
        .from('pipelines')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error({ userId, pipelineId: id, err: fetchError.message }, 'Failed to fetch pipeline for update');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!existing) {
        throw AppError.notFound('Pipeline');
      }

      const pipeline = existing as Record<string, unknown>;

      // Build the update payload
      const updates: Record<string, unknown> = {};

      if (body.name !== undefined) updates['name'] = body.name;
      if (body.niche_keyword !== undefined) updates['niche_keyword'] = body.niche_keyword;
      if (body.publishing_platforms !== undefined) updates['publishing_platforms'] = body.publishing_platforms;
      if (body.openai_model !== undefined) updates['openai_model'] = body.openai_model;
      if (body.heygen_avatar_id !== undefined) updates['heygen_avatar_id'] = body.heygen_avatar_id;
      if (body.video_language !== undefined) updates['video_language'] = body.video_language;
      if (body.script_tone !== undefined) updates['script_tone'] = body.script_tone;
      if (body.target_duration_secs !== undefined) updates['target_duration_secs'] = body.target_duration_secs;
      if (body.gdrive_folder_id !== undefined) updates['gdrive_folder_id'] = body.gdrive_folder_id;
      if (body.schedule_recurrence !== undefined) updates['schedule_recurrence'] = body.schedule_recurrence;
      if (body.schedule_time_hhmm !== undefined) updates['schedule_time_hhmm'] = body.schedule_time_hhmm;
      if (body.schedule_timezone !== undefined) updates['schedule_timezone'] = body.schedule_timezone;
      if (body.schedule_days_of_week !== undefined) updates['schedule_days_of_week'] = body.schedule_days_of_week;

      // Recompute UTC cron if any schedule field changed (Req 6.7, 12.2)
      const scheduleChanged =
        body.schedule_time_hhmm !== undefined ||
        body.schedule_timezone !== undefined ||
        body.schedule_recurrence !== undefined ||
        body.schedule_days_of_week !== undefined;

      if (scheduleChanged) {
        const timeHHMM =
          (body.schedule_time_hhmm as string | undefined) ??
          (pipeline['schedule_time_hhmm'] as string);
        const timezone =
          (body.schedule_timezone as string | undefined) ??
          (pipeline['schedule_timezone'] as string);
        const recurrence = (
          (body.schedule_recurrence as string | undefined) ??
          (pipeline['schedule_recurrence'] as string)
        ) as 'daily' | 'weekdays' | 'custom';
        const daysOfWeek =
          body.schedule_days_of_week ??
          (pipeline['schedule_days_of_week'] as number[] | null) ??
          undefined;

        let newCron: string;
        try {
          newCron = computeUtcCron(timeHHMM, timezone, recurrence, daysOfWeek);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid schedule configuration';
          throw AppError.badRequest(message);
        }

        updates['schedule_cron_utc'] = newCron;
      }

      // Apply the update
      const { data: updated, error: updateError } = await supabase
        .from('pipelines')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError || !updated) {
        request.log.error({ userId, pipelineId: id, err: updateError?.message }, 'Failed to update pipeline');
        throw AppError.internal('Failed to update pipeline');
      }

      return reply.status(200).send(updated);
    },
  );
}
