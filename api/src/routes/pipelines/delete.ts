import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * DELETE /pipelines/:id — Delete a pipeline.
 *
 * Per Req 6.8: if an execution is currently in progress, the pipeline record
 * is kept alive until the execution completes. We signal this via a 'deleting'
 * status so the execution engine knows to clean up afterwards.
 *
 * If no execution is running, the record is deleted immediately.
 * CASCADE on the foreign key handles associated execution_logs.
 *
 * n8n workflow cancellation is attempted best-effort and does not block
 * the response.
 *
 * Requirements: 6.8, 12.6
 */
export async function deletePipelineRoute(app: FastifyInstance): Promise<void> {
  app.delete<{ Params: { id: string } }>(
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
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const supabase = createSupabaseAdminClient();

      // Verify ownership
      const { data: pipeline, error: fetchError } = await supabase
        .from('pipelines')
        .select('id, n8n_workflow_id, status')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error({ userId, pipelineId: id, err: fetchError.message }, 'Failed to fetch pipeline for deletion');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      const p = pipeline as Record<string, unknown>;

      // Check for in-progress execution (Req 6.8)
      const { data: runningExec, error: execError } = await supabase
        .from('execution_logs')
        .select('id')
        .eq('pipeline_id', id)
        .eq('status', 'running')
        .limit(1)
        .maybeSingle();

      if (execError) {
        request.log.warn({ pipelineId: id, err: execError.message }, 'Failed to check running executions');
      }

      if (runningExec) {
        // Mark as 'deleting' — execution engine will delete it after the run
        const { error: flagError } = await supabase
          .from('pipelines')
          .update({ status: 'deleting' })
          .eq('id', id)
          .eq('user_id', userId);

        if (flagError) {
          request.log.error({ pipelineId: id, err: flagError.message }, 'Failed to mark pipeline as deleting');
          throw AppError.internal('Failed to schedule pipeline deletion');
        }

        return reply.status(200).send({
          message:
            'Pipeline is currently executing. It has been marked for deletion and will be removed once the execution completes.',
        });
      }

      // No active execution — delete immediately
      const { error: deleteError } = await supabase
        .from('pipelines')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (deleteError) {
        request.log.error({ userId, pipelineId: id, err: deleteError.message }, 'Failed to delete pipeline');
        throw AppError.internal('Failed to delete pipeline');
      }

      // Best-effort: cancel n8n workflow (non-blocking, fire-and-forget)
      const workflowId = p['n8n_workflow_id'] as string | null;
      if (workflowId && process.env['N8N_API_URL']) {
        const n8nApiUrl = process.env['N8N_API_URL'];
        const n8nApiKey = process.env['N8N_API_KEY'] ?? '';
        fetch(
          `${n8nApiUrl}/workflows/${encodeURIComponent(workflowId)}`,
          {
            method: 'DELETE',
            headers: { 'X-N8N-API-KEY': n8nApiKey },
          },
        ).catch((err: unknown) => {
          request.log.warn({ pipelineId: id, workflowId, err }, 'Failed to delete n8n workflow (best-effort)');
        });
      }

      return reply.status(200).send({ message: 'Pipeline deleted successfully.' });
    },
  );
}
