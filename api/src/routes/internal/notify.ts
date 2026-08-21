import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { sendTransactionalEmail } from '../../lib/email.js';

/** Notification preference columns. */
interface NotificationPreferences {
  notify_on_success: boolean;
  notify_on_failure: boolean;
  notify_on_pipeline_paused: boolean;
}

/** Request body shape for POST /internal/notify. */
interface NotifyBody {
  execution_id?: string;
  pipeline_id?: string;
  user_id: string;
  status: string;
  failure_reason?: string;
  type?: string;
}

/**
 * POST /internal/notify
 *
 * Called by n8n at the end of a workflow execution to dispatch a
 * transactional email to the user. The route:
 *   1. Resolves the effective notification type from `type` or `status`.
 *   2. Fetches user email and notification preferences.
 *   3. Checks whether the user has opted in to this category of notification.
 *   4. Dispatches the email via `sendTransactionalEmail()`.
 *
 * Service-token protected (no user JWT).
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 18.5
 */
export async function notifyRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: NotifyBody }>(
    '/notify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['user_id', 'status'],
          additionalProperties: true,
          properties: {
            execution_id: { type: 'string' },
            pipeline_id: { type: 'string' },
            user_id: { type: 'string' },
            status: { type: 'string' },
            failure_reason: { type: 'string' },
            type: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const { user_id, status, pipeline_id, execution_id, failure_reason } = body;

      // Resolve the email template type:
      // Explicit `type` field takes precedence, otherwise derive from `status`.
      const emailType = body.type ?? deriveEmailType(status);

      if (!emailType) {
        request.log.warn(
          { user_id, status },
          '[internal/notify] Unknown status — skipping notification',
        );
        return reply.status(200).send({ message: 'ok' });
      }

      const supabase = createSupabaseAdminClient();

      // Fetch user email from user_profiles (Supabase Auth extension table)
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('id', user_id)
        .maybeSingle();

      if (profileError) {
        request.log.error(
          { user_id, err: profileError.message },
          '[internal/notify] Failed to fetch user profile',
        );
        throw AppError.internal('Failed to retrieve user profile');
      }

      if (!profile) {
        request.log.warn({ user_id }, '[internal/notify] User not found — skipping notification');
        return reply.status(200).send({ message: 'ok' });
      }

      const userEmail = (profile as Record<string, unknown>)['email'] as string;

      // Fetch notification preferences (default all true if no row exists)
      const { data: prefs, error: prefsError } = await supabase
        .from('notification_preferences')
        .select('notify_on_success, notify_on_failure, notify_on_pipeline_paused')
        .eq('user_id', user_id)
        .maybeSingle();

      if (prefsError) {
        request.log.warn(
          { user_id, err: prefsError.message },
          '[internal/notify] Failed to fetch notification preferences — using defaults',
        );
      }

      const preferences: NotificationPreferences = {
        notify_on_success: prefs?.notify_on_success ?? true,
        notify_on_failure: prefs?.notify_on_failure ?? true,
        notify_on_pipeline_paused: prefs?.notify_on_pipeline_paused ?? true,
      };

      // Check whether the user has opted out of this notification category
      if (!isNotificationEnabled(emailType, preferences)) {
        request.log.info(
          { user_id, emailType },
          '[internal/notify] User has disabled this notification type — skipping',
        );
        return reply.status(200).send({ message: 'ok' });
      }

      // Resolve pipeline name for the template
      let pipelineName = '';
      if (pipeline_id) {
        const { data: pipeline } = await supabase
          .from('pipelines')
          .select('name')
          .eq('id', pipeline_id)
          .maybeSingle();
        pipelineName = (pipeline as Record<string, unknown> | null)?.['name'] as string ?? '';
      }

      // Build template data from execution context
      const templateData = buildTemplateData(emailType, {
        pipeline_name: pipelineName,
        pipeline_id: pipeline_id ?? '',
        execution_id: execution_id ?? '',
        failure_reason: failure_reason ?? '',
        timestamp: new Date().toISOString(),
      });

      await sendTransactionalEmail(emailType, userEmail, templateData);

      request.log.info(
        { user_id, emailType, execution_id },
        '[internal/notify] Notification dispatched',
      );

      return reply.status(200).send({ message: 'ok' });
    },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps a pipeline execution `status` value to an email template type.
 * Returns `null` for statuses that have no corresponding template.
 */
function deriveEmailType(status: string): string | null {
  switch (status) {
    case 'success':
      return 'execution-success';
    case 'failed':
    case 'partial':
      return 'execution-failure';
    case 'paused':
      return 'pipeline-paused';
    default:
      return null;
  }
}

/**
 * Returns true when the user's preferences allow this email type to be sent.
 * Auth-related emails (verification, password reset, etc.) are always allowed.
 */
function isNotificationEnabled(
  emailType: string,
  prefs: NotificationPreferences,
): boolean {
  switch (emailType) {
    case 'execution-success':
      return prefs.notify_on_success;
    case 'execution-failure':
      return prefs.notify_on_failure;
    case 'pipeline-paused':
      return prefs.notify_on_pipeline_paused;
    // Non-pipeline-outcome types are always sent regardless of preferences
    default:
      return true;
  }
}

/**
 * Builds the template data object for the given email type.
 */
function buildTemplateData(
  emailType: string,
  context: {
    pipeline_name: string;
    pipeline_id: string;
    execution_id: string;
    failure_reason: string;
    timestamp: string;
  },
): Record<string, unknown> {
  switch (emailType) {
    case 'execution-success':
      return {
        pipeline_name: context.pipeline_name,
        timestamp: context.timestamp,
        video_title: '',
        drive_link: '',
        platform_status: {},
      };
    case 'execution-failure':
      return {
        pipeline_name: context.pipeline_name,
        timestamp: context.timestamp,
        failed_step: '',
        failure_reason: context.failure_reason,
      };
    case 'pipeline-paused':
      return {
        pipeline_name: context.pipeline_name,
        timestamp: context.timestamp,
        consecutive_failures: '',
        last_failure_reason: context.failure_reason,
      };
    default:
      return {
        pipeline_name: context.pipeline_name,
        timestamp: context.timestamp,
      };
  }
}
