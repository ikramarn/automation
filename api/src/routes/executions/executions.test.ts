/**
 * Execution route tests.
 *
 * Tests use Fastify's app.inject() — no real HTTP server and no real Supabase
 * connection. Supabase is mocked via vi.mock() so each test controls responses.
 *
 * Covered scenarios:
 *   GET /pipelines/:id/executions          → 200 with paginated results
 *   GET /pipelines/:id/executions?page=2   → 200 with correct offset (page 2)
 *   GET /pipelines/nonexistent/executions  → 404 when pipeline not found
 *   GET /pipelines/:id/executions          → 401 on missing auth
 *   GET /executions/:id                    → 200 with full execution detail
 *   GET /executions/:id                    → 404 when execution not found
 *   GET /executions/:id                    → 200 with ended_at = "in progress"
 *   GET /executions/:id                    → 200 with formatted failure_reason
 *   GET /executions/:id                    → 401 on missing auth
 *
 * Requirements: 13.3, 13.4
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
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PIPELINE_ID = '00000000-0000-0000-0000-000000000002';
const TEST_EXEC_ID = '00000000-0000-0000-0000-000000000003';

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeExecutionSummary(index: number) {
  return {
    id: `00000000-0000-0000-0000-0000000000${String(index).padStart(2, '0')}`,
    pipeline_id: TEST_PIPELINE_ID,
    status: 'success',
    started_at: `2024-01-${String(15 - index).padStart(2, '0')}T10:00:00Z`,
    ended_at: `2024-01-${String(15 - index).padStart(2, '0')}T10:05:00Z`,
    duration_ms: 300000,
    failure_reason: null,
    created_at: `2024-01-${String(15 - index).padStart(2, '0')}T10:00:00Z`,
  };
}

const mockExecutionSummary = makeExecutionSummary(0);

const mockExecutionFull = {
  id: TEST_EXEC_ID,
  pipeline_id: TEST_PIPELINE_ID,
  user_id: TEST_USER_ID,
  status: 'success',
  started_at: '2024-01-15T10:00:00Z',
  ended_at: '2024-01-15T10:05:00Z',
  duration_ms: 300000,
  failure_reason: null,
  content_fetch_status: 'success',
  content_fetch_article_url: 'https://example.com/article',
  content_fetch_error: null,
  script_gen_status: 'success',
  script_text: 'This is the generated script text.',
  script_gen_error: null,
  video_gen_status: 'success',
  heygen_video_id: 'heygen-vid-001',
  r2_object_key: 'videos/test-video.mp4',
  video_file_size_bytes: 5000000,
  video_gen_error: null,
  drive_upload_status: 'success',
  gdrive_file_id: 'gdrive-file-001',
  gdrive_link: 'https://drive.google.com/file/d/gdrive-file-001',
  drive_upload_error: null,
  social_publish_results: {
    youtube: { status: 'success', post_id: 'yt-001' },
  },
  created_at: '2024-01-15T10:00:00Z',
};

const mockPipeline = { id: TEST_PIPELINE_ID };

// ── Helper: build a fluent Supabase chain ─────────────────────────────────────

/**
 * Creates a chainable mock for select queries that end with .maybeSingle() or .single().
 */
function buildSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};

  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['order'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockReturnValue(chain);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);

  return chain;
}

/**
 * Creates a chainable mock for array-returning queries (ends with .limit()).
 */
function buildArrayChain(result: { data: unknown[]; error: unknown }) {
  const chain: Record<string, unknown> = {};

  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['order'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(result);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);

  return chain;
}

