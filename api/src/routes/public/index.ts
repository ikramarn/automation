import type { FastifyInstance } from 'fastify';
import { privacyRoute } from './privacy.js';
import { termsRoute } from './terms.js';
import { dataDeletionRoute } from './data-deletion.js';
import { robotsRoute } from './robots.js';
import { appAdsRoute } from './app-ads.js';

/**
 * Public routes plugin.
 *
 * Registers all publicly accessible compliance and legal routes.
 * No authentication or CSRF middleware is applied to any route in this plugin.
 *
 * Routes:
 *   GET  /privacy        — Privacy Policy HTML page
 *   GET  /terms          — Terms of Service HTML page
 *   POST /data-deletion  — GDPR / platform data deletion endpoint
 *   GET  /robots.txt     — Robots crawl directives
 *   GET  /app-ads.txt    — Authorized seller entries (IAB app-ads.txt)
 *
 * Requirements: 16.1, 16.2, 16.3, 16.9, 17.2, 17.6
 */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(privacyRoute);
  await app.register(termsRoute);
  await app.register(dataDeletionRoute);
  await app.register(robotsRoute);
  await app.register(appAdsRoute);
}
