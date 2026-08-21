/**
 * Integration tests — n8n trigger and R2 lifecycle.
 *
 * Covers end-to-end interactions between pipeline routes and the n8n API:
 *   1. POST /pipelines (valid data) creates pipeline AND calls createN8nWorkflow
 *   2. POST /internal/trigger-pipeline (active pipeline, active subscription) calls triggerN8nWorkflow
 *   3. POST /internal/trigger-pipeline (paused pipeline) returns skipped=true, no n8n call
 *   4. POST /internal/trigger-pipeline (inactive subscription) returns skipped=true, no n8n call
 *   5. POST /internal/trigger-pipeline (no service token) returns 401
 *   6. POST /pipelines/:id/trigger (already running) creates skipped log, returns 200 skipped=true
 *   7. POST /pipelines/:id/disable calls n8n deactivate API (best-effort)
 *   8. POST /pipelines/:id/enable calls n8n activate API (best-effort)
 *
 * Mock strategy:
 *   - Supabase admin client mocked via vi.mock() — no real DB calls
 *   - global.fetch mocked via vi.stubGlobal() — intercepts both n8n workflow
 *     creation (createN8nWorkflow) and the best-effort activate/deactivate
 *     calls in toggle.ts
 *   - triggerN8nWorkflow (used inside the internal trigger route and the manual
 *     trigger route) is mocked so its internal fetch path is never hit, keeping
 *     assertions simple
 *
 * Requirements: 3.7, 6.1, 12.4, 12.5, 12.6, 12.8, 18.5
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
// Must be set before any module that reads env vars at import time.
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';
process.env['N8N_SERVICE_TOKEN'] = 'integration-service-token-abc';
// Set N8N_API_URL so the best-effort fetch calls in toggle.ts fire
process.env['N8N_API_URL'] = 'https://n8n.test.internal';
process.env['N8N_API_KEY'] = 'n8n-test-key';

// ── Supabase mock (module-level so vi.mock factory captures it) ───────────────
const mockFrom = vi.fn();

vi.mock('../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

// ── n8n mocks ─────────────────────────────────────────────────────────────────
// createN8nWorkflow is mocked at the module level.
// triggerN8nWorkflow is also mocked so the internal trigger route works without
// a real n8n server.
const { mockCreateN8nWorkflow, mockTriggerN8nWorkflow } = vi.hoisted(() => ({
  mockCreateN8nWorkflow: vi.fn().mockResolvedValue('wf-integration-123'),
  mockTriggerN8nWorkflow: vi.fn().mockResolvedValue({ executionId: 'exec-integration-456' }),
}));

vi.mock('../lib/n8n.js', () => ({
  createN8nWorkflow: mockCreateN8nWorkflow,
  triggerN8nWorkflow: mockTriggerN8nWorkflow,
  getN8nExecutionStatus: vi.fn().mockResolvedValue({ status: 'running' }),
}));

// ── Other mocks ───────────────────────────────────────────────────────────────
vi.mock('../lib/vault.js', () => ({
  getDecryptedSecret: vi.fn().mockResolvedValue('decrypted-api-key'),
  maskApiKey: vi.fn((k: string) => `••••${k.slice(-4)}`),
  maskValue: vi.fn((k: string) => `••••${k.slice(-4)}`),
}));

vi.mock('../lib/email.js', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Test constants ────────────────────────────────────────────────────────────
const SERVICE_TOKEN = 'integration-service-token-abc';
const USER_ID = 'user-int-test-001';
const PIPELINE_ID = 'pipe-int-test-00000000-0001';
const WORKFLOW_ID = 'wf-integration-123';

const samplePipeline = {
  id: PIPELINE_ID,
  user_id: USER_ID,
  name: 'Integration Test Pipeline',
  niche_keyword: 'tech integration',
  publishing_platforms: ['youtube'],
  schedule_recurrence: 'daily',
  schedule_time_hhmm: '09:00',
  schedule_timezone: 'America/New_York',
  schedule_days_of_week: null,
  schedule_cron_utc: '0 14 * * *',
  openai_model: 'gpt-4o-mini',
  heygen_avatar_id: 'avatar-int-001',
  video_language: 'en',
  script_tone: 'professional',
  target_duration_secs: 60,
  gdrive_folder_id: null,
  status: 'active',
  n8n_workflow_id: WORKFLOW_ID,
  last_execution_at: null,
  last_execution_status: null,
  consecutive_failures: 0,
  max_consecutive_failures: 3,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

// ── Chain helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a fully chainable Supabase query mock.
 * All methods return the chain; maybeSingle/single resolve with `result`.
 * The chain itself is thenable so `await chain.eq().order()` works too.
 */
