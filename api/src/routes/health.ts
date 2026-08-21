import type { FastifyInstance } from 'fastify';

/**
 * Health check route.
 *
 * GET /health
 *
 * Returns { status: "ok" } when the server is running and healthy.
 * This route is intentionally unauthenticated so that load balancers,
 * Docker health checks, and uptime monitors can reach it without a token.
 *
 * Req 19.3: Uses the standard response shape.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
            },
            required: ['status'],
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({ status: 'ok' });
    },
  );
}
