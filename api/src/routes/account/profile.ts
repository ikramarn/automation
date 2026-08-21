import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * GET /account
 *
 * Returns the authenticated user's display name, email, and subscription status.
 *
 * Requirements: 21.1
 */
async function getAccountRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              display_name: { type: ['string', 'null'] },
              email: { type: 'string' },
              subscription_status: { type: 'string' },
            },
            required: ['email', 'subscription_status'],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('user_profiles')
        .select('display_name, email, subscription_status')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        request.log.error({ userId, err: error.message }, 'Failed to fetch account profile');
        throw AppError.internal('Failed to retrieve account information');
      }

      if (!data) {
        // Profile row not yet created — fall back to JWT claims
        return reply.status(200).send({
          display_name: null,
          email: request.user.email,
          subscription_status: request.user.subscription_status,
        });
      }

      return reply.status(200).send({
        display_name: data.display_name ?? null,
        email: data.email,
        subscription_status: data.subscription_status,
      });
    },
  );
}

/**
 * PUT /account
 *
 * Updates the authenticated user's display name and/or initiates an email
 * change verification flow.
 *
 * - display_name: 1–50 characters (optional)
 * - email: new email address — sends verification email; change NOT applied
 *   until new address is verified (Req 21.2)
 *
 * Requirements: 21.1, 21.2
 */
async function updateAccountRoute(app: FastifyInstance): Promise<void> {
  app.put(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            display_name: { type: 'string', minLength: 1, maxLength: 50 },
            email: { type: 'string', format: 'email' },
          },
        },
        response: {
          200: {
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
      const userId = request.user.id;
      const body = request.body as { display_name?: string; email?: string };

      if (!body.display_name && !body.email) {
        throw AppError.badRequest('At least one field (display_name or email) must be provided');
      }

      const supabase = createSupabaseAdminClient();
      const messages: string[] = [];

      // Update display name if provided
      if (body.display_name !== undefined) {
        const { error: profileError } = await supabase
          .from('user_profiles')
          .update({ display_name: body.display_name, updated_at: new Date().toISOString() })
          .eq('id', userId);

        if (profileError) {
          request.log.error(
            { userId, err: profileError.message },
            'Failed to update display name',
          );
          throw AppError.internal('Failed to update display name');
        }

        messages.push('Display name updated');
      }

      // Initiate email change verification if new email provided
      if (body.email !== undefined) {
        // Use Supabase admin to send email change verification
        const { error: emailError } = await supabase.auth.admin.updateUserById(userId, {
          email: body.email,
          email_confirm: false, // do not apply until verified
        });

        if (emailError) {
          request.log.error(
            { userId, err: emailError.message },
            'Failed to initiate email change',
          );
          // Distinguish duplicate email errors
          if (emailError.message?.toLowerCase().includes('already')) {
            throw AppError.conflict('Email address is already in use');
          }
          throw AppError.internal('Failed to initiate email change');
        }

        messages.push('Verification email sent to new address');
      }

      return reply.status(200).send({ message: messages.join('; ') });
    },
  );
}

/**
 * DELETE /account
 *
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * Requires the user to confirm by supplying their registered email address in
 * the request body. Triggers the GDPR data deletion process (Req 16.4).
 *
 * Requirements: 21.4, 21.5, 16.4
 */
async function deleteAccountRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string' },
          },
        },
        response: {
          200: {
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
      const userId = request.user.id;
      const { email } = request.body as { email: string };

      // Req 21.5: user must type their registered email exactly
      if (email !== request.user.email) {
        throw AppError.badRequest(
          'Email address does not match. Please type your registered email address to confirm deletion.',
        );
      }

      const supabase = createSupabaseAdminClient();

      // Req 21.4 / 16.4: delete all user data via Supabase admin
      // ON DELETE CASCADE on user_profiles, credentials, pipelines, execution_logs,
      // and notification_preferences ensures all rows are purged.
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) {
        request.log.error({ userId, err: error.message }, 'Failed to delete user account');
        // Req 21.4: block deletion if process fails
        throw AppError.internal('Account deletion failed. Please try again later.');
      }

      request.log.info({ userId }, 'User account deleted — GDPR data deletion initiated');

      return reply.status(200).send({
        message:
          'Account deletion initiated. All personal data will be permanently removed within 30 days.',
      });
    },
  );
}

/**
 * Registers GET /, PUT /, DELETE / account profile sub-routes.
 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(getAccountRoute);
  await app.register(updateAccountRoute);
  await app.register(deleteAccountRoute);
}
