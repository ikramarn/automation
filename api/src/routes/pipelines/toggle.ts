import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { resetConsecutiveFailures } from '../../lib/consecutiveFailures.js';

/**
 * POST /pipelines/:id/enable  — Set pipeline status to 'active'.
 * POST /pipelines/:id/disable — Set pipeline status to 'disabled'.
 *
 * On disable: if a running execution exists, it is allowed to complete (Req 6.5).
 *
 * Scheduling is owned by the API's in-process scheduler (lib/scheduler.ts),
 * which queries `status = 'active'` fresh on every minute tick. Disabling a
 * pipeline is a synchronous status write, so it takes effect for the very
 * next tick — well within the 5-second cancellation requirement (Req 12.6).
 * There is no n8n workflow to activate/deactivate.
 *
 * Requirements: 6.5, 12.6
 */
export async function togglePipelineRoute(app: FastifyInstance): Promise<void> {
  // ── Enable ────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/:id/enable',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const supabase = createSupabaseAdminClient();

      // Verify ownership
      const { data: pipeline, error: fetchError } = await supabase
        .from('pipelines')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error({ userId, pipelineId: id, err: fetchError.message }, 'Failed to fetch pipeline for enable');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      const { data: updated, error: updateError } = await supabase
        .from('pipelines')
        .update({ status: 'active' })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, name, status')
        .single();

      if (updateError || !updated) {
        request.log.error({ userId, pipelineId: id, err: updateError?.message }, 'Failed to enable pipeline');
        throw AppError.internal('Failed to enable pipeline');
      }

      // Reset consecutive failure counter on re-enable (Req 12.9).
      // Fires after the status update so a failure here does not block the response.
      await resetConsecutiveFailures(id);

      return reply.status(200).send({ message: 'Pipeline enabled.', pipeline: updated });
    },
  );

  // ── Disable ───────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/:id/disable',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const supabase = createSupabaseAdminClient();

      // Verify ownership
      const { data: pipeline, error: fetchError } = await supabase
        .from('pipelines')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error({ userId, pipelineId: id, err: fetchError.message }, 'Failed to fetch pipeline for disable');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      // Check if a running execution exists (Req 6.5)
      const { data: runningExec, error: execError } = await supabase
        .from('execution_logs')
        .select('id')
        .eq('pipeline_id', id)
        .eq('status', 'running')
        .limit(1)
        .maybeSingle();

      if (execError) {
        request.log.warn({ pipelineId: id, err: execError.message }, 'Failed to check running executions on disable');
      }

      // Set status to disabled regardless of running execution state.
      // If execution is running it will be allowed to complete (Req 6.5).
      const { data: updated, error: updateError } = await supabase
        .from('pipelines')
        .update({ status: 'disabled' })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, name, status')
        .single();

      if (updateError || !updated) {
        request.log.error({ userId, pipelineId: id, err: updateError?.message }, 'Failed to disable pipeline');
        throw AppError.internal('Failed to disable pipeline');
      }

      const responseBody: Record<string, unknown> = {
        message: 'Pipeline disabled.',
        pipeline: updated,
      };

      if (runningExec) {
        responseBody['note'] = 'An execution is currently in progress and will be allowed to complete.';
      }

      return reply.status(200).send(responseBody);
    },
  );
}
