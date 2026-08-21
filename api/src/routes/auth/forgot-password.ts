import type { FastifyInstance } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * POST /auth/forgot-password
 *
 * Sends a single-use password reset link to the provided email address.
 * The link expires after 60 minutes (configured in Supabase project settings
 * and passed via redirectTo with an expiry hint).
 *
 * Always returns HTTP 200 — we never reveal whether the email exists.
 *
 * Req 1.6: 60-minute single-use reset link.
 */
export async function forgotPasswordRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/forgot-password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
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
      const { email } = request.body as { email: string };

      const supabase = createSupabaseAdminClient();
      const resetRedirectTo =
        process.env['PASSWORD_RESET_REDIRECT_URL'] ??
        `${process.env['APP_URL'] ?? ''}/reset-password`;

      // Attempt to send the reset email.
      // The token expiry (60 minutes) is controlled by Supabase project settings.
      // We use generateLink for admin-side control; errors are swallowed to avoid
      // leaking whether the email exists (Req 1.6, security best practice).
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: resetRedirectTo,
      });

      if (error) {
        // Log the error server-side but do NOT surface it to the client
        app.log.warn({ err: error, email }, 'Password reset email request failed');
      }

      // Always return 200 — never reveal whether the email exists
      return reply.status(200).send({ message: 'If an account exists for this email, a reset link has been sent' });
    },
  );
}
