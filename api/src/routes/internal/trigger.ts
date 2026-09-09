import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { executePipeline } from '../../lib/pipelineExecutor.js';

/** Request body shape for POST /internal/trigger-pipeline. */
interface TriggerPipelineBody {
  pipeline_id: string;
}

/**
 * POST /internal/trigger-pipeline
 *
 * Manually invokable entrypoint for starting a pipeline execution. The
 * scheduled path (lib/scheduler.ts) calls `executePipeline` directly in the
 * same process; this HTTP route exists for external/manual triggering (e.g.
 * n8n webhooks, ops tooling, or the manual "Run now" dashboard action) and
 * delegates to the same shared logic so both paths behave identically.
 *
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

      const result = await executePipeline(pipeline_id, request.log);

      switch (result.outcome) {
        case 'not_found':
          throw AppError.notFound('Pipeline');
        case 'skipped':
          return reply.status(200).send({ message: result.reason, skipped: true });
        case 'error':
          throw AppError.internal('Failed to enqueue pipeline execution');
        case 'triggered':
          return reply.status(200).send({
            message: 'Pipeline execution enqueued',
            executionId: result.executionId,
          });
      }
    },
  );
}
