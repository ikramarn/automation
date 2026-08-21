import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';

/**
 * Registers @fastify/jwt with the Supabase JWT secret.
 *
 * Secret resolution order:
 *   1. `SUPABASE_JWT_SECRET` — preferred; matches Supabase Auth naming
 *   2. `JWT_SECRET`          — fallback alias for local dev / testing
 *
 * The plugin is wrapped in fastify-plugin so the `fastify.jwt` decorator and
 * `request.jwtVerify()` are available app-wide (not scoped to a sub-context).
 *
 * Token verification (signature + exp) is handled by @fastify/jwt internally.
 * Supabase issues HS256 JWTs; we only verify, never sign user tokens.
 *
 * Requirements: 1.4, 18.2
 */
async function jwtPlugin(app: FastifyInstance): Promise<void> {
  const secret =
    process.env['SUPABASE_JWT_SECRET'] ?? process.env['JWT_SECRET'];

  if (!secret) {
    throw new Error(
      'JWT secret is required. Set SUPABASE_JWT_SECRET (or JWT_SECRET) environment variable.',
    );
  }

  await app.register(fastifyJwt, {
    secret,
    // Tokens are issued by Supabase Auth — we verify only, never sign.
    // @fastify/jwt validates exp, iat, and nbf claims automatically.
  });
}

export default fp(jwtPlugin, { name: 'jwt' });
