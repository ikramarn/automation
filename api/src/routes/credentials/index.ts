import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { listCredentialsRoute } from './list.js';
import { upsertCredentialRoute } from './upsert.js';
import { deleteCredentialRoute } from './delete.js';
import { googleDrivePublicRoutes, googleDriveProtectedRoutes } from './google-drive.js';
import { socialOAuthPublicRoutes, socialOAuthProtectedRoutes } from './social-oauth.js';

/**
 * Credentials routes plugin.
 *
 * Registers all credential management routes under the `/credentials` prefix
 * (prefix applied when registering this plugin in app.ts).
 *
 * Auth scoping:
 *
 *  PUBLIC (no JWT, no CSRF):
 *    GET  /credentials/google/connect              — initiate Google Drive OAuth flow
 *    GET  /credentials/google/callback             — handle OAuth callback from Google
 *    GET  /credentials/social/:platform/connect    — initiate social platform OAuth flow
 *    GET  /credentials/social/:platform/callback   — handle social OAuth callback
 *
 *  PROTECTED (JWT + CSRF on state-changing methods):
 *    GET    /credentials                            — list credential types with masked values
 *    PUT    /credentials/:type                      — save/update a credential
 *    DELETE /credentials/:type                      — delete a credential
 *    DELETE /credentials/google                     — disconnect Google Drive
 *    DELETE /credentials/social/:platform           — disconnect social platform
 *
 * The OAuth connect/callback routes MUST be registered outside the
 * authenticated scope because the browser arrives at these URLs via a redirect
 * from the OAuth provider — no Authorization header or session cookie is present.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.4, 4.7, 4.8,
 *               5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.11, 18.4, 18.6
 */
export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  // ── Public OAuth routes (no auth) ────────────────────────────────────────
  // These must be registered BEFORE the authenticate/csrfProtect hooks are added,
  // so they are scoped to a nested sub-plugin that has no auth hooks.
  await app.register(googleDrivePublicRoutes);
  await app.register(socialOAuthPublicRoutes);

  // ── Protected routes ─────────────────────────────────────────────────────
  // Register a nested sub-plugin with auth hooks so that only these routes
  // require a valid JWT (and CSRF token on state-changing methods).
  await app.register(async (protectedApp: FastifyInstance) => {
    // Apply JWT authentication to all routes in this scope
    protectedApp.addHook('preHandler', authenticate);

    // Apply CSRF protection — guards PUT and DELETE (state-changing) methods.
    // GET passes through the csrfProtect middleware untouched.
    protectedApp.addHook('preHandler', csrfProtect);

    await protectedApp.register(listCredentialsRoute);
    await protectedApp.register(upsertCredentialRoute);
    await protectedApp.register(deleteCredentialRoute);
    await protectedApp.register(googleDriveProtectedRoutes);
    await protectedApp.register(socialOAuthProtectedRoutes);
  });
}
