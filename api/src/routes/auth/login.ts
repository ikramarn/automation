import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import {
  checkAccountLocked,
  recordLoginAttempt,
  sendAccountLockedEmail,
} from '../../lib/loginAttempts.js';

/**
 * POST /auth/login
 *
 * Authenticates a user with email + password via Supabase Auth.
 * Rejects login if the user's email is not yet verified.
 * Enforces account lockout after 3 failed attempts within 15 minutes.
 * On success, sets an HttpOnly session cookie and returns user + JWT.
 *
 * Req 1.4: Issue 24-hour session token; redirect to Dashboard.
 * Req 1.5: Lock account for 15 minutes after 3 failed attempts.
 * Req 1.8: Reject login if email unverified.
 * Req 18.7: HTTPS enforced at Nginx layer.
 */
export async function loginRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
              token: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };

      // ── Req 1.5: Check lockout BEFORE attempting authentication ──────────
      const lockStatus = await checkAccountLocked(email);
      if (lockStatus.locked && lockStatus.lockedUntil) {
        const unlockAt = lockStatus.lockedUntil.toISOString();
        throw new AppError(
          429,
          'account_locked',
          `Account locked due to too many failed login attempts. Try again at ${unlockAt}.`,
        );
      }

      const supabase = createSupabaseAdminClient();

      // Use signInWithPassword via the standard (non-admin) auth client
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Record the failed attempt (fire-and-forget; do not block response)
        await recordLoginAttempt(email, false);

        // Re-check lockout — this attempt may have just hit the threshold
        const newLockStatus = await checkAccountLocked(email);
        if (newLockStatus.locked && newLockStatus.lockedUntil) {
          // Just crossed the lockout threshold — send notification email
          await sendAccountLockedEmail(email, newLockStatus.lockedUntil);
        }

        // Supabase returns "Invalid login credentials" for wrong email/password
        throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
      }

      const { user, session } = data;

      // Req 1.8: Reject login if email is not verified
      if (!user.email_confirmed_at) {
        // Record as a failed attempt for consistency
        await recordLoginAttempt(email, false);

        throw new AppError(
          401,
          'email_not_verified',
          'Please verify your email before logging in',
        );
      }

      // ── Successful login ─────────────────────────────────────────────────
      // Req 1.5: Record successful login for audit trail
      await recordLoginAttempt(email, true);

      const token = session.access_token;

      // Set HttpOnly session cookie (Req 1.4, 18.7)
      void reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 86400, // 24 hours in seconds
      });

      return reply.status(200).send({
        user: {
          id: user.id,
          email: user.email ?? email,
        },
        token,
      });
    },
  );
}
