import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { createPipelineRoute } from './create.js';
import { listPipelinesRoute } from './list.js';
import { getPipelineRoute } from './get.js';
import { updatePipelineRoute } from './update.js';
import { deletePipelineRoute } from './delete.js';
import { togglePipelineRoute } from './toggle.js';
import { triggerPipelineRoute } from './trigger.js';

/**
 * Pipeline routes plugin.
 *
 * All routes in this plugin require:
 *   1. Valid JWT authentication (authenticate preHandler)
 *   2. CSRF protection on state-changing methods (csrfProtect preHandler)
 *
 * Routes registered:
 *   POST   /pipelines                  — create a new pipeline
 *   GET    /pipelines                  — list all user's pipelines
 *   GET    /pipelines/:id              — get full pipeline detail
 *   PUT    /pipelines/:id              — update pipeline configuration
 *   DELETE /pipelines/:id              — delete a pipeline
 *   POST   /pipelines/:id/enable       — enable a pipeline
 *   POST   /pipelines/:id/disable      — disable a pipeline
 *   POST   /pipelines/:id/trigger      — manually trigger a pipeline execution
 *
 * Note: GET /pipelines/:id/executions is registered in the executionRoutes
 * plugin (no prefix) so it sits alongside GET /executions/:id.
 *
 * Requirements: 6.1–6.9, 12.5, 12.6
 */
export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  // Apply authentication to all routes in this plugin
  app.addHook('preHandler', authenticate);

  // Apply CSRF protection to all state-changing requests (POST/PUT/PATCH/DELETE)
  app.addHook('preHandler', csrfProtect);

  // Register individual route handlers
  await app.register(createPipelineRoute);
  await app.register(listPipelinesRoute);
  await app.register(getPipelineRoute);
  await app.register(updatePipelineRoute);
  await app.register(deletePipelineRoute);
  await app.register(togglePipelineRoute);
  await app.register(triggerPipelineRoute);
}
