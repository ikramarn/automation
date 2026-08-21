/**
 * Tests for internal service-token-protected routes.
 *
 * Strategy: build a minimal Fastify app (without JWT plugin) that registers
 * the internal routes under `/internal`. Each test sends requests with or
 * without a valid `N8N_SERVICE_TOKEN` to verify auth and business logic.
 *
 * All Supabase / vault / n8n calls are mocked via vi.mock() so tests run
 * without external services.
 *
 * Requirements: 3.7, 12.8, 14.1, 14.2, 14.3, 14.4, 18.5
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../errors/errorHandler.js';
import { internalRoutes } from './index.js';

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../lib/vault.js', () => ({
  getDecryptedSecret: vi.fn(),
  maskApiKey: vi.fn((k: string) => `••••${k.slice(-4)}`),
  maskValue: vi.fn((k: string) => `••••${k.slice(-4)}`),
}));

vi.mock('../../lib/n8n.js', () => ({
  triggerN8nWorkflow: vi.fn(),
}));

vi.mock('../../lib/email.js', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Import mocked modules ─────────────────────────────────────────────────────

import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { getDecryptedSecret } from '../../lib/vault.js';
import { triggerN8nWorkflow } from '../../lib/n8n.js';
import { sendTransactionalEmail } from '../../lib/email.js';

// ── Test constants ────────────────────────────────────────────────────────────

const VALID_TOKEN = 'test-service-token-abc123';
const WRONG_TOKEN = 'wrong-token-xyz';

// ── App builder ───────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(internalRoutes, { prefix: '/internal' });
  await app.ready();
  return app;
}

// ── Supabase mock builder ─────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock that allows configuring responses
 * per-table per-call.
 */
function makeMockSupabase(tableResponses: Record<string, { data: unknown; error: unknown }>) {
  const client = {
    from: vi.fn((table: string) => {
      const response = tableResponses[table] ?? { data: null, error: null };
      const chain = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(response),
        // update chain terminates with the response directly
        then: undefined as unknown,
      };
      // Allow update().eq() to resolve
      chain.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(response),
        }),
      });
      return chain;
    }),
  };
  return client;
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('Service token middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['N8N_SERVICE_TOKEN'] = VALID_TOKEN;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('missing Authorization header → 401 { error_code: "unauthorized" }', async () => {
    // Use a valid body to avoid schema rejection before auth runs
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notify',
      payload: { user_id: 'uid', status: 'success' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'unauthorized' });
  });

  it('wrong Bearer token → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notify',
      headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      payload: { user_id: 'uid', status: 'success' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'unauthorized' });
  });

  it('non-Bearer scheme → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notify',
      headers: { authorization: `Basic ${VALID_TOKEN}` },
      payload: { user_id: 'uid', status: 'success' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid Bearer token passes auth check', async () => {
    // We just need to reach the handler — mock Supabase to handle the request
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/notify',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { user_id: 'uid', status: 'success' },
    });

    // 200 (user not found → graceful skip) confirms auth passed
    expect(res.statusCode).toBe(200);
  });
});

// ── POST /internal/notify ─────────────────────────────────────────────────────

