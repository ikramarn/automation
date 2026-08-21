import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';

/**
 * Registers @fastify/cors.
 *
 * Restricts cross-origin requests to the configured dashboard origin.
 * Credentials are allowed so that HttpOnly cookies are forwarded (Req 15.7).
 */
async function corsPlugin(app: FastifyInstance): Promise<void> {
  const origin = process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';

  await app.register(fastifyCors, {
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-Id'],
  });
}

export default fp(corsPlugin, { name: 'cors' });
