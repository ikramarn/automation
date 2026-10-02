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
 *
 * Routes:
 *   GET  /privacy        - Privacy Policy HTML page
 *   GET  /terms          - Terms of Service HTML page
 *   POST /data-deletion  - GDPR / platform data deletion endpoint
 *   GET  /robots.txt     - Robots crawl directives
 *   GET  /app-ads.txt    - Authorized seller entries (IAB app-ads.txt)
 */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(privacyRoute);
  await app.register(termsRoute);
  await app.register(dataDeletionRoute);
  await app.register(robotsRoute);
  await app.register(appAdsRoute);
}
