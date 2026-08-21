import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { triggerN8nWorkflow } from '../../lib/n8n.js';
import { recordSkippedExecution } from '../../lib/scheduling.js';

/**
 * POST /pipelines/:id/trigger — Manually trigger a pipeline execution.
 *
 * Guards:
 *   - Pipeline must exist and belong to the requesting user.
 *   - Pipeline must not be paused or disabled (Req 12.5).
 *   - No execution may already be running for this pipeline.
 *
 * Credentials are fetched at execution time by the n8n workflow itself,
 * so we pass an empty credentials map here.
 *
 * Requirements: 12.5
 */
export async function triggerPipelineRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/:id/trigger',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const supabase = createSupabaseAdminClient();

      // Verify ownership and fetch pipeline state
      const { data: pipeline, error: fetchError } = await supabase
        .from('pipelines')
        .select('id, status, n8n_workflow_id, name, niche_keyword, publishing_platforms, schedule_cron_utc')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error({ userId, pipelineId: id, err: fetchError.message }, 'Failed to fetch pipeline for trigger');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      const p = pipeline as Record<string, unknown>;
      const status = p['status'] as string;

      // Guard: pipeline must be active (Req 12.5)
      if (status === 'paused' || status === 'disabled') {
        throw new AppError(
          403,
          'pipeline_not_active',
          'Pipeline is paused or disabled. Enable it before triggering manually.',
        );
      }

      // Guard: no execution already running
      const { data: runningExec, error: execError } = await supabase
        .from('execution_logs')
        .select('id')
        .eq('pipeline_id', id)
        .eq('status', 'running')
        .limit(1)
        .maybeSingle();

      if (execError) {
        request.log.warn({ pipelineId: id, err: execError.message }, 'Failed to check running executions for manual trigger');
      }

      if (runningExec) {
        // Scheduler-side skip: record a skipped execution instead of erroring.
        // This does NOT count as a failure (consecutive_failures unchanged).
        // Requirements: 12.4
        await recordSkippedExecution(id, userId);
        return reply.status(200).send({
          message: 'Pipeline execution skipped: already running',
          skipped: true,
        });
      }

      const workflowId = (p['n8n_workflow_id'] as string | null) ?? id;

      // Credentials are fetched at execution time by n8n — pass empty map
      const credentials: Record<string, string> = {};
      const pipelineConfig: Record<string, unknown> = {
        pipeline_id: id,
        user_id: userId,
        pipeline_name: p['name'],
        niche_keyword: p['niche_keyword'],
        publishing_platforms: p['publishing_platforms'],
        triggered_manually: true,
      };

      try {
        const { executionId } = await triggerN8nWorkflow(workflowId, credentials, pipelineConfig);
        request.log.info({ pipelineId: id, executionId }, 'Manual pipeline trigger successful');
      } catch (err) {
        request.log.error({ pipelineId: id, err }, 'Failed to trigger n8n workflow for manual execution');
        throw AppError.internal('Failed to trigger pipeline execution');
      }

      return reply.status(200).send({ message: 'Pipeline execution triggered.' });
    },
  );
}
