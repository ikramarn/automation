/**
 * Pipeline CRUD + trigger route tests.
 *
 * Uses app.inject() — no real HTTP server, no real Supabase or n8n calls.
 * Supabase admin client and n8n helpers are mocked via vi.mock().
 *
 * Covered routes:
 *   GET    /pipelines             — list pipelines
 *   GET    /pipelines/:id         — get pipeline detail
 *   PUT    /pipelines/:id         — update pipeline
 *   DELETE /pipelines/:id         — delete pipeline
 *   POST   /pipelines/:id/enable  — enable pipeline
 *   POST   /pipelines/:id/disable — disable pipeline
 *   POST   /pipelines/:id/trigger — manually trigger pipeline
 *
 * Requirements: 6.4, 6.5, 6.7, 6.8, 12.5, 12.6
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Mock Supabase admin client ───────────────────────────────────────────────
// mockFrom is defined at module scope so the vi.mock factory closure captures it.
// vi.mock is hoisted to the top of the file, but the factory runs lazily, so
// `mockFrom` is available by the time the factory executes.
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// ── Mock n8n ─────────────────────────────────────────────────────────────────
// Use vi.hoisted() so the variable is available inside the hoisted vi.mock factory.
const { mockTriggerN8nWorkflow } = vi.hoisted(() => ({
  mockTriggerN8nWorkflow: vi.fn().mockResolvedValue({ executionId: 'exec-999' }),
}));

vi.mock('../../lib/n8n.js', () => ({
  triggerN8nWorkflow: mockTriggerN8nWorkflow,
  createN8nWorkflow: vi.fn().mockResolvedValue('wf-test-123'),
  getN8nExecutionStatus: vi.fn().mockResolvedValue({ status: 'running' }),
}));

// ── Shared pipeline fixture ──────────────────────────────────────────────────
const PIPELINE_ID = 'pipe-00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-test-123';

const samplePipeline = {
  id: PIPELINE_ID,
  user_id: USER_ID,
  name: 'Tech News Daily',
  niche_keyword: 'AI technology',
  publishing_platforms: ['youtube'],
  schedule_recurrence: 'daily',
  schedule_time_hhmm: '09:00',
  schedule_timezone: 'America/New_York',
  schedule_days_of_week: null,
  schedule_cron_utc: '0 14 * * *',
  openai_model: 'gpt-4o-mini',
  heygen_avatar_id: 'avatar-123',
  video_language: 'en',
  script_tone: 'professional',
  target_duration_secs: 60,
  gdrive_folder_id: null,
  status: 'active',
  n8n_workflow_id: 'wf-test-123',
  last_execution_at: null,
  last_execution_status: null,
  consecutive_failures: 0,
  max_consecutive_failures: 3,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

// ── JWT helper ───────────────────────────────────────────────────────────────
let testJwt: string;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  testJwt = app.jwt.sign(
    {
      sub: USER_ID,
      email: 'test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

// ── CSRF helpers ─────────────────────────────────────────────────────────────
const CSRF_TOKEN = 'a'.repeat(64);
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'csrf_token';

function csrfHeaders(app: FastifyInstance): Record<string, string> {
  return { [CSRF_HEADER]: CSRF_TOKEN };
}

function csrfCookies(app: FastifyInstance): Record<string, string> {
  return { [CSRF_COOKIE_NAME]: app.signCookie(CSRF_TOKEN) };
}

// ── Supabase mock builder helpers ─────────────────────────────────────────────

/**
 * Builds a fluent Supabase query chain mock.
 *
 * All methods return `chain` (for chaining), and the chain itself is also a
 * thenable (implements `.then`) so that `await chain.method()` resolves with
 * `result`. Terminal helpers `.single()` and `.maybeSingle()` also resolve.
 */
