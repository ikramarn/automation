import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Registers JWT verification using Supabase's new asymmetric signing keys.
 *
 * Supabase migrated from a shared HS256 JWT secret to asymmetric RS256/ES256
 * signing keys in 2025. Tokens are now verified against the public JWKS
 * endpoint rather than a shared secret.
 *
 * JWKS endpoint: https://<project>.supabase.co/auth/v1/.well-known/jwks.json
 *
 * Falls back to legacy SUPABASE_JWT_SECRET (HS256) if SUPABASE_JWKS_URL is
 * not set — allows local dev without a real Supabase project.
 *
 * Requirements: 1.4, 18.2
 */
async function jwtPlugin(app: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const legacySecret =
    process.env['SUPABASE_JWT_SECRET'] ?? process.env['JWT_SECRET'];

  // Derive JWKS URL from Supabase project URL if not explicitly set
  const jwksUrl = process.env['SUPABASE_JWKS_URL'] ??
    (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : null);

  if (!jwksUrl && !legacySecret) {
    throw new Error(
      'JWT verification requires either SUPABASE_URL or SUPABASE_JWT_SECRET environment variable.',
    );
  }

  if (jwksUrl) {
    // ── New asymmetric key verification (RS256/ES256) ──────────────────────
    // Use jose's createRemoteJWKSet which fetches and caches the JWKS endpoint.
    // The remote key set is cached in memory and refreshed automatically.
    app.log.info(`JWT: using JWKS endpoint ${jwksUrl}`);

    const JWKS = createRemoteJWKSet(new URL(jwksUrl));

    // Attach a custom verifier to the Fastify instance so authenticate
    // middleware can call app.verifyJwt(token)
    app.decorate('verifyJwt', async (token: string) => {
      const { payload } = await jwtVerify(token, JWKS, {
        // Supabase issues tokens without a fixed issuer in some configurations;
        // skip issuer validation to avoid false rejections.
        clockTolerance: 30, // 30-second clock skew tolerance
      });
      return payload;
    });
  } else {
    // ── Legacy HS256 secret (fallback for local dev / old projects) ────────
    app.log.warn('JWT: using legacy HS256 secret — consider migrating to JWKS');

    await app.register(fastifyJwt, { secret: legacySecret! });

    app.decorate('verifyJwt', async (token: string) => {
      // Decode and verify using @fastify/jwt's built-in verifier
      return app.jwt.verify(token);
    });
  }
}

export default fp(jwtPlugin, { name: 'jwt' });
