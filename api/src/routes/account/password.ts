import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * PUT /account/password
 *
 * Changes the authenticated user's password.
 *
 * Flow:
 *  1. Validate body: current_password and new_password (min 8 chars).
 *  2. Verify the current password by attempting a Supabase sign-in.
 *  3. Update the password via Supabase admin updateUserById.
 *
 * Requirements: 21.3
 */
export async function passwordRoutes(app: FastifyInstance): Promise<void> {
  app.put(
    '/password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['current_password', 'new_password'],
          additionalProperties: false,
          properties: {
            current_password: { type: 'string', minLength: 1 },
            new_password: { type: 'string', minLength: 8 },
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
      const userEmail = request.user.email;
      const { current_password, new_password } = request.body as {
        current_password: string;
        new_password: string;
      };

      const supabase = createSupabaseAdminClient();

      // 1. Verify the current password by attempting sign-in with their email
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: current_password,
      });

      if (signInError) {
        // Do NOT distinguish between "wrong password" and other errors to
        // avoid account enumeration
        request.log.debug({ userId }, 'Current password verification failed');
        throw AppError.badRequest('Current password is incorrect');
      }

      // 2. Apply the new password via admin API (bypasses Supabase's own
      //    password policy — we enforce min 8 chars via schema above)
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        password: new_password,
      });

      if (updateError) {
        request.log.error(
          { userId, err: updateError.message },
          'Failed to update password via admin API',
        );
        throw AppError.internal('Failed to update password');
      }

      request.log.info({ userId }, 'Password updated successfully');

      return reply.status(200).send({ message: 'Password updated successfully' });
    },
  );
}
