/**
 * Tests for the shared pipeline execution logic used by both the
 * /internal/trigger-pipeline HTTP route and the in-process scheduler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

const { mockGetDecryptedSecret, mockTriggerN8nWorkflow } = vi.hoisted(() => ({
  mockGetDecryptedSecret: vi.fn(),
  mockTriggerN8nWorkflow: vi.fn(),
}));

vi.mock('./vault.js', () => ({
  getDecryptedSecret: mockGetDecryptedSecret,
}));

vi.mock('./n8n.js', () => ({
  triggerN8nWorkflow: mockTriggerN8nWorkflow,
}));

import { executePipeline } from './pipelineExecutor.js';

const PIPELINE_ID = 'pipe-1';
const USER_ID = 'user-1';

const activePipeline = {
  id: PIPELINE_ID,
  user_id: USER_ID,
  status: 'active',
  n8n_workflow_id: null,
  name: 'Test Pipeline',
  niche_keyword: 'tech',
  publishing_platforms: ['youtube'],
  schedule_cron_utc: '0 14 * * *',
};

/** Chainable Supabase mock keyed by table name. */
function makeSupabaseMock(handlers: Record<string, () => unknown>) {
  return (table: string) => {
    const handler = handlers[table];
    if (handler) return handler();
    return buildChain({ data: null, error: null });
  };
}

function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'insert', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  chain['then'] = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return chain;
}

/**
 * Builds an execution_logs table mock that distinguishes between the two
 * calls executePipeline makes to this table on the happy path:
 *   1. Running-execution check: .select().eq().eq().limit().maybeSingle()
 *   2. Create the execution row: .insert().select().single()
 * Returns a fresh handler each time `executePipeline` calls `.from('execution_logs')`.
 */
function buildExecutionLogsHandler(opts: {
  runningExec?: unknown;
  createdId?: string;
} = {}) {
  let callCount = 0;
  return () => {
    callCount++;
    if (callCount === 1) {
      // Running-execution check
      return buildChain({ data: opts.runningExec ?? null, error: null });
    }
    // Insert new execution_logs row — id is the generated executionId
    return buildChain({ data: { id: opts.createdId ?? 'exec-generated-id' }, error: null });
  };
}

