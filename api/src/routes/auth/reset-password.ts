import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { validatePassword } from './password.js';

/**
 * POST /auth/reset-password
 *
 * Applies a new password using a reset token received from Supabase's
 * password reset email. Validates password strength before applying.
 *
 * The flow:
 *  1. User clicks reset link → lands on /reset-password with token_hash + type in URL
 *  2. Frontend exchanges the token_hash for a session via verifyOtp
 *  3. Frontend sends the new password to this endpoint with the access token
 *
 * Req 1.1: Password constraints.
 * Req 1.6: Single-use reset token.
 */
export async function resetPasswordRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/reset-password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'password'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, password } = request.body as { token: string; password: string };

      // Validate new password strength before applying
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        throw new AppError(400, 'weak_password', passwordCheck.reason!, {
          field: 'password',
          constraint: passwordCheck.reason,
        });
      }

      const supabase = createSupabaseAdminClient();

      // Exchange the reset token (token_hash) for a session
      const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'recovery',
      });

      if (verifyError || !sessionData.user) {
        throw new AppError(
          400,
          'invalid_reset_token',
          'Invalid or expired password reset token',
        );
      }

      // Apply the new password via admin updateUserById
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        sessionData.user.id,
        { password },
      );

      if (updateError) {
        throw new AppError(400, 'password_update_failed', updateError.message);
      }

      return reply.status(200).send({ message: 'Password updated successfully' });
    },
  );
}
