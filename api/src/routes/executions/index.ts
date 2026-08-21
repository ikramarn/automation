import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { executionHistoryRoute } from './history.js';
import { executionDetailRoute } from './detail.js';

/**
 * Execution routes plugin.
 *
 * Registered at root level (no prefix) in app.ts so that both route shapes
 * resolve correctly:
 *
 *   GET /pipelines/:id/executions  — paginated execution history (Req 13.3)
 *   GET /executions/:id            — full execution detail     (Req 13.4)
 *
 * All routes require a valid JWT (authenticate preHandler).
 * These are read-only GET routes — no CSRF protection needed.
 *
 * Requirements: 13.3, 13.4
 */
export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // Apply authentication to all routes in this plugin
  app.addHook('preHandler', authenticate);

  // GET /pipelines/:id/executions — execution history for a pipeline
  await app.register(executionHistoryRoute);

  // GET /executions/:id — full execution detail
  await app.register(executionDetailRoute);
}