function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'order', 'limit',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make chain awaitable (for bare `await supabase.from().select().eq()` usage)
  chain['then'] = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled);

  // Terminal query methods resolve with the provided result
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);

  return chain;
}

// ── JWT / CSRF helpers ────────────────────────────────────────────────────────

let testJwt: string | undefined;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  testJwt = app.jwt.sign(
    {
      sub: USER_ID,
      email: 'integration@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

const CSRF_TOKEN = 'b'.repeat(64);
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'csrf_token';

function csrfHeaders(): Record<string, string> {
  return { [CSRF_HEADER]: CSRF_TOKEN };
}

function csrfCookies(app: FastifyInstance): Record<string, string> {
  return { [CSRF_COOKIE_NAME]: app.signCookie(CSRF_TOKEN) };
}

// ── Shared app ────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logLevel: 'silent', prettyLogs: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock return values after clearAllMocks
  mockCreateN8nWorkflow.mockResolvedValue('wf-integration-123');
  mockTriggerN8nWorkflow.mockResolvedValue({ executionId: 'exec-integration-456' });
  testJwt = undefined; // Force re-sign so JWT is fresh
});

// ── Test 1: POST /pipelines creates pipeline AND calls createN8nWorkflow ──────

describe('Test 1 — POST /pipelines: creates pipeline AND creates n8n workflow', () => {
  it('calls createN8nWorkflow and returns 201 with n8n_workflow_id set', async () => {
    const createdPipeline = {
      id: PIPELINE_ID,
      user_id: USER_ID,
      name: 'Integration Test Pipeline',
      niche_keyword: 'AI technology',
      publishing_platforms: ['youtube'],
      schedule_recurrence: 'daily',
      schedule_time_hhmm: '09:00',
      schedule_timezone: 'America/New_York',
      schedule_cron_utc: '0 14 * * *',
      status: 'active',
      n8n_workflow_id: null, // before update
    };
    const updatedPipeline = { ...createdPipeline, n8n_workflow_id: 'wf-integration-123' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_profiles') {
        // pipeline_limit check
        return buildChain({ data: { pipeline_limit: 5 }, error: null });
      }
      if (table === 'pipelines') {
        // The create handler queries pipelines three times:
        //  1. count query (.select('id', { count: 'exact', head: true }).eq())
        //  2. insert().select().single()
        //  3. update().eq().select().single()
        let pipCallCount = 0;
        const pipChain: Record<string, unknown> = {};
        const buildCountChain = () => ({
          eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
        });
        const buildInsertChain = () => ({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: createdPipeline, error: null }),
          }),
        });
        const buildUpdateChain = () => ({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updatedPipeline, error: null }),
            }),
          }),
        });

        const selectMock = vi.fn().mockImplementation(
          (_cols: unknown, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact') return buildCountChain();
            return buildChain({ data: null, error: null });
          },
        );

        return {
          select: selectMock,
          insert: vi.fn().mockReturnValue(buildInsertChain()),
          update: vi.fn().mockReturnValue(buildUpdateChain()),
        };
      }
      if (table === 'credentials') {
        // HeyGen API key exists
        return buildChain({ data: { id: 'cred-heygen-001' }, error: null });
      }
      return buildChain({ data: null, error: null });
    });

    const token = await getTestJwt(app);
    const csrf = csrfCookies(app);

    const response = await app.inject({
      method: 'POST',
      url: '/pipelines',
      headers: {
        Authorization: `Bearer ${token}`,
        ...csrfHeaders(),
        'Content-Type': 'application/json',
      },
      cookies: csrf,
      payload: {
        name: 'Integration Test Pipeline',
        niche_keyword: 'AI technology',
        publishing_platforms: ['youtube'],
        schedule_recurrence: 'daily',
        schedule_time_hhmm: '09:00',
        schedule_timezone: 'America/New_York',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; n8n_workflow_id: string }>();
    expect(body.id).toBe(PIPELINE_ID);
    expect(body.n8n_workflow_id).toBe('wf-integration-123');

    // createN8nWorkflow must have been called with the pipeline ID and a cron expression
    expect(mockCreateN8nWorkflow).toHaveBeenCalledOnce();
    expect(mockCreateN8nWorkflow).toHaveBeenCalledWith(
      PIPELINE_ID,
      expect.stringMatching(/^\d+ \d+ \* \* \*/), // UTC cron format
    );
  });
});

