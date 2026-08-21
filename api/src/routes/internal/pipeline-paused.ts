import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { sendTransactionalEmail } from '../../lib/email.js';

/** Request body shape for POST /internal/pipeline-paused. */
interface PipelinePausedBody {
  pipeline_id: string;
  user_id: string;
  consecutive_failures: number;
  last_failure_reason?: string;
}

/**
 * POST /internal/pipeline-paused
 *
 * Called by n8n when a pipeline has exceeded its consecutive-failure threshold
 * and should be automatically paused. The route:
 *   1. Updates `pipelines.status` to `"paused"`.
 *   2. Checks the user's notification preferences.
 *   3. Sends a `pipeline-paused` email if the user has not opted out.
 *
 * Service-token protected (no user JWT).
 *
 * Requirements: 12.8, 14.3, 18.5
 */
export async function pipelinePausedRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PipelinePausedBody }>(
    '/pipeline-paused',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pipeline_id', 'user_id', 'consecutive_failures'],
          additionalProperties: true,
          properties: {
            pipeline_id: { type: 'string' },
            user_id: { type: 'string' },
            consecutive_failures: { type: 'number' },
            last_failure_reason: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { pipeline_id, user_id, consecutive_failures, last_failure_reason } = request.body;
      const supabase = createSupabaseAdminClient();

      // Step 1: Update pipeline status to "paused"
      const { error: updateError } = await supabase
        .from('pipelines')
        .update({
          status: 'paused',
          consecutive_failures,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pipeline_id)
        .eq('user_id', user_id);

      if (updateError) {
        request.log.error(
          { pipeline_id, user_id, err: updateError.message },
          '[internal/pipeline-paused] Failed to update pipeline status',
        );
        throw AppError.internal('Failed to update pipeline status');
      }

      request.log.info(
        { pipeline_id, user_id, consecutive_failures },
        '[internal/pipeline-paused] Pipeline status set to paused',
      );

      // Step 2: Fetch pipeline name and user email for the notification
      const [{ data: pipeline }, { data: profile }] = await Promise.all([
        supabase
          .from('pipelines')
          .select('name')
          .eq('id', pipeline_id)
          .maybeSingle(),
        supabase
          .from('user_profiles')
          .select('email')
          .eq('id', user_id)
          .maybeSingle(),
      ]);

      const pipelineName =
        (pipeline as Record<string, unknown> | null)?.['name'] as string ?? '';
      const userEmail =
        (profile as Record<string, unknown> | null)?.['email'] as string ?? '';

      if (!userEmail) {
        request.log.warn(
          { user_id },
          '[internal/pipeline-paused] User email not found — skipping notification',
        );
        return reply.status(200).send({ message: 'ok' });
      }

      // Step 3: Check notification preferences (default true)
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('notify_on_pipeline_paused')
        .eq('user_id', user_id)
        .maybeSingle();

      const notifyOnPause = (prefs as Record<string, unknown> | null)?.['notify_on_pipeline_paused'] ?? true;

      if (!notifyOnPause) {
        request.log.info(
          { user_id },
          '[internal/pipeline-paused] User has disabled pipeline-paused notifications — skipping',
        );
        return reply.status(200).send({ message: 'ok' });
      }

      // Step 4: Send pipeline-paused email
      await sendTransactionalEmail('pipeline-paused', userEmail, {
        pipeline_name: pipelineName,
        timestamp: new Date().toISOString(),
        consecutive_failures: String(consecutive_failures),
        last_failure_reason: last_failure_reason ?? '',
      });

      request.log.info(
        { pipeline_id, user_id },
        '[internal/pipeline-paused] Pipeline-paused notification dispatched',
      );

      return reply.status(200).send({ message: 'ok' });
    },
  );
}
