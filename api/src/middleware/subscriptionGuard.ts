import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';

/**
 * HTTP methods that are considered read-only (safe methods per RFC 7231).
 * These are allowed even when the subscription is suspended or inactive.
 */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Subscription statuses that block mutation operations.
 * Users with these statuses may only perform read-only requests.
 *
 * Requirements: 2.6
 */
const BLOCKED_STATUSES = new Set(['suspended', 'inactive', 'cancelled']);

/**
 * Fastify preHandler hook — subscription guard middleware.
 *
 * Runs after the `authenticate` middleware (which sets `request.user`).
 *
 * Logic:
 *   - GET / HEAD / OPTIONS → always pass through (read-only access)
 *   - POST / PUT / PATCH / DELETE with an active subscription → pass through
 *   - POST / PUT / PATCH / DELETE with "suspended", "inactive", or "cancelled"
 *     status → throw AppError 403 { error_code: "subscription_required" }
 *
 * Requirements: 2.6
 */
export async function requireActiveSubscription(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Read-only methods are always permitted regardless of subscription status
  if (READ_ONLY_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const status = request.user?.subscription_status;

  if (BLOCKED_STATUSES.has(status)) {
    throw new AppError(
      403,
      'subscription_required',
      'An active subscription is required to perform this action.',
    );
  }
}
