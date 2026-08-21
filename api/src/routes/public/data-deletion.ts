import type { FastifyInstance } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { AppError } from '../../errors/AppError.js';

/** Request body for POST /data-deletion */
interface DataDeletionBody {
  email?: string;
  user_id?: string;
}

/**
 * POST /data-deletion — GDPR / platform data deletion endpoint.
 *
 * Accepts an email address or user ID, looks up the account in user_profiles,
 * then deletes all associated user data. Related records in pipelines,
 * credentials, execution_logs, and notification_preferences are removed via
 * ON DELETE CASCADE foreign keys; the Supabase Auth user record is deleted
 * using the admin API.
 *
 * Publicly accessible — no authentication required (Req 16.3).
 *
 * Responses:
 *  200 — deletion initiated (or already absent)
 *  400 — neither email nor user_id provided
 *  404 — no account found for the provided identifier
 *
 * Requirements: 16.3, 16.9
 */
export async function dataDeletionRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/data-deletion',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            user_id: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          404: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as DataDeletionBody;

      // At least one identifier is required
      if (!body.email && !body.user_id) {
        throw AppError.badRequest(
          'At least one of email or user_id is required.',
          { required_fields: ['email', 'user_id'] },
        );
      }

      const supabase = createSupabaseAdminClient();

      // ── Locate the user in user_profiles ──────────────────────────────────
      let query = supabase.from('user_profiles').select('id, email').limit(1);

      if (body.user_id) {
        query = query.eq('id', body.user_id);
      } else {
        // email is guaranteed non-empty here due to the check above
        query = query.eq('email', body.email as string);
      }

      const { data: profiles, error: lookupError } = await query;

      if (lookupError) {
        request.log.error(
          { err: lookupError.message, email: body.email ? '[redacted]' : undefined },
          'Failed to look up user for data deletion',
        );
        throw AppError.internal('Failed to look up account');
      }

      if (!profiles || profiles.length === 0) {
        return reply.status(404).send({
          message: 'No account found for the provided email or user ID.',
        });
      }

      const userProfile = profiles[0] as { id: string; email: string };
      const userId = userProfile.id;

      // ── Delete user data ──────────────────────────────────────────────────
      // Cascaded tables (via FK ON DELETE CASCADE):
      //   pipelines, credentials, execution_logs, notification_preferences
      //
      // We delete the user_profiles row first which triggers cascades,
      // then delete the Supabase Auth user to remove authentication records.

      const { error: profileDeleteError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', userId);

      if (profileDeleteError) {
        request.log.error(
          { userId, err: profileDeleteError.message },
          'Failed to delete user_profiles row during data deletion',
        );
        throw AppError.internal('Failed to initiate data deletion');
      }

      // Delete the Supabase Auth user (removes login credentials, sessions, etc.)
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(userId);

      if (authDeleteError) {
        // Log but don't fail the response — profile data is already deleted.
        // The auth record may already be absent or deletion may complete asynchronously.
        request.log.warn(
          { userId, err: authDeleteError.message },
          'Failed to delete Supabase Auth user during data deletion (non-fatal)',
        );
      }

      request.log.info(
        { userId },
        'Data deletion initiated for user',
      );

      return reply.status(200).send({
        message: 'Data deletion initiated. All your data will be removed within 30 days.',
      });
    },
  );
}