// ── Helper: JWT ───────────────────────────────────────────────────────────────
let testJwt: string;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  testJwt = app.jwt.sign(
    {
      sub: TEST_USER_ID,
      email: 'test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Execution routes', () => {
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
  });

  // ── GET /pipelines/:id/executions ─────────────────────────────────────────

  describe('GET /pipelines/:id/executions', () => {
    it('returns 200 with paginated execution results', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          // Pipeline ownership check
          return buildSelectChain({ data: mockPipeline, error: null });
        }
        // Execution history array query
        return buildArrayChain({ data: [mockExecutionSummary], error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${TEST_PIPELINE_ID}/executions`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        data: unknown[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(10);
      expect(body.totalPages).toBe(1);
    });

    it('returns correct page 2 offset when 15 executions exist', async () => {
      const token = await getTestJwt(app);

      // Build 15 execution summaries (page 1 = items 0-9, page 2 = items 10-14)
      const fifteenExecutions = Array.from({ length: 15 }, (_, i) => makeExecutionSummary(i));

      let callCount = 0;
      mockFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          return buildSelectChain({ data: mockPipeline, error: null });
        }
        return buildArrayChain({ data: fifteenExecutions, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${TEST_PIPELINE_ID}/executions?page=2`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        data: unknown[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>();
      expect(body.page).toBe(2);
      expect(body.total).toBe(15);
      expect(body.pageSize).toBe(10);
      expect(body.totalPages).toBe(2);
      // Page 2 should have the remaining 5 items
      expect(body.data).toHaveLength(5);
    });

    it('returns 404 when pipeline is not found or not owned by user', async () => {
      const token = await getTestJwt(app);

      // Pipeline query returns null → not found / not owned
      mockFrom.mockImplementation((_table: string) => {
        return buildSelectChain({ data: null, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${TEST_PIPELINE_ID}/executions`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('not_found');
    });

    it('returns 200 with empty data array when no executions exist', async () => {
      const token = await getTestJwt(app);

      let callCount = 0;
      mockFrom.mockImplementation((_table: string) => {
        callCount++;
        if (callCount === 1) {
          return buildSelectChain({ data: mockPipeline, error: null });
        }
        return buildArrayChain({ data: [], error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${TEST_PIPELINE_ID}/executions`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: unknown[]; total: number }>();
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${TEST_PIPELINE_ID}/executions`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /executions/:id ───────────────────────────────────────────────────

  describe('GET /executions/:id', () => {
    it('returns 200 with full execution detail', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation((_table: string) => {
        return buildSelectChain({ data: mockExecutionFull, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/executions/${TEST_EXEC_ID}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        id: string;
        pipeline_id: string;
        status: string;
        ended_at: string;
        script_text: string;
        video_link: string;
        step_statuses: {
          content_fetch: string | null;
          script_generation: string | null;
          video_generation: string | null;
          drive_upload: string | null;
          social_publish: unknown;
        };
      }>();

      expect(body.id).toBe(TEST_EXEC_ID);
      expect(body.pipeline_id).toBe(TEST_PIPELINE_ID);
      expect(body.status).toBe('success');
      expect(body.ended_at).toBe('2024-01-15T10:05:00Z');
      expect(body.script_text).toBe('This is the generated script text.');
      expect(body.video_link).toBe('https://drive.google.com/file/d/gdrive-file-001');
      expect(body.step_statuses).toBeDefined();
      expect(body.step_statuses.social_publish).toEqual({
        youtube: { status: 'success', post_id: 'yt-001' },
      });
    });

    it('returns 404 when execution is not found', async () => {
      const token = await getTestJwt(app);

      mockFrom.mockImplementation((_table: string) => {
        return buildSelectChain({ data: null, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/executions/${TEST_EXEC_ID}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ error_code: string }>();
      expect(body.error_code).toBe('not_found');
    });

    it('returns 200 with ended_at = "in progress" when execution has not ended', async () => {
      const token = await getTestJwt(app);

      const inProgressExecution = {
        ...mockExecutionFull,
        status: 'running',
        ended_at: null,
        duration_ms: null,
      };

      mockFrom.mockImplementation((_table: string) => {
        return buildSelectChain({ data: inProgressExecution, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/executions/${TEST_EXEC_ID}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ended_at: string; status: string }>();
      expect(body.ended_at).toBe('in progress');
      expect(body.status).toBe('running');
    });

    it('returns 200 with failure_reason formatted as "[step name]: [error description]"', async () => {
      const token = await getTestJwt(app);

      const failedExecution = {
        ...mockExecutionFull,
        status: 'failed',
        ended_at: '2024-01-15T10:02:00Z',
        content_fetch_error: null,
        script_gen_error: 'OpenAI rate limit exceeded',
        failure_reason: 'script generation failed',
      };

      mockFrom.mockImplementation((_table: string) => {
        return buildSelectChain({ data: failedExecution, error: null });
      });

      const response = await app.inject({
        method: 'GET',
        url: `/executions/${TEST_EXEC_ID}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ failure_reason: string }>();
      // Must be formatted as "[step name]: [error description]"
      expect(body.failure_reason).toBe('script generation: OpenAI rate limit exceeded');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/executions/${TEST_EXEC_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