function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'order', 'limit', 'maybeSingle', 'single', 'neq', 'in'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods resolve with result
  (chain['maybeSingle'] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (chain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  // Make the chain itself awaitable so `await supabase.from('x').select().eq().order()`
  // resolves with `result` (handles cases where order/limit is the last call before await).
  chain['then'] = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  return chain;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Pipeline CRUD routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'silent' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerN8nWorkflow.mockResolvedValue({ executionId: 'exec-999' });
  });

  // ── GET /pipelines ──────────────────────────────────────────────────────────

  describe('GET /pipelines', () => {
    it('returns 200 with array of pipelines', async () => {
      const token = await getTestJwt(app);

      const pipelines = [
        { ...samplePipeline, id: PIPELINE_ID },
        { ...samplePipeline, id: 'pipe-2', name: 'Finance Daily' },
      ];

      const chain = buildChain({ data: pipelines, error: null });
      mockFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<unknown[]>();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
    });

    it('returns 200 with empty array when user has no pipelines', async () => {
      const token = await getTestJwt(app);

      const chain = buildChain({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/pipelines',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({ method: 'GET', url: '/pipelines' });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /pipelines/:id ──────────────────────────────────────────────────────

  describe('GET /pipelines/:id', () => {
    it('returns 200 with full pipeline detail', async () => {
      const token = await getTestJwt(app);

      const chain = buildChain({ data: samplePipeline, error: null });
      mockFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ id: string; name: string }>();
      expect(body.id).toBe(PIPELINE_ID);
      expect(body.name).toBe('Tech News Daily');
    });

    it('returns 404 when pipeline does not exist or belongs to another user', async () => {
      const token = await getTestJwt(app);

      const chain = buildChain({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const response = await app.inject({
        method: 'GET',
        url: '/pipelines/nonexistent-id',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('not_found');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({ method: 'GET', url: `/pipelines/${PIPELINE_ID}` });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── PUT /pipelines/:id ──────────────────────────────────────────────────────

  describe('PUT /pipelines/:id', () => {
    it('returns 200 with updated pipeline when changing name', async () => {
      const token = await getTestJwt(app);
      const updated = { ...samplePipeline, name: 'Updated Name' };

      // First call: ownership check (maybeSingle)
      // Second call: update + select (single)
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null });
        return buildChain({ data: updated, error: null });
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ name: string }>();
      expect(body.name).toBe('Updated Name');
    });

    it('recomputes UTC cron when schedule fields change', async () => {
      const token = await getTestJwt(app);
      const updated = {
        ...samplePipeline,
        schedule_time_hhmm: '10:00',
        schedule_cron_utc: '0 15 * * *',
      };

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null });
        return buildChain({ data: updated, error: null });
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
        payload: {
          schedule_time_hhmm: '10:00',
          schedule_timezone: 'America/New_York',
          schedule_recurrence: 'daily',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 when schedule update uses invalid timezone', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: samplePipeline, error: null }));

      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
        payload: {
          schedule_time_hhmm: '10:00',
          schedule_timezone: 'Not/A/Timezone',
          schedule_recurrence: 'daily',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when pipeline does not exist', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: null, error: null }));

      const response = await app.inject({
        method: 'PUT',
        url: '/pipelines/nonexistent',
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when CSRF token is missing', async () => {
      const token = await getTestJwt(app);

      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: 'New Name' },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('csrf_token_invalid');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${PIPELINE_ID}`,
        payload: { name: 'New Name' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── DELETE /pipelines/:id ───────────────────────────────────────────────────

  describe('DELETE /pipelines/:id', () => {
    it('returns 200 and deletes pipeline when no running execution', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // ownership fetch
        if (callCount === 2) return buildChain({ data: null, error: null });           // running exec check
        return buildChain({ data: null, error: null });                                // delete
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toMatch(/deleted/i);
    });

    it('returns 200 with "marked for deletion" message when execution is running', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null });       // ownership fetch
        if (callCount === 2) return buildChain({ data: { id: 'exec-1' }, error: null });     // running exec found
        return buildChain({ data: null, error: null });                                      // status update
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/pipelines/${PIPELINE_ID}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toMatch(/execution/i);
    });

    it('returns 404 when pipeline does not exist', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: null, error: null }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/pipelines/nonexistent',
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/pipelines/${PIPELINE_ID}`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── POST /pipelines/:id/enable ──────────────────────────────────────────────

  describe('POST /pipelines/:id/enable', () => {
    it('returns 200 and sets status to active', async () => {
      const token = await getTestJwt(app);
      const enabledPipeline = { id: PIPELINE_ID, name: 'Tech News Daily', status: 'active' };

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // ownership check
        return buildChain({ data: enabledPipeline, error: null });                     // update
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/enable`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ pipeline: { status: string } }>();
      expect(body.pipeline.status).toBe('active');
    });

    it('returns 404 when pipeline does not exist', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: null, error: null }));

      const response = await app.inject({
        method: 'POST',
        url: '/pipelines/nonexistent/enable',
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/enable`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ── POST /pipelines/:id/disable ─────────────────────────────────────────────

  describe('POST /pipelines/:id/disable', () => {
    it('returns 200 and sets status to disabled', async () => {
      const token = await getTestJwt(app);
      const disabledPipeline = { id: PIPELINE_ID, name: 'Tech News Daily', status: 'disabled' };

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // ownership check
        if (callCount === 2) return buildChain({ data: null, error: null });            // running exec check
        return buildChain({ data: disabledPipeline, error: null });                    // update
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/disable`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ pipeline: { status: string } }>();
      expect(body.pipeline.status).toBe('disabled');
    });

    it('includes note when an execution is running at disable time', async () => {
      const token = await getTestJwt(app);
      const disabledPipeline = { id: PIPELINE_ID, name: 'Tech News Daily', status: 'disabled' };

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null });     // ownership
        if (callCount === 2) return buildChain({ data: { id: 'exec-1' }, error: null });  // running exec found
        return buildChain({ data: disabledPipeline, error: null });                       // update
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/disable`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ note?: string }>();
      expect(body.note).toBeTruthy();
      expect(body.note).toMatch(/execution/i);
    });

    it('returns 404 when pipeline does not exist', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: null, error: null }));

      const response = await app.inject({
        method: 'POST',
        url: '/pipelines/nonexistent/disable',
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── POST /pipelines/:id/trigger ─────────────────────────────────────────────

  describe('POST /pipelines/:id/trigger', () => {
    it('returns 200 and triggers execution for an active pipeline', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // pipeline fetch
        return buildChain({ data: null, error: null });                                // running exec check
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string }>();
      expect(body.message).toMatch(/triggered/i);
      expect(mockTriggerN8nWorkflow).toHaveBeenCalledOnce();
    });

    it('returns 403 when pipeline is paused', async () => {
      const token = await getTestJwt(app);
      const pausedPipeline = { ...samplePipeline, status: 'paused' };

      mockFrom.mockImplementation(() => buildChain({ data: pausedPipeline, error: null }));

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ message: string; error_code: string }>();
      expect(body.error_code).toBe('pipeline_not_active');
      expect(body.message).toMatch(/paused or disabled/i);
    });

    it('returns 403 when pipeline is disabled', async () => {
      const token = await getTestJwt(app);
      const disabledPipeline = { ...samplePipeline, status: 'disabled' };

      mockFrom.mockImplementation(() => buildChain({ data: disabledPipeline, error: null }));

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('pipeline_not_active');
    });

    it('returns 200 with skipped=true when an execution is already in progress', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null });    // pipeline fetch
        return buildChain({ data: { id: 'exec-running' }, error: null });                 // running exec found / insert
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ message: string; skipped: boolean }>();
      expect(body.skipped).toBe(true);
      expect(body.message).toMatch(/skipped/i);
    });

    it('returns 404 when pipeline does not exist', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation(() => buildChain({ data: null, error: null }));

      const response = await app.inject({
        method: 'POST',
        url: '/pipelines/nonexistent/trigger',
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when n8n trigger fails', async () => {
      const token = await getTestJwt(app);
      mockTriggerN8nWorkflow.mockRejectedValueOnce(new Error('n8n unreachable'));

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return buildChain({ data: samplePipeline, error: null }); // pipeline fetch
        return buildChain({ data: null, error: null });                                // running exec check
      });

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${PIPELINE_ID}/trigger`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...csrfHeaders(app),
        },
        cookies: csrfCookies(app),
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
