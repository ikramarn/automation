import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fastify preHandler — service token authentication.
 *
 * Validates the `Authorization: Bearer <token>` header against the
 * `N8N_SERVICE_TOKEN` environment variable using `crypto.timingSafeEqual`
 * to prevent timing-based token enumeration attacks.
 *
 * This middleware is applied to all `/internal/*` routes, which are called
 * by n8n (not by end-users). JWT auth is intentionally NOT used here.
 *
 * Returns HTTP 401 `{ error_code: "unauthorized" }` on any auth failure.
 *
 * Requirements: 3.7, 12.8, 18.5
 */
export async function validateServiceToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expectedToken = process.env['N8N_SERVICE_TOKEN'];

  // If the service token is not configured, reject all requests
  if (!expectedToken) {
    request.log.warn('N8N_SERVICE_TOKEN is not set — rejecting internal request');
    return reply.status(401).send({ error_code: 'unauthorized' });
  }

  // Extract Bearer token from Authorization header
  const authHeader = request.headers.authorization ?? '';
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return reply.status(401).send({ error_code: 'unauthorized' });
  }

  const providedToken = parts[1];

  // Use timingSafeEqual to prevent timing-based token enumeration
  // Both buffers must be the same length for timingSafeEqual
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const providedBuf = Buffer.from(providedToken, 'utf8');

  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return reply.status(401).send({ error_code: 'unauthorized' });
  }
}
