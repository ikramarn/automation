/**
 * Server entrypoint.
 *
 * Builds the Fastify app and starts listening. Application logic lives in
 * `app.ts` so tests can import `buildApp()` directly without starting a server.
 *
 * The pipeline scheduler (lib/scheduler.ts) is started here — not in
 * `app.ts` — so that unit/integration tests calling `buildApp()` directly
 * never have a live every-minute cron ticking in the background.
 */
import { buildApp } from './app.js';
import { startScheduler, stopScheduler } from './lib/scheduler.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API server listening on http://${HOST}:${PORT}`);
    startScheduler(app.log);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  void (async () => {
    stopScheduler();
    const app = await buildApp();
    await app.close();
    process.exit(0);
  })();
});

await main();
