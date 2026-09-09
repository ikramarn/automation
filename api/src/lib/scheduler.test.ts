/**
 * Tests for the in-process pipeline scheduler tick logic.
 *
 * Only `runSchedulerTick` is unit-tested here — it's a plain async function
 * with no timers, so it can be invoked directly with a fixed `now` Date.
 * `startScheduler`/`stopScheduler` wire node-cron's actual timer and are
 * intentionally not exercised here (that's effectively testing node-cron
 * itself); this project verifies that wiring via live deployment checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecutePipeline } = vi.hoisted(() => ({
  mockExecutePipeline: vi.fn(),
}));

vi.mock('./pipelineExecutor.js', () => ({
  executePipeline: mockExecutePipeline,
}));

const mockFrom = vi.fn();
vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import { runSchedulerTick } from './scheduler.js';

function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['then'] = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return chain;
}

const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const silentLog = {
  info: logInfo,
  warn: logWarn,
  error: logError,
};

describe('runSchedulerTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutePipeline.mockResolvedValue({ outcome: 'triggered', executionId: 'exec-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires pipelines whose cron matches the current UTC minute', async () => {
    mockFrom.mockReturnValue(
      buildChain({
        data: [
          { id: 'pipe-due', schedule_cron_utc: '30 9 * * *' },
          { id: 'pipe-not-due', schedule_cron_utc: '0 0 * * *' },
        ],
        error: null,
      }),
    );

    const now = new Date(Date.UTC(2026, 2, 15, 9, 30));
    const result = await runSchedulerTick(silentLog, now);

    expect(result).toEqual({ checked: 2, fired: 1 });
    expect(mockExecutePipeline).toHaveBeenCalledOnce();
    expect(mockExecutePipeline).toHaveBeenCalledWith('pipe-due', expect.anything());
  });

  it('fires zero pipelines when none match', async () => {
    mockFrom.mockReturnValue(
      buildChain({
        data: [{ id: 'pipe-1', schedule_cron_utc: '0 0 * * *' }],
        error: null,
      }),
    );

    const now = new Date(Date.UTC(2026, 2, 15, 9, 30));
    const result = await runSchedulerTick(silentLog, now);

    expect(result).toEqual({ checked: 1, fired: 0 });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it('fires multiple due pipelines independently', async () => {
    mockFrom.mockReturnValue(
      buildChain({
        data: [
          { id: 'pipe-a', schedule_cron_utc: '30 9 * * *' },
          { id: 'pipe-b', schedule_cron_utc: '30 9 * * *' },
          { id: 'pipe-c', schedule_cron_utc: '30 9 * * *' },
        ],
        error: null,
      }),
    );

    const now = new Date(Date.UTC(2026, 2, 15, 9, 30));
    const result = await runSchedulerTick(silentLog, now);

    expect(result.fired).toBe(3);
    expect(mockExecutePipeline).toHaveBeenCalledTimes(3);
  });

  it('continues firing other pipelines when one execution throws', async () => {
    mockFrom.mockReturnValue(
      buildChain({
        data: [
          { id: 'pipe-fails', schedule_cron_utc: '30 9 * * *' },
          { id: 'pipe-ok', schedule_cron_utc: '30 9 * * *' },
        ],
        error: null,
      }),
    );

    mockExecutePipeline.mockImplementation((id: string) => {
      if (id === 'pipe-fails') return Promise.reject(new Error('boom'));
      return Promise.resolve({ outcome: 'triggered', executionId: 'exec-ok' });
    });

    const now = new Date(Date.UTC(2026, 2, 15, 9, 30));
    const result = await runSchedulerTick(silentLog, now);

    expect(result.fired).toBe(2);
    expect(mockExecutePipeline).toHaveBeenCalledTimes(2);
    // Error should be logged, not thrown
    expect(logError).toHaveBeenCalled();
  });

  it('returns zero checked/fired and logs an error when the pipelines query fails', async () => {
    mockFrom.mockReturnValue(
      buildChain({ data: null, error: { message: 'DB unavailable' } }),
    );

    const result = await runSchedulerTick(silentLog);

    expect(result).toEqual({ checked: 0, fired: 0 });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it('skips pipelines with a null/empty schedule_cron_utc', async () => {
    mockFrom.mockReturnValue(
      buildChain({
        data: [
          { id: 'pipe-no-cron', schedule_cron_utc: null },
          { id: 'pipe-due', schedule_cron_utc: '30 9 * * *' },
        ],
        error: null,
      }),
    );

    const now = new Date(Date.UTC(2026, 2, 15, 9, 30));
    const result = await runSchedulerTick(silentLog, now);

    expect(result).toEqual({ checked: 2, fired: 1 });
    expect(mockExecutePipeline).toHaveBeenCalledOnce();
    expect(mockExecutePipeline).toHaveBeenCalledWith('pipe-due', expect.anything());
  });

  it('returns checked:0 fired:0 when there are no active pipelines', async () => {
    mockFrom.mockReturnValue(buildChain({ data: [], error: null }));

    const result = await runSchedulerTick(silentLog);

    expect(result).toEqual({ checked: 0, fired: 0 });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });
});
