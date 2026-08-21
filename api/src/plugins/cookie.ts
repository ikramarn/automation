import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';

/**
 * Registers @fastify/cookie.
 *
 * Enables reading and setting cookies (used for HttpOnly session cookies
 * and the CSRF double-submit cookie pattern — Req 18.6).
 */
async function cookiePlugin(app: FastifyInstance): Promise<void> {
  const secret = process.env['COOKIE_SECRET'];
  if (!secret) {
    throw new Error('COOKIE_SECRET environment variable is required');
  }

  await app.register(fastifyCookie, {
    secret,
    hook: 'onRequest',
  });
}

export default fp(cookiePlugin, { name: 'cookie' });
