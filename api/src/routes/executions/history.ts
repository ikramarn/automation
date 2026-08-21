import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/** Query parameters for GET /pipelines/:id/executions */
interface ExecutionHistoryQuery {
  page?: string;
}

/** Execution summary object returned in the history list */
interface ExecutionSummary {
  id: string;
  pipeline_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  failure_reason: string | null;
  created_at: string;
}

const PAGE_SIZE = 10;
const MAX_EXECUTIONS = 30;

/**
 * GET /pipelines/:id/executions — Paginated execution history for a pipeline.
 *
 * - Verifies the pipeline belongs to the authenticated user.
 * - Returns 404 if pipeline not found or not owned by user.
 * - Returns up to the last 30 executions, paginated at 10 per page.
 * - Ordered by started_at DESC (most recent first).
 * - Response: { data, total, page, pageSize, totalPages }
 *
 * Requirements: 13.3
 */
export async function executionHistoryRoute(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { id: string };
    Querystring: ExecutionHistoryQuery;
  }>(
    '/pipelines/:id/executions',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const pipelineId = request.params.id;
      const rawPage = request.query.page;

      // Parse and validate page number
      const page = rawPage !== undefined ? parseInt(rawPage, 10) : 1;
      if (isNaN(page) || page < 1) {
        throw AppError.badRequest('page must be a positive integer');
      }

      const supabase = createSupabaseAdminClient();

      // ── Verify pipeline ownership ────────────────────────────────────────
      const { data: pipeline, error: pipelineError } = await supabase
        .from('pipelines')
        .select('id')
        .eq('id', pipelineId)
        .eq('user_id', userId)
        .maybeSingle();

      if (pipelineError) {
        throw AppError.internal('Failed to verify pipeline ownership');
      }

      if (!pipeline) {
        throw AppError.notFound('Pipeline');
      }

      // ── Fetch up to MAX_EXECUTIONS execution records (last 30) ───────────
      // We fetch all 30, then paginate in application code so that pagination
      // is always applied to a stable "last 30" window.
      const { data: allExecutions, error: execError } = await supabase
        .from('execution_logs')
        .select(
          'id, pipeline_id, status, started_at, ended_at, duration_ms, failure_reason, created_at',
        )
        .eq('pipeline_id', pipelineId)
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(MAX_EXECUTIONS);

      if (execError) {
        throw AppError.internal('Failed to retrieve execution history');
      }

      const executions = (allExecutions ?? []) as ExecutionSummary[];
      const total = executions.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

      // Clamp page to valid range
      const clampedPage = Math.min(page, totalPages);
      const offset = (clampedPage - 1) * PAGE_SIZE;
      const pageData = executions.slice(offset, offset + PAGE_SIZE);

      return reply.status(200).send({
        data: pageData,
        total,
        page: clampedPage,
        pageSize: PAGE_SIZE,
        totalPages,
      });
    },
  );
}
