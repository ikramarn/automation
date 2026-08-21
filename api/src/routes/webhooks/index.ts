import type { FastifyInstance } from 'fastify';
import { stripeWebhookRoute } from './stripe.js';

/**
 * Webhook route plugin.
 *
 * Registers all webhook routes under the /webhooks prefix.
 * No authentication is applied — webhook endpoints are publicly reachable
 * and rely on signature verification instead.
 *
 * Raw body access is required for Stripe signature verification. Fastify's
 * default JSON parsing is disabled per-route; the raw Buffer is read from
 * the request stream directly in the Stripe route handler.
 *
 * Routes:
 *   POST /webhooks/stripe  — receive and process Stripe events
 *
 * Requirements: 2.3, 2.4, 2.5, 2.9
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Register individual webhook handlers — NO authenticate hook here.
  // Each handler is responsible for its own signature / token verification.
  await app.register(stripeWebhookRoute);
}
