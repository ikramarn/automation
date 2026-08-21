import type { FastifyInstance } from 'fastify';
import { registerRoute } from './register.js';
import { loginRoute } from './login.js';
import { logoutRoute } from './logout.js';
import { verifyEmailRoute } from './verify-email.js';
import { forgotPasswordRoute } from './forgot-password.js';
import { resetPasswordRoute } from './reset-password.js';
import { csrfTokenRoute } from './csrf.js';
import { googleOAuthRoutes } from './google.js';

/**
 * Auth routes plugin.
 *
 * Registers all authentication-related routes under the `/auth` prefix
 * (prefix applied when registering this plugin in app.ts).
 *
 * Routes:
 *   POST /auth/register         — email/password registration
 *   POST /auth/login            — email/password login
 *   POST /auth/logout           — clears session cookie
 *   GET  /auth/verify-email     — email verification callback
 *   POST /auth/forgot-password  — request password reset link
 *   POST /auth/reset-password   — apply new password via reset token
 *   GET  /auth/csrf-token       — issue signed CSRF token (double-submit cookie)
 *   GET  /auth/google           — initiate Google OAuth
 *   GET  /auth/google/callback  — Google OAuth callback
 *
 * Req 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 18.6, 18.7
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  await app.register(registerRoute);
  await app.register(loginRoute);
  await app.register(logoutRoute);
  await app.register(verifyEmailRoute);
  await app.register(forgotPasswordRoute);
  await app.register(resetPasswordRoute);
  await app.register(csrfTokenRoute);
  await app.register(googleOAuthRoutes);
}
