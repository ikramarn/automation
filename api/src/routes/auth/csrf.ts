import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * GET /auth/csrf-token
 *
 * Issues a cryptographically random CSRF token using the double-submit cookie
 * pattern (Req 18.6):
 *
 * 1. Generates a 32-byte random token encoded as a 64-character hex string.
 * 2. Sets a **signed** `csrf_token` cookie so the server can verify the
 *    signature on subsequent state-changing requests (HttpOnly: false so
 *    JavaScript can read it; Secure: true; SameSite: Strict).
 * 3. Returns the same token in the response body so the client can embed it
 *    in the `X-CSRF-Token` request header.
 *
 * The middleware `csrfProtect` in `src/middleware/csrf.ts` validates that the
 * header value matches the signed cookie on POST/PUT/PATCH/DELETE requests.
 *
 * Requirements: 18.6
 */
export async function csrfTokenRoute(app: FastifyInstance): Promise<void> {
  app.get('/csrf-token', async (_request, reply) => {
    const token = randomBytes(32).toString('hex');

    // Set a signed cookie so the server can verify it hasn't been tampered with.
    // HttpOnly: false → JavaScript must be able to read it to embed in request header.
    // Secure: true    → only sent over HTTPS.
    // SameSite: Strict → prevents the cookie being sent in cross-site requests.
    void reply.setCookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
      signed: true,
    });

    return reply.status(200).send({ csrfToken: token });
  });
}

/** Cookie name — must match the constant in csrf.ts middleware. */
const CSRF_COOKIE_NAME = 'csrf_token';