describe('executePipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDecryptedSecret.mockResolvedValue('decrypted-secret');
    mockTriggerN8nWorkflow.mockResolvedValue({ executionId: 'exec-123' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns not_found when the pipeline does not exist', async () => {
    mockFrom.mockImplementation(
      makeSupabaseMock({
        pipelines: () => buildChain({ data: null, error: null }),
      }),
    );

    const result = await executePipeline(PIPELINE_ID);
    expect(result.outcome).toBe('not_found');
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('returns skipped when the pipeline status is not active', async () => {
    mockFrom.mockImplementation(
      makeSupabaseMock({
        pipelines: () => buildChain({ data: { ...activePipeline, status: 'paused' }, error: null }),
      }),
    );

    const result = await executePipeline(PIPELINE_ID);
    expect(result).toEqual({ outcome: 'skipped', reason: 'Pipeline is paused — execution skipped' });
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('returns skipped and inserts a skipped log when an execution is already running', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    let executionLogsCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') return buildChain({ data: activePipeline, error: null });
      if (table === 'execution_logs') {
        executionLogsCallCount++;
        if (executionLogsCallCount === 1) {
          // The running-execution check finds one
          return buildChain({ data: { id: 'exec-running' }, error: null });
        }
        // The skipped-log insert
        return { insert: insertMock };
      }
      return buildChain({ data: null, error: null });
    });

    const result = await executePipeline(PIPELINE_ID);

    expect(result).toEqual({ outcome: 'skipped', reason: 'skipped: already running' });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: PIPELINE_ID,
        user_id: USER_ID,
        status: 'skipped',
        failure_reason: 'skipped: already running',
      }),
    );
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('returns skipped when subscription is not active', async () => {
    mockFrom.mockImplementation(
      makeSupabaseMock({
        pipelines: () => buildChain({ data: activePipeline, error: null }),
        execution_logs: buildExecutionLogsHandler(),
        user_profiles: () => buildChain({ data: { subscription_status: 'inactive' }, error: null }),
      }),
    );

    const result = await executePipeline(PIPELINE_ID);
    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'Subscription is not active — execution skipped',
    });
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('decrypts credentials and triggers n8n for an active pipeline with active subscription', async () => {
    const execLogsHandler = buildExecutionLogsHandler({ createdId: 'exec-generated-id' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') return buildChain({ data: activePipeline, error: null });
      if (table === 'execution_logs') return execLogsHandler();
      if (table === 'user_profiles') {
        return buildChain({ data: { subscription_status: 'active' }, error: null });
      }
      if (table === 'credentials') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ credential_type: 'heygen_api_key', vault_secret_id: 'vault-1', status: 'active' }],
                error: null,
              }),
            }),
          }),
        };
      }
      return buildChain({ data: null, error: null });
    });

    const result = await executePipeline(PIPELINE_ID);

    // executionId now comes from the execution_logs row created up front,
    // not from triggerN8nWorkflow's return value (mocked as 'exec-123').
    expect(result).toEqual({ outcome: 'triggered', executionId: 'exec-generated-id' });
    expect(mockGetDecryptedSecret).toHaveBeenCalledWith('vault-1');
    expect(mockTriggerN8nWorkflow).toHaveBeenCalledWith(
      PIPELINE_ID, // n8n_workflow_id is null → falls back to pipelineId
      { heygen_api_key: 'decrypted-secret' },
      expect.objectContaining({
        pipeline_id: PIPELINE_ID,
        user_id: USER_ID,
        execution_id: 'exec-generated-id',
      }),
    );
  });

  it('returns error outcome when triggerN8nWorkflow throws', async () => {
    const execLogsHandler = buildExecutionLogsHandler();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') return buildChain({ data: activePipeline, error: null });
      if (table === 'execution_logs') return execLogsHandler();
      if (table === 'user_profiles') {
        return buildChain({ data: { subscription_status: 'active' }, error: null });
      }
      if (table === 'credentials') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      return buildChain({ data: null, error: null });
    });

    mockTriggerN8nWorkflow.mockRejectedValue(new Error('n8n unreachable'));

    const result = await executePipeline(PIPELINE_ID);
    expect(result.outcome).toBe('error');
  });

  it('creates the execution_logs row before calling n8n, and marks it failed if n8n trigger fails', async () => {
    const updateMock = vi.fn().mockResolvedValue({ data: null, error: null });
    let execLogsCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') return buildChain({ data: activePipeline, error: null });
      if (table === 'user_profiles') {
        return buildChain({ data: { subscription_status: 'active' }, error: null });
      }
      if (table === 'credentials') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === 'execution_logs') {
        execLogsCallCount++;
        if (execLogsCallCount === 1) {
          // Running-execution check — none running
          return buildChain({ data: null, error: null });
        }
        if (execLogsCallCount === 2) {
          // Create the execution row
          return buildChain({ data: { id: 'exec-abc' }, error: null });
        }
        // Failure update call
        return { update: updateMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) };
      }
      return buildChain({ data: null, error: null });
    });

    mockTriggerN8nWorkflow.mockRejectedValue(new Error('n8n unreachable'));

    const result = await executePipeline(PIPELINE_ID);

    expect(result.outcome).toBe('error');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failure_reason: expect.stringContaining('n8n unreachable'),
      }),
    );
  });

  it('returns error outcome when the pipeline query itself fails', async () => {
    mockFrom.mockImplementation(
      makeSupabaseMock({
        pipelines: () => buildChain({ data: null, error: { message: 'DB down' } }),
      }),
    );

    const result = await executePipeline(PIPELINE_ID);
    expect(result.outcome).toBe('error');
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });
});
