import Fastify from 'fastify';
import cookiePlugin from './plugins/cookie.js';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import jwtPlugin from './plugins/jwt.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth/index.js';
import { subscriptionRoutes } from './routes/subscription/index.js';
import { credentialRoutes } from './routes/credentials/index.js';
import { pipelineRoutes } from './routes/pipelines/index.js';
import { executionRoutes } from './routes/executions/index.js';
import { publicRoutes } from './routes/public/index.js';
import { webhookRoutes } from './routes/webhooks/index.js';
import { accountRoutes } from './routes/account/index.js';
import { internalRoutes } from './routes/internal/index.js';
import { registerErrorHandler } from './errors/errorHandler.js';

export interface BuildAppOptions {
  /** Override log level (default: 'info' in production, 'debug' in dev) */
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Use pretty-print logging (default: true in development) */
  prettyLogs?: boolean;
}

/**
 * Builds and returns a configured Fastify application instance.
 *
 * Keeping the app construction separate from `listen()` lets tests import
 * `buildApp()` and call `app.inject()` without binding to a real port.
 *
 * ── Authentication for protected routes ────────────────────────────────────
 *
 * Import `authenticate` from `./middleware/authenticate.js` and apply it as a
 * `preHandler` on any route or route group that requires a valid JWT.
 *
 * Option A — per-route:
 *   app.get('/pipelines', { preHandler: authenticate }, handler);
 *
 * Option B — entire route group (recommended for most route files):
 *   async function pipelineRoutes(app: FastifyInstance) {
 *     app.addHook('preHandler', authenticate);   // protects every route in this plugin
 *     app.get('/', listPipelinesHandler);
 *     app.post('/', createPipelineHandler);
 *   }
 *   await app.register(pipelineRoutes, { prefix: '/pipelines' });
 *
 * Routes that must remain public (no authenticate hook):
 *   /auth/*  /webhooks/*  /health  /privacy  /terms  /data-deletion  /robots.txt
 *
 * Requirements: 1.4, 18.2
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<ReturnType<typeof Fastify>> {
  const isProd = process.env['NODE_ENV'] === 'production';

  const logLevel = opts.logLevel ?? (isProd ? 'info' : 'debug');
  const prettyLogs = opts.prettyLogs ?? !isProd;

  const app = Fastify({
    logger: {
      level: logLevel,
      ...(prettyLogs
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    // Trust X-Forwarded-* headers when behind Nginx proxy
    trustProxy: true,
    // Include request ID in logs and expose via X-Request-Id header
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
  });

  // ── Security plugins (register before routes) ──────────────────────────────
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(cookiePlugin);
  await app.register(jwtPlugin);

  // ── Error handling ─────────────────────────────────────────────────────────
  registerErrorHandler(app);

  // ── Routes ─────────────────────────────────────────────────────────────────
  // Public routes (no auth required)
  await app.register(healthRoutes);

  // Legal, compliance, and crawl directive routes — no auth or CSRF needed
  // Covers: /privacy, /terms, /data-deletion, /robots.txt, /app-ads.txt
  // Requirements: 16.1, 16.2, 16.3, 16.9, 17.2, 17.6
  await app.register(publicRoutes);

  // Webhook routes — public (no auth; signature-verified internally)
  // Must be registered before body-parsing plugins consume the stream.
  // Requirements: 2.3, 2.4, 2.5, 2.9
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  // Auth routes — public (registration, login, verification, password reset)
  await app.register(authRoutes, { prefix: '/auth' });

  // Subscription routes — protected (JWT required, no CSRF needed — Stripe webhooks exempt)
  await app.register(subscriptionRoutes, { prefix: '/subscription' });

  // Credential routes — protected (JWT + CSRF required for PUT/DELETE)
  await app.register(credentialRoutes, { prefix: '/credentials' });

  // Pipeline routes — protected (JWT + CSRF required for POST/PUT/PATCH/DELETE)
  await app.register(pipelineRoutes, { prefix: '/pipelines' });

  // Execution routes — protected (JWT required, read-only)
  // Registered at root level (no prefix) so both route shapes resolve correctly:
  //   GET /pipelines/:id/executions  — execution history (Req 13.3)
  //   GET /executions/:id            — execution detail  (Req 13.4)
  await app.register(executionRoutes);

  // Account routes — protected (JWT + CSRF on state-changing methods)
  // Covers: GET/PUT/DELETE /account, PUT /account/password,
  //         GET/PUT /account/notifications
  // Requirements: 14.5, 16.4, 21.1–21.6
  await app.register(accountRoutes, { prefix: '/account' });

  // Internal routes — service-token protected (no JWT, no CSRF)
  // Called by n8n scheduler and workflow nodes (not end-users).
  // Requirements: 3.7, 12.8, 14.1, 14.2, 14.3, 14.4, 18.5
  await app.register(internalRoutes, { prefix: '/internal' });

  // Protected route groups — register with authenticate as a preHandler hook.
  // Each route plugin should call `app.addHook('preHandler', authenticate)`
  // at the top of the plugin body (see Option B in the JSDoc above).
  //
  // ── CSRF protection ────────────────────────────────────────────────────────
  // Routes that mutate state (/pipelines, /credentials, /settings) MUST also
  // apply the `csrfProtect` preHandler hook (Req 18.6). The Dashboard fetches
  // a fresh CSRF token from GET /auth/csrf-token before any state-changing
  // request, embeds it as the `X-CSRF-Token` header, and the middleware verifies
  // it matches the signed `csrf_token` cookie.
  //
  // Example for a protected, CSRF-guarded route group:
  //   import { authenticate } from './middleware/authenticate.js';
  //   import { csrfProtect }  from './middleware/csrf.js';
  //
  //   async function pipelineRoutes(app: FastifyInstance) {
  //     app.addHook('preHandler', authenticate);  // JWT auth
  //     app.addHook('preHandler', csrfProtect);   // CSRF guard on POST/PUT/PATCH/DELETE
  //     app.get('/',  listPipelinesHandler);       // GET passes through CSRF check
  //     app.post('/', createPipelineHandler);      // POST requires valid CSRF token
  //   }
  //
  // await app.register(settingsRoutes,     { prefix: '/settings' });     // protected + CSRF
  // await app.register(accountRoutes,      { prefix: '/account' });      // protected (registered above)

  return app;
}
