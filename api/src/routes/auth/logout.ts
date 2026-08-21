import type { FastifyInstance } from 'fastify';

/**
 * POST /auth/logout
 *
 * Clears the session cookie by setting its maxAge to 0 (expires it).
 * Returns HTTP 200 with a confirmation message.
 *
 * Req 1.4: Session management.
 */
export async function logoutRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/logout',
    {
      schema: {
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
    async (_request, reply) => {
      // Clear the session cookie by expiring it
      void reply.clearCookie('session_token', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      });

      return reply.status(200).send({ message: 'Logged out' });
    },
  );
}
