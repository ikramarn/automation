import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { checkoutRoute } from './checkout.js';
import { portalRoute } from './portal.js';
import { statusRoute } from './status.js';

/**
 * Subscription route plugin.
 *
 * Registers all subscription routes under the /subscription prefix.
 * All routes require JWT authentication via the authenticate preHandler hook.
 *
 * Routes:
 *   POST /subscription/checkout  — create Stripe Checkout session
 *   GET  /subscription/portal    — create Stripe Customer Portal session
 *   GET  /subscription/status    — return current subscription status
 *
 * Requirements: 2.1, 2.2, 2.8
 */
export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // Apply authenticate middleware to all routes in this plugin
  app.addHook('preHandler', authenticate);

  // Register individual route handlers
  await app.register(checkoutRoute);
  await app.register(portalRoute);
  await app.register(statusRoute);
}
