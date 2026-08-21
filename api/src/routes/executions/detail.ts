import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/** Raw row returned from execution_logs */
interface ExecutionLogRow {
  id: string;
  pipeline_id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  failure_reason: string | null;
  // Content fetch step
  content_fetch_status: string | null;
  content_fetch_article_url: string | null;
  content_fetch_error: string | null;
  // Script generation step
  script_gen_status: string | null;
  script_text: string | null;
  script_gen_error: string | null;
  // Video generation step
  video_gen_status: string | null;
  heygen_video_id: string | null;
  r2_object_key: string | null;
  video_file_size_bytes: number | null;
  video_gen_error: string | null;
  // Drive upload step
  drive_upload_status: string | null;
  gdrive_file_id: string | null;
  gdrive_link: string | null;
  drive_upload_error: string | null;
  // Social publish step
  social_publish_results: Record<string, unknown> | null;
  created_at: string;
}

/** Step failures formatted as "[step name]: [error description]" */
interface StepStatuses {
  content_fetch: string | null;
  script_generation: string | null;
  video_generation: string | null;
  drive_upload: string | null;
  social_publish: Record<string, unknown> | null;
}

/** Formatted execution detail response */
interface ExecutionDetail {
  id: string;
  pipeline_id: string;
  status: string;
  started_at: string;
  /** ISO timestamp or "in progress" when the execution has not ended yet */
  ended_at: string | 'in progress';
  duration_ms: number | null;
  /** Overall failure reason formatted as "[step name]: [error description]", or null */
  failure_reason: string | null;
  step_statuses: StepStatuses;
  script_text: string | null;
  video_link: string | null;
  heygen_video_id: string | null;
  created_at: string;
}

/**
 * Formats an error field from an execution log step into the required
 * "[step name]: [human-readable error description]" format.
 *
 * Returns null if there is no error message for that step.
 */
function formatStepError(stepName: string, errorText: string | null): string | null {
  if (!errorText) return null;
  return `${stepName}: ${errorText}`;
}

/**
 * Derives the top-level failure_reason from the step errors.
 *
 * Checks each step in order and returns the first non-null formatted error,
 * or falls back to the raw failure_reason column value.
 */
function deriveFailureReason(row: ExecutionLogRow): string | null {
  const stepErrors: Array<[string, string | null]> = [
    ['content fetch', row.content_fetch_error],
    ['script generation', row.script_gen_error],
    ['video generation', row.video_gen_error],
    ['drive upload', row.drive_upload_error],
  ];

  for (const [stepName, errorText] of stepErrors) {
    const formatted = formatStepError(stepName, errorText);
    if (formatted) return formatted;
  }

  return row.failure_reason ?? null;
}

/**
 * GET /executions/:id — Full execution detail.
 *
 * Returns complete execution record including:
 *   - Per-step statuses (content fetch, script generation, video generation,
 *     drive upload, social publish)
 *   - Generated script text
 *   - Video file link (gdrive_link or null)
 *   - Failure reasons formatted as "[step name]: [error description]"
 *   - ended_at as "in progress" when null
 *
 * Returns 404 when execution not found or does not belong to the user.
 *
 * Requirements: 13.4
 */
export async function executionDetailRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/executions/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const executionId = request.params.id;

      const supabase = createSupabaseAdminClient();

      // ── Fetch execution log (scoped to user) ────────────────────────────
      const { data: row, error } = await supabase
        .from('execution_logs')
        .select('*')
        .eq('id', executionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        throw AppError.internal('Failed to retrieve execution details');
      }

      if (!row) {
        throw AppError.notFound('Execution');
      }

      const execution = row as ExecutionLogRow;

      // ── Format response ──────────────────────────────────────────────────

      const detail: ExecutionDetail = {
        id: execution.id,
        pipeline_id: execution.pipeline_id,
        status: execution.status,
        started_at: execution.started_at,
        ended_at: execution.ended_at ?? 'in progress',
        duration_ms: execution.duration_ms,
        failure_reason: deriveFailureReason(execution),
        step_statuses: {
          content_fetch: formatStepError('content fetch', execution.content_fetch_error) ??
            execution.content_fetch_status,
          script_generation: formatStepError('script generation', execution.script_gen_error) ??
            execution.script_gen_status,
          video_generation: formatStepError('video generation', execution.video_gen_error) ??
            execution.video_gen_status,
          drive_upload: formatStepError('drive upload', execution.drive_upload_error) ??
            execution.drive_upload_status,
          social_publish: execution.social_publish_results,
        },
        script_text: execution.script_text,
        video_link: execution.gdrive_link,
        heygen_video_id: execution.heygen_video_id,
        created_at: execution.created_at,
      };

      return reply.status(200).send(detail);
    },
  );
}
