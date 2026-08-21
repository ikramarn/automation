import type { FastifyInstance } from 'fastify';
import { validateServiceToken } from '../../middleware/serviceToken.js';
import { triggerPipelineRoute } from './trigger.js';
import { notifyRoute } from './notify.js';
import { pipelinePausedRoute } from './pipeline-paused.js';
import { executionLogUpdateRoute } from './execution-log-update.js';

/**
 * Internal routes plugin.
 *
 * All routes in this plugin are called by n8n (not by end-users) and are
 * protected by service token authentication instead of JWT.
 *
 * The `validateServiceToken` preHandler runs before every route in this plugin,
 * comparing the `Authorization: Bearer <token>` header against the
 * `N8N_SERVICE_TOKEN` environment variable using `crypto.timingSafeEqual`.
 *
 * Route summary (prefix `/internal` applied in app.ts):
 *   POST /internal/trigger-pipeline        — validate + enqueue n8n workflow
 *   POST /internal/notify                  — dispatch transactional email
 *   POST /internal/pipeline-paused         — mark pipeline paused + notify user
 *   POST /internal/execution-log/update    — finalize execution_logs record
 *
 * Requirements: 3.7, 10.6, 12.8, 14.1, 14.2, 14.3, 14.4, 15.5, 18.5
 */
export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // All internal routes require a valid service token
  app.addHook('preHandler', validateServiceToken);

  await app.register(triggerPipelineRoute);
  await app.register(notifyRoute);
  await app.register(pipelinePausedRoute);
  await app.register(executionLogUpdateRoute);
}
