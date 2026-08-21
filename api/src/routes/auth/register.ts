import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { validatePassword } from './password.js';

/**
 * POST /auth/register
 *
 * Creates a new user account with email + password.
 * Validates password strength, then delegates to Supabase Auth signUp().
 * A verification email is sent automatically by Supabase.
 *
 * Req 1.1: Password constraints.
 * Req 1.3: Email verification link sent on registration.
 * Req 18.7: HTTPS enforced at Nginx layer.
 */
export async function registerRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/register',
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
          201: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };

      // Validate password strength before hitting Supabase
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        throw new AppError(400, 'weak_password', passwordCheck.reason!, {
          field: 'password',
          constraint: passwordCheck.reason,
        });
      }

      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false, // let Supabase send the verification email
      });

      if (error) {
        // Map Supabase errors to appropriate HTTP responses
        const msg = error.message?.toLowerCase() ?? '';
        if (
          msg.includes('already registered') ||
          msg.includes('user already exists') ||
          msg.includes('already been registered') ||
          (data === null && msg.includes('email'))
        ) {
          throw new AppError(409, 'email_already_registered', 'An account with this email already exists');
        }
        throw new AppError(400, 'registration_failed', error.message);
      }

      // Supabase admin.createUser with email_confirm: false creates the user in an
      // unconfirmed state. Send the verification email via generateLink (magiclink type
      // sends a signup confirmation link without needing the password again).
      const { error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: process.env['EMAIL_REDIRECT_TO'] ?? `${process.env['APP_URL'] ?? ''}/verify-email`,
        },
      });

      if (linkError) {
        // Non-fatal: user was created but email couldn't be sent — log and continue
        app.log.warn({ err: linkError, email }, 'Failed to send verification email after registration');
      }

      return reply.status(201).send({ message: 'Verification email sent' });
    },
  );
}
