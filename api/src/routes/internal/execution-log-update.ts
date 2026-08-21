import type { FastifyInstance } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/** Step results accumulated by the n8n workflow. */
interface StepResults {
  content_fetch?: { status?: string; article_url?: string; error?: string };
  script_generation?: { status?: string; word_count?: number; error?: string };
  video_generation?: { status?: string; heygen_video_id?: string; error?: string };
  file_staging?: { status?: string; r2_object_key?: string; file_size_bytes?: number; error?: string };
  drive_upload?: { status?: string; gdrive_file_id?: string; gdrive_link?: string; error?: string };
  social_publish?: Record<string, unknown>;
}

/** Request body shape for POST /internal/execution-log/update. */
interface ExecLogUpdateBody {
  execution_id: string;
  status: 'success' | 'failed' | 'partial' | 'skipped';
  ended_at: string;
  duration_ms: number;
  failure_reason?: string | null;
  step_results?: StepResults;
}

/**
 * POST /internal/execution-log/update
 *
 * Called by n8n's Cleanup node at the end of a workflow execution to
 * finalize the execution_logs record with the outcome, timing data,
 * and per-step results.
 *
 * Service-token protected (no user JWT).
 *
 * Requirements: 10.6, 15.5
 */
export async function executionLogUpdateRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ExecLogUpdateBody }>(
    '/execution-log/update',
    {
      schema: {
        body: {
          type: 'object',
          required: ['execution_id', 'status', 'ended_at', 'duration_ms'],
          additionalProperties: true,
          properties: {
            execution_id: { type: 'string' },
            status: { type: 'string', enum: ['success', 'failed', 'partial', 'skipped'] },
            ended_at: { type: 'string' },
            duration_ms: { type: 'number' },
            failure_reason: { type: ['string', 'null'] },
            step_results: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const { execution_id, status, ended_at, duration_ms, failure_reason, step_results } =
        request.body;

      const supabase = createSupabaseAdminClient();

      // Build the update payload from step_results (if provided)
      const stepData = step_results ?? {};

      const updatePayload: Record<string, unknown> = {
        status,
        ended_at,
        duration_ms,
        failure_reason: failure_reason ?? null,
      };

      // Map step results to execution_logs columns
      const contentFetch = stepData.content_fetch;
      if (contentFetch) {
        if (contentFetch.status !== undefined) updatePayload['content_fetch_status'] = contentFetch.status;
        if (contentFetch.article_url !== undefined) updatePayload['content_fetch_article_url'] = contentFetch.article_url;
        if (contentFetch.error !== undefined) updatePayload['content_fetch_error'] = contentFetch.error;
      }

      const scriptGen = stepData.script_generation;
      if (scriptGen) {
        if (scriptGen.status !== undefined) updatePayload['script_gen_status'] = scriptGen.status;
        if (scriptGen.error !== undefined) updatePayload['script_gen_error'] = scriptGen.error;
      }

      const videoGen = stepData.video_generation;
      if (videoGen) {
        if (videoGen.status !== undefined) updatePayload['video_gen_status'] = videoGen.status;
        if (videoGen.heygen_video_id !== undefined) updatePayload['heygen_video_id'] = videoGen.heygen_video_id;
        if (videoGen.error !== undefined) updatePayload['video_gen_error'] = videoGen.error;
      }

      const fileStage = stepData.file_staging;
      if (fileStage) {
        if (fileStage.r2_object_key !== undefined) updatePayload['r2_object_key'] = fileStage.r2_object_key;
        if (fileStage.file_size_bytes !== undefined) updatePayload['video_file_size_bytes'] = fileStage.file_size_bytes;
      }

      const driveUpload = stepData.drive_upload;
      if (driveUpload) {
        if (driveUpload.status !== undefined) updatePayload['drive_upload_status'] = driveUpload.status;
        if (driveUpload.gdrive_file_id !== undefined) updatePayload['gdrive_file_id'] = driveUpload.gdrive_file_id;
        if (driveUpload.gdrive_link !== undefined) updatePayload['gdrive_link'] = driveUpload.gdrive_link;
        if (driveUpload.error !== undefined) updatePayload['drive_upload_error'] = driveUpload.error;
      }

      const socialPublish = stepData.social_publish;
      if (socialPublish && typeof socialPublish === 'object') {
        updatePayload['social_publish_results'] = socialPublish;
      }

      const { error } = await supabase
        .from('execution_logs')
        .update(updatePayload)
        .eq('id', execution_id);

      if (error) {
        request.log.error(
          { execution_id, err: error.message },
          '[internal/execution-log/update] Failed to update execution log',
        );
        // Return 200 anyway — Cleanup node swallows errors; we do not want
        // a failed DB write to cause n8n to retry the entire Cleanup node.
        return reply.status(200).send({ message: 'error', error: error.message });
      }

      request.log.info(
        { execution_id, status },
        '[internal/execution-log/update] Execution log finalized',
      );

      return reply.status(200).send({ message: 'ok' });
    },
  );
}