// ── Test 2: /internal/trigger-pipeline — active pipeline + active subscription ─

describe('Test 2 — POST /internal/trigger-pipeline: active pipeline, active subscription calls triggerN8nWorkflow', () => {
  it('returns 200 with executionId and calls triggerN8nWorkflow', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') {
        return buildChain({ data: samplePipeline, error: null });
      }
      if (table === 'user_profiles') {
        return buildChain({ data: { subscription_status: 'active' }, error: null });
      }
      if (table === 'credentials') {
        // Return chained eq().eq() for the credential query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { credential_type: 'heygen_api_key', vault_secret_id: 'vault-uuid-1', status: 'active' },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      return buildChain({ data: null, error: null });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ executionId: string; message: string }>();
    expect(body.executionId).toBe('exec-integration-456');

    expect(mockTriggerN8nWorkflow).toHaveBeenCalledOnce();
    expect(mockTriggerN8nWorkflow).toHaveBeenCalledWith(
      WORKFLOW_ID,
      expect.objectContaining({ heygen_api_key: 'decrypted-api-key' }),
      expect.objectContaining({ pipeline_id: PIPELINE_ID }),
    );
  });
});

// ── Test 3: /internal/trigger-pipeline — paused pipeline → skipped ────────────

describe('Test 3 — POST /internal/trigger-pipeline: paused pipeline returns skipped=true, no n8n call', () => {
  it('returns 200 skipped=true and does NOT call triggerN8nWorkflow', async () => {
    const pausedPipeline = { ...samplePipeline, status: 'paused' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') {
        return buildChain({ data: pausedPipeline, error: null });
      }
      return buildChain({ data: null, error: null });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ skipped: boolean; message: string }>();
    expect(body.skipped).toBe(true);
    expect(body.message).toMatch(/paused/i);

    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });
});

// ── Test 4: /internal/trigger-pipeline — inactive subscription → skipped ──────

describe('Test 4 — POST /internal/trigger-pipeline: inactive subscription returns skipped=true, no n8n call', () => {
  it('returns 200 skipped=true when subscription_status is not active', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pipelines') {
        return buildChain({ data: samplePipeline, error: null });
      }
      if (table === 'user_profiles') {
        return buildChain({ data: { subscription_status: 'expired' }, error: null });
      }
      return buildChain({ data: null, error: null });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ skipped: boolean }>();
    expect(body.skipped).toBe(true);

    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });
});

// ── Test 5: /internal/trigger-pipeline — no service token → 401 ──────────────

