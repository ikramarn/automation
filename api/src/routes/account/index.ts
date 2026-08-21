import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { profileRoutes } from './profile.js';
import { passwordRoutes } from './password.js';
import { notificationRoutes } from './notifications.js';

/**
 * Account routes plugin.
 *
 * Registers all account management routes under the `/account` prefix
 * (prefix applied when registering this plugin in app.ts).
 *
 * All routes are protected by JWT authentication (authenticate hook).
 * State-changing methods (PUT, DELETE) are additionally protected by CSRF
 * token validation (csrfProtect hook) per Req 18.6.
 *
 * Route summary:
 *   GET    /account                   — display name, email, subscription status
 *   PUT    /account                   — update display name / initiate email change
 *   DELETE /account                   — account deletion (GDPR)
 *   PUT    /account/password          — change password
 *   GET    /account/notifications     — get notification preferences
 *   PUT    /account/notifications     — update notification preferences
 *
 * Requirements: 14.5, 16.4, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // All account routes require a valid JWT
  app.addHook('preHandler', authenticate);

  // CSRF protection for all state-changing methods (PUT, DELETE)
  app.addHook('preHandler', csrfProtect);

  // GET /, PUT /, DELETE /
  await app.register(profileRoutes);

  // PUT /password
  await app.register(passwordRoutes);

  // GET /notifications, PUT /notifications
  await app.register(notificationRoutes);
}
