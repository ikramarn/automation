import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * Google OAuth routes.
 *
 * GET /auth/google          — Initiates Google OAuth via Supabase Auth provider.
 *                             Redirects the user to the Google OAuth consent screen.
 *
 * GET /auth/google/callback — Handles the OAuth callback from Google.
 *                             Exchanges the authorization code for a session, sets an
 *                             HttpOnly session cookie, and redirects to the Dashboard.
 *                             On error, redirects to /login?error=oauth_failed.
 *
 * Req 1.2: Allow registration/login via Google OAuth.
 */
export async function googleOAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /auth/google ────────────────────────────────────────────────────────
  app.get('/google', async (_request, reply) => {
    const redirectTo = process.env['GOOGLE_OAUTH_REDIRECT_URL'];

    if (!redirectTo) {
      throw new AppError(500, 'configuration_error', 'GOOGLE_OAUTH_REDIRECT_URL is not configured');
    }

    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      throw new AppError(502, 'oauth_initiation_failed', 'Failed to initiate Google OAuth');
    }

    return reply.status(302).redirect(data.url);
  });

  // ── GET /auth/google/callback ───────────────────────────────────────────────
  app.get(
    '/google/callback',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const dashboardUrl = process.env['DASHBOARD_URL'] ?? '/dashboard';
      const loginUrl = '/login';

      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      // If Google/Supabase returned an error (e.g., user denied authorization)
      if (query.error || !query.code) {
        return reply.status(302).redirect(`${loginUrl}?error=oauth_failed`);
      }

      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase.auth.exchangeCodeForSession(query.code);

      if (error || !data?.session) {
        return reply.status(302).redirect(`${loginUrl}?error=oauth_failed`);
      }

      const token = data.session.access_token;

      // Set HttpOnly session cookie — same settings as the login route (Req 1.4, 18.7)
      void reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 86400, // 24 hours in seconds
      });

      return reply.status(302).redirect(dashboardUrl);
    },
  );
}
