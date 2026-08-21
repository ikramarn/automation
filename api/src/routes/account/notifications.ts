import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/** Shape of a notification_preferences row. */
interface NotificationPreferences {
  notify_on_success: boolean;
  notify_on_failure: boolean;
  notify_on_pipeline_paused: boolean;
}

/**
 * GET /account/notifications
 *
 * Returns the authenticated user's notification preferences.
 * If no preferences row exists yet, returns the default values (all true).
 *
 * Requirements: 14.5, 21.6
 */
async function getNotificationsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/notifications',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              notify_on_success: { type: 'boolean' },
              notify_on_failure: { type: 'boolean' },
              notify_on_pipeline_paused: { type: 'boolean' },
            },
            required: ['notify_on_success', 'notify_on_failure', 'notify_on_pipeline_paused'],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('notify_on_success, notify_on_failure, notify_on_pipeline_paused')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        request.log.error(
          { userId, err: error.message },
          'Failed to fetch notification preferences',
        );
        throw AppError.internal('Failed to retrieve notification preferences');
      }

      // Req 14.5: default all to true for new users with no preferences row
      if (!data) {
        return reply.status(200).send({
          notify_on_success: true,
          notify_on_failure: true,
          notify_on_pipeline_paused: true,
        } satisfies NotificationPreferences);
      }

      return reply.status(200).send({
        notify_on_success: data.notify_on_success,
        notify_on_failure: data.notify_on_failure,
        notify_on_pipeline_paused: data.notify_on_pipeline_paused,
      } satisfies NotificationPreferences);
    },
  );
}

/**
 * PUT /account/notifications
 *
 * Updates the authenticated user's notification preferences.
 * Upserts the notification_preferences row using user_id as the primary key.
 * Unspecified fields retain their current values (partial update).
 *
 * Requirements: 14.5, 21.6
 */
async function updateNotificationsRoute(app: FastifyInstance): Promise<void> {
  app.put(
    '/notifications',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            notify_on_success: { type: 'boolean' },
            notify_on_failure: { type: 'boolean' },
            notify_on_pipeline_paused: { type: 'boolean' },
          },
          // At least one field required — validated in handler
        },
        response: {
          200: {
            type: 'object',
            properties: {
              notify_on_success: { type: 'boolean' },
              notify_on_failure: { type: 'boolean' },
              notify_on_pipeline_paused: { type: 'boolean' },
            },
            required: ['notify_on_success', 'notify_on_failure', 'notify_on_pipeline_paused'],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const body = request.body as Partial<NotificationPreferences>;

      if (
        body.notify_on_success === undefined &&
        body.notify_on_failure === undefined &&
        body.notify_on_pipeline_paused === undefined
      ) {
        throw AppError.badRequest(
          'At least one notification preference field must be provided',
        );
      }

      const supabase = createSupabaseAdminClient();

      // Fetch existing row first so we can merge (partial update)
      const { data: existing, error: fetchError } = await supabase
        .from('notification_preferences')
        .select('notify_on_success, notify_on_failure, notify_on_pipeline_paused')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        request.log.error(
          { userId, err: fetchError.message },
          'Failed to fetch current notification preferences for update',
        );
        throw AppError.internal('Failed to update notification preferences');
      }

      // Merge: defaults (true) for new users, existing values for returning users
      const merged: NotificationPreferences = {
        notify_on_success: body.notify_on_success ?? existing?.notify_on_success ?? true,
        notify_on_failure: body.notify_on_failure ?? existing?.notify_on_failure ?? true,
        notify_on_pipeline_paused:
          body.notify_on_pipeline_paused ?? existing?.notify_on_pipeline_paused ?? true,
      };

      // Upsert using user_id as the conflict key
      const { error: upsertError } = await supabase
        .from('notification_preferences')
        .upsert(
          {
            user_id: userId,
            ...merged,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

      if (upsertError) {
        request.log.error(
          { userId, err: upsertError.message },
          'Failed to upsert notification preferences',
        );
        throw AppError.internal('Failed to update notification preferences');
      }

      request.log.info({ userId }, 'Notification preferences updated');

      return reply.status(200).send(merged);
    },
  );
}

/**
 * Registers GET /notifications and PUT /notifications sub-routes.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(getNotificationsRoute);
  await app.register(updateNotificationsRoute);
}