describe('POST /internal/notify', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['N8N_SERVICE_TOKEN'] = VALID_TOKEN;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function inject(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/internal/notify',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload,
    });
  }

  it('missing user_id → 400 validation error', async () => {
    const res = await inject({ status: 'success' });
    expect(res.statusCode).toBe(400);
  });

  it('missing status → 400 validation error', async () => {
    const res = await inject({ user_id: 'uid' });
    expect(res.statusCode).toBe(400);
  });

  it('unknown status → 200, no email sent', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { email: 'user@example.com' },
          error: null,
        }),
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ user_id: 'uid', status: 'running' });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).not.toHaveBeenCalled();
  });

  it('status=success, notify_on_success=true → sends execution-success email', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'user@example.com' },
              error: null,
            }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                notify_on_success: true,
                notify_on_failure: true,
                notify_on_pipeline_paused: true,
              },
              error: null,
            }),
          };
        }
        // pipelines
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { name: 'My Pipeline' },
            error: null,
          }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({
      user_id: 'uid',
      status: 'success',
      pipeline_id: 'pipe-1',
      execution_id: 'exec-1',
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).toHaveBeenCalledWith(
      'execution-success',
      'user@example.com',
      expect.objectContaining({ pipeline_name: 'My Pipeline' }),
    );
  });

  it('status=success, notify_on_success=false → skips email', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'user@example.com' },
              error: null,
            }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                notify_on_success: false,
                notify_on_failure: true,
                notify_on_pipeline_paused: true,
              },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ user_id: 'uid', status: 'success', pipeline_id: 'pipe-1' });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).not.toHaveBeenCalled();
  });

  it('status=failed → sends execution-failure email', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'user@example.com' },
              error: null,
            }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { notify_on_success: true, notify_on_failure: true, notify_on_pipeline_paused: true },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Pipe' }, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({
      user_id: 'uid',
      status: 'failed',
      pipeline_id: 'pipe-1',
      failure_reason: 'HeyGen API timeout',
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).toHaveBeenCalledWith(
      'execution-failure',
      'user@example.com',
      expect.objectContaining({ failure_reason: 'HeyGen API timeout' }),
    );
  });

  it('explicit type field overrides status derivation', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'user@example.com' },
              error: null,
            }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { notify_on_success: true, notify_on_failure: true, notify_on_pipeline_paused: true },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Pipe' }, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    // status=success but type overrides to execution-failure
    const res = await inject({
      user_id: 'uid',
      status: 'success',
      type: 'execution-failure',
      pipeline_id: 'pipe-1',
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).toHaveBeenCalledWith(
      'execution-failure',
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ── POST /internal/pipeline-paused ───────────────────────────────────────────

describe('POST /internal/pipeline-paused', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['N8N_SERVICE_TOKEN'] = VALID_TOKEN;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function inject(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/internal/pipeline-paused',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload,
    });
  }

  it('missing pipeline_id → 400', async () => {
    const res = await inject({ user_id: 'uid', consecutive_failures: 3 });
    expect(res.statusCode).toBe(400);
  });

  it('missing consecutive_failures → 400', async () => {
    const res = await inject({ pipeline_id: 'pipe-1', user_id: 'uid' });
    expect(res.statusCode).toBe(400);
  });

  it('updates pipeline to paused and sends email', async () => {
    const mockUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };

    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            update: vi.fn().mockReturnValue(mockUpdateChain),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'My Pipeline' }, error: null }),
          };
        }
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { email: 'user@example.com' }, error: null }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { notify_on_pipeline_paused: true },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({
      pipeline_id: 'pipe-1',
      user_id: 'uid',
      consecutive_failures: 3,
      last_failure_reason: 'OpenAI quota exceeded',
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).toHaveBeenCalledWith(
      'pipeline-paused',
      'user@example.com',
      expect.objectContaining({
        consecutive_failures: '3',
        last_failure_reason: 'OpenAI quota exceeded',
      }),
    );
  });

  it('notify_on_pipeline_paused=false → skips email but still returns 200', async () => {
    const mockUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };

    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            update: vi.fn().mockReturnValue(mockUpdateChain),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Pipe' }, error: null }),
          };
        }
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { email: 'user@example.com' }, error: null }),
          };
        }
        if (table === 'notification_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { notify_on_pipeline_paused: false },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({
      pipeline_id: 'pipe-1',
      user_id: 'uid',
      consecutive_failures: 3,
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sendTransactionalEmail)).not.toHaveBeenCalled();
  });
});

// ── POST /internal/trigger-pipeline ──────────────────────────────────────────

