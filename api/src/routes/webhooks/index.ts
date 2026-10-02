import type { FastifyInstance } from 'fastify';
import { stripeWebhookRoute } from './stripe.js';

/**
 * Webhook route plugin.
 *
 * Registers all webhook routes under the /webhooks prefix.
 *
 * Routes:
 *   POST /webhooks/stripe   - receive and process Stripe events
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(stripeWebhookRoute);
}
