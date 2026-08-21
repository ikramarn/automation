import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyHelmet from '@fastify/helmet';

/**
 * Registers @fastify/helmet.
 *
 * Sets security-related HTTP response headers (CSP, HSTS, X-Frame-Options,
 * etc.) to harden the API against common web vulnerabilities (Req 15.7).
 */
async function helmetPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyHelmet, {
    // Content-Security-Policy — strict for an API (no scripts / frames needed)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // HSTS: 1 year, include subdomains
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    // Prevent MIME-type sniffing
    noSniff: true,
    // Deny framing
    frameguard: { action: 'deny' },
    // Remove X-Powered-By
    hidePoweredBy: true,
  });
}

export default fp(helmetPlugin, { name: 'helmet' });