describe('POST /internal/trigger-pipeline', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['N8N_SERVICE_TOKEN'] = VALID_TOKEN;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triggerN8nWorkflow).mockResolvedValue({ executionId: 'exec-123' });
    vi.mocked(getDecryptedSecret).mockResolvedValue('decrypted-api-key');
  });

  function inject(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload,
    });
  }

  it('missing pipeline_id → 400', async () => {
    const res = await inject({});
    expect(res.statusCode).toBe(400);
  });

  it('pipeline not found → 404', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ pipeline_id: 'nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('pipeline status=paused → 200 skipped', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'pipe-1',
            user_id: 'uid',
            status: 'paused',
            n8n_workflow_id: 'wf-1',
            name: 'Pipe',
            niche_keyword: 'AI news',
            publishing_platforms: [],
            schedule_cron_utc: '0 14 * * *',
          },
          error: null,
        }),
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ pipeline_id: 'pipe-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ skipped: boolean }>();
    expect(body.skipped).toBe(true);
    expect(vi.mocked(triggerN8nWorkflow)).not.toHaveBeenCalled();
  });

  it('subscription inactive → 200 skipped', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'pipe-1',
                user_id: 'uid',
                status: 'active',
                n8n_workflow_id: 'wf-1',
                name: 'Pipe',
                niche_keyword: 'AI',
                publishing_platforms: [],
                schedule_cron_utc: '0 10 * * *',
              },
              error: null,
            }),
          };
        }
        // user_profiles
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { subscription_status: 'inactive' },
            error: null,
          }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ pipeline_id: 'pipe-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ skipped: boolean }>().skipped).toBe(true);
    expect(vi.mocked(triggerN8nWorkflow)).not.toHaveBeenCalled();
  });

  it('active pipeline + active subscription → triggers n8n and returns executionId', async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'pipe-1',
                user_id: 'uid',
                status: 'active',
                n8n_workflow_id: 'wf-abc',
                name: 'My Pipeline',
                niche_keyword: 'tech news',
                publishing_platforms: ['youtube', 'tiktok'],
                schedule_cron_utc: '0 12 * * *',
              },
              error: null,
            }),
          };
        }
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { subscription_status: 'active' },
              error: null,
            }),
          };
        }
        // credentials table
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          // Return resolved value for chained .eq().eq()
          then: undefined,
          // Simulate the final result
          [Symbol.asyncIterator]: undefined,
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    // credentials query returns active rows
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'pipe-1',
                user_id: 'uid',
                status: 'active',
                n8n_workflow_id: 'wf-abc',
                name: 'My Pipeline',
                niche_keyword: 'tech news',
                publishing_platforms: ['youtube'],
                schedule_cron_utc: '0 12 * * *',
              },
              error: null,
            }),
          };
        }
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { subscription_status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'credentials') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { credential_type: 'heygen_api_key', vault_secret_id: 'vault-uuid-1', status: 'active' },
                ],
                error: null,
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ pipeline_id: 'pipe-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ executionId: string; message: string }>();
    expect(body.executionId).toBe('exec-123');
    expect(vi.mocked(triggerN8nWorkflow)).toHaveBeenCalledWith(
      'wf-abc',
      expect.objectContaining({ heygen_api_key: 'decrypted-api-key' }),
      expect.objectContaining({ pipeline_id: 'pipe-1' }),
    );
  });

  it('n8n trigger failure → 500 internal error', async () => {
    vi.mocked(triggerN8nWorkflow).mockRejectedValue(new Error('n8n connection refused'));

    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pipelines') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'pipe-2',
                user_id: 'uid',
                status: 'active',
                n8n_workflow_id: 'wf-xyz',
                name: 'Pipe',
                niche_keyword: 'kw',
                publishing_platforms: [],
                schedule_cron_utc: '0 9 * * *',
              },
              error: null,
            }),
          };
        }
        if (table === 'user_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { subscription_status: 'active' },
              error: null,
            }),
          };
        }
        if (table === 'credentials') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const res = await inject({ pipeline_id: 'pipe-2' });
    expect(res.statusCode).toBe(500);
  });
});
