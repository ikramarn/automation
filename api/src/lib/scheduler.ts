/**
 * In-process pipeline scheduler.
 *
 * Replaces the previous design of one n8n Schedule Trigger workflow per
 * pipeline. That design depended on n8n's REST API reliably registering a
 * workflow's schedule trigger in the running process immediately after
 * `POST /workflows/{id}/activate` — which n8n does not guarantee (confirmed
 * against n8n's own community/GitHub issue tracker across versions 1.75–2.26:
 * workflows activated via the API are marked active in the database but the
 * in-memory scheduler is only reliably re-registered on process restart or a
 * UI-driven toggle). That gap caused newly-created and re-enabled pipelines
 * to silently never fire until the whole n8n container was restarted.
 *
 * This scheduler owns the schedule instead: every minute it reads
 * `pipelines` directly (the same table the dashboard and API already treat
 * as the source of truth for a pipeline's schedule) and fires any pipeline
 * whose `schedule_cron_utc` matches the current UTC minute. n8n's job is
 * reduced to what it reliably does — running the automation engine workflow
 * when called via its webhook — which `executePipeline` already does today.
 *
 * Runs only in the API process — a single container with no horizontal
 * scaling (see docker-compose.yml), so there is no double-fire risk from
 * multiple replicas ticking independently.
 */
import cron from 'node-cron';
import { createSupabaseAdminClient } from './supabase.js';
import { cronMatchesDate } from './cronMatch.js';
import { executePipeline, type ExecutePipelineLogger } from './pipelineExecutor.js';

/** Minimal row shape needed to decide whether a pipeline is due. */
interface DuePipelineRow {
  id: string;
  schedule_cron_utc: string;
}

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Queries all active pipelines and fires the ones whose cron expression
 * matches the current UTC minute. Failures for one pipeline never block
 * the others — each is fired independently and errors are logged.
 */
export async function runSchedulerTick(
  log: ExecutePipelineLogger = console,
  now: Date = new Date(),
): Promise<{ checked: number; fired: number }> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('pipelines')
    .select('id, schedule_cron_utc')
    .eq('status', 'active');

  if (error) {
    log.error?.({ err: error.message }, '[scheduler] Failed to query active pipelines');
    return { checked: 0, fired: 0 };
  }

  const pipelines = (data ?? []) as DuePipelineRow[];
  const due = pipelines.filter((p) => p.schedule_cron_utc && cronMatchesDate(p.schedule_cron_utc, now));

  await Promise.all(
    due.map(async (p) => {
      try {
        const result = await executePipeline(p.id, log);
        log.info?.(
          { pipelineId: p.id, outcome: result.outcome },
          '[scheduler] Pipeline tick processed',
        );
      } catch (err) {
        // executePipeline is designed not to throw, but guard anyway so one
        // bad pipeline can never take down the scheduler tick.
        log.error?.({ pipelineId: p.id, err }, '[scheduler] Unexpected error firing pipeline');
      }
    }),
  );

  return { checked: pipelines.length, fired: due.length };
}

/**
 * Starts the every-minute scheduler tick. Safe to call once at app startup.
 * Calling it again while already running is a no-op (returns the existing task).
 *
 * `noOverlap: true` guards against a tick still running past the next
 * minute boundary (e.g. many due pipelines) triggering a second concurrent
 * tick — ticks that would overlap are skipped, not queued.
 *
 * `timezone: 'UTC'` is required because `schedule_cron_utc` values are
 * already computed in UTC (see cronUtils.ts) and must be matched against
 * wall-clock UTC time, not the host machine's local timezone.
 */
export function startScheduler(log: ExecutePipelineLogger = console): void {
  if (scheduledTask) {
    return;
  }

  scheduledTask = cron.schedule(
    '* * * * *',
    async () => {
      await runSchedulerTick(log);
    },
    {
      name: 'pipeline-scheduler',
      timezone: 'UTC',
      noOverlap: true,
    },
  );

  log.info?.('[scheduler] Pipeline scheduler started (runs every minute, UTC)');
}

/** Stops the scheduler. Used in tests and graceful shutdown. */
export function stopScheduler(): void {
  if (scheduledTask) {
    void scheduledTask.destroy();
    scheduledTask = null;
  }
}
