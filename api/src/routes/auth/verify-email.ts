import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * GET /auth/verify-email
 *
 * Handles email verification callbacks from Supabase.
 * Expects `token_hash` and `type` as query parameters (Supabase email OTP format).
 * On success, redirects to /dashboard.
 *
 * Req 1.3: Email verification flow.
 */
export async function verifyEmailRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/verify-email',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            token_hash: { type: 'string' },
            type: { type: 'string' },
            // Supabase may also send `token` + `type` for older flows
            token: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const query = request.query as {
        token_hash?: string;
        type?: string;
        token?: string;
      };

      const supabase = createSupabaseAdminClient();

      // Supabase email OTP flow: token_hash + type
      if (query.token_hash && query.type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: query.token_hash,
          type: query.type as 'signup' | 'recovery' | 'email_change' | 'email',
        });

        if (error) {
          throw new AppError(400, 'verification_failed', error.message);
        }

        const dashboardUrl = process.env['DASHBOARD_URL'] ?? '/dashboard';
        return reply.redirect(302, dashboardUrl);
      }

      throw new AppError(400, 'missing_verification_token', 'Missing token_hash and type parameters');
    },
  );
}