describe('Test 5 — POST /internal/trigger-pipeline: missing/wrong service token returns 401', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: { 'Content-Type': 'application/json' },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error_code: 'unauthorized' });
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('returns 401 when a wrong token is supplied', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: {
        Authorization: 'Bearer wrong-token-xyz',
        'Content-Type': 'application/json',
      },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();
  });

  it('returns 401 when using a non-Bearer scheme', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/trigger-pipeline',
      headers: {
        Authorization: `Basic ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      payload: { pipeline_id: PIPELINE_ID },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ── Test 6: POST /pipelines/:id/trigger — already running → skipped log ───────

describe('Test 6 — POST /pipelines/:id/trigger: already-running guard creates skipped log', () => {
  it('returns 200 skipped=true and inserts a skipped execution_logs record', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      fromCallCount++;
      if (table === 'pipelines') {
        // Called by the trigger route for ownership+status check
        return buildChain({ data: samplePipeline, error: null });
      }
      if (table === 'execution_logs') {
        // First call: check for running execution (returns a running one)
        // Subsequent calls: insert the skipped log record (from recordSkippedExecution)
        const callIndex = fromCallCount;
        return {
          select: vi.fn().mockReturnValue(
            buildChain({ data: { id: 'exec-running-001' }, error: null }),
          ),
          insert: insertMock,
        };
      }
      return buildChain({ data: null, error: null });
    });

    const token = await getTestJwt(app);

    const response = await app.inject({
      method: 'POST',
      url: `/pipelines/${PIPELINE_ID}/trigger`,
      headers: {
        Authorization: `Bearer ${token}`,
        ...csrfHeaders(),
      },
      cookies: csrfCookies(app),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ skipped: boolean; message: string }>();
    expect(body.skipped).toBe(true);
    expect(body.message).toMatch(/skipped/i);

    // triggerN8nWorkflow must NOT have been called (we skipped due to running execution)
    expect(mockTriggerN8nWorkflow).not.toHaveBeenCalled();

    // The skipped execution log insert must have happened
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: PIPELINE_ID,
        user_id: USER_ID,
        status: 'skipped',
        failure_reason: 'skipped: already running',
      }),
    );
  });
});

// ── Test 7: POST /pipelines/:id/disable → calls n8n deactivate API ────────────

describe('Test 7 — POST /pipelines/:id/disable: calls n8n deactivate API (best-effort)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Stub global fetch to capture best-effort n8n calls
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  it('fires a best-effort POST to the n8n deactivate endpoint', async () => {
    const disabledPipeline = { ...samplePipeline, status: 'disabled' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'pipelines') {
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // ownership check
        return buildChain({ data: disabledPipeline, error: null });                   // update
      }
      if (table === 'execution_logs') {
        return buildChain({ data: null, error: null }); // no running execution
      }
      return buildChain({ data: null, error: null });
    });

    const token = await getTestJwt(app);

    const response = await app.inject({
      method: 'POST',
      url: `/pipelines/${PIPELINE_ID}/disable`,
      headers: {
        Authorization: `Bearer ${token}`,
        ...csrfHeaders(),
      },
      cookies: csrfCookies(app),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ pipeline: { status: string } }>();
    expect(body.pipeline.status).toBe('disabled');

    // Allow the fire-and-forget fetch to settle (it's not awaited in the handler)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify n8n deactivate was called
    const deactivateCalls = fetchSpy.mock.calls.filter(
      ([url]: [string]) =>
        typeof url === 'string' && url.includes(`/workflows/${WORKFLOW_ID}/deactivate`),
    );
    expect(deactivateCalls).toHaveLength(1);
    expect(deactivateCalls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'X-N8N-API-KEY': 'n8n-test-key' }),
    });
  });
});

// ── Test 8: POST /pipelines/:id/enable → calls n8n activate API ──────────────

describe('Test 8 — POST /pipelines/:id/enable: calls n8n activate API (best-effort)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  it('fires a best-effort POST to the n8n activate endpoint', async () => {
    const enabledPipeline = { ...samplePipeline, status: 'active' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'pipelines') {
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // ownership check
        return buildChain({ data: enabledPipeline, error: null });                     // update
      }
      return buildChain({ data: null, error: null });
    });

    // resetConsecutiveFailures also calls supabase — already handled by the default
    // buildChain fallthrough above

    const token = await getTestJwt(app);

    const response = await app.inject({
      method: 'POST',
      url: `/pipelines/${PIPELINE_ID}/enable`,
      headers: {
        Authorization: `Bearer ${token}`,
        ...csrfHeaders(),
      },
      cookies: csrfCookies(app),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ pipeline: { status: string } }>();
    expect(body.pipeline.status).toBe('active');

    // Allow the fire-and-forget fetch to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify n8n activate was called
    const activateCalls = fetchSpy.mock.calls.filter(
      ([url]: [string]) =>
        typeof url === 'string' && url.includes(`/workflows/${WORKFLOW_ID}/activate`),
    );
    expect(activateCalls).toHaveLength(1);
    expect(activateCalls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'X-N8N-API-KEY': 'n8n-test-key' }),
    });
  });
});
