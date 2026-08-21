/**
 * Property-based tests for pipeline creation limit enforcement (Property 12).
 *
 * **Validates: Requirements 6.1**
 *
 * Uses fast-check to verify that:
 *   - Property A: When currentCount === limit, a new creation attempt always → 403
 *     with the exact required message.
 *   - Property B: When currentCount < limit, a new creation attempt always → 201.
 *   - Property C: The 403 response body `message` field is an exact string match,
 *     not a substring match.
 *   - Property D: After a rejected 403, no `insert` was called on the pipelines table.
 *
 * Mirrors the Supabase-mock + CSRF-token helper patterns from pipelines.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ── Environment setup ────────────────────────────────────────────────────────
process.env['SUPABASE_JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env['COOKIE_SECRET'] = 'test-cookie-secret-at-least-32-characters';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['NODE_ENV'] = 'test';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Mock n8n client ──────────────────────────────────────────────────────────
vi.mock('../../lib/n8n.js', () => ({
  createN8nWorkflow: vi.fn().mockResolvedValue('n8n-workflow-test-id'),
}));

// ── Mock Supabase admin client ───────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// ── Test data ────────────────────────────────────────────────────────────────

const VALID_PIPELINE_BODY = {
  name: 'Tech News Daily',
  niche_keyword: 'artificial intelligence',
  publishing_platforms: ['youtube'],
  schedule_recurrence: 'daily',
  schedule_time_hhmm: '09:00',
  schedule_timezone: 'America/New_York',
};

const CREATED_PIPELINE = {
  id: 'pipeline-uuid-123',
  user_id: 'user-test-123',
  name: 'Tech News Daily',
  niche_keyword: 'artificial intelligence',
  publishing_platforms: ['youtube'],
  schedule_recurrence: 'daily',
  schedule_time_hhmm: '09:00',
  schedule_timezone: 'America/New_York',
  schedule_cron_utc: '0 14 * * *',
  status: 'active',
  n8n_workflow_id: 'n8n-workflow-test-id',
  created_at: '2024-01-15T09:00:00Z',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a signed JWT for the test user. */
function getTestJwt(app: FastifyInstance): string {
  return app.jwt.sign(
    {
      sub: 'user-test-123',
      email: 'test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
}

/** Create a CSRF token pair (signed cookie + raw header value). */
function getCsrfTokenPair(app: FastifyInstance): { cookie: string; header: string } {
  const token = 'test-csrf-token-' + Math.random().toString(36).slice(2);
  const signed = app.signCookie(token);
  return { cookie: `csrf_token=${signed}`, header: token };
}

// ── Supabase mock helpers ─────────────────────────────────────────────────────

function buildEqChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(resolvedValue),
    maybeSingle: vi.fn().mockResolvedValue(resolvedValue),
  };
  (chain['eq'] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

function buildCredentialsChain(singleData: unknown) {
  const result = { data: singleData, error: null };
  const eqChain: Record<string, unknown> = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  (eqChain['eq'] as ReturnType<typeof vi.fn>).mockReturnValue(eqChain);
  return { select: vi.fn().mockReturnValue(eqChain) };
}

/**
 * Build a mock for the `pipelines` table with a tracked `insertMock`.
 *
 * @param pipelineLimit  The value returned in user_profiles.pipeline_limit.
 * @param currentCount   The count returned by the count query.
 */
function setupMocksWithCount(
  pipelineLimit: number,
  currentCount: number,
): { insertMock: ReturnType<typeof vi.fn> } {
  const insertMock = vi.fn();

  // insert() chain: .insert(...).select().single() → returns CREATED_PIPELINE
  const insertSelectChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: CREATED_PIPELINE, error: null }),
    }),
  };
  insertMock.mockReturnValue(insertSelectChain);

  // update() chain for writing n8n_workflow_id back
  const updateSelectChain = {
    single: vi.fn().mockResolvedValue({ data: CREATED_PIPELINE, error: null }),
  };
  const updateEqChain = {
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(updateSelectChain),
    }),
  };

  // select() on pipelines:
  //   - with { count: 'exact', head: true }  → count query
  //   - otherwise                             → generic
  const pipelinesSelectMock = vi.fn().mockImplementation(
    (_cols: unknown, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === 'exact') {
        const eqForCount = { eq: vi.fn() };
        (eqForCount['eq'] as ReturnType<typeof vi.fn>).mockResolvedValue({
          count: currentCount,
          error: null,
        });
        return eqForCount;
      }
      return buildEqChain({ data: null, error: null });
    },
  );

  mockFrom.mockImplementation((table: string) => {
    if (table === 'user_profiles') {
      return {
        select: vi.fn().mockReturnValue(
          buildEqChain({ data: { pipeline_limit: pipelineLimit }, error: null }),
        ),
      };
    }

    if (table === 'pipelines') {
      return {
        select: pipelinesSelectMock,
        insert: insertMock,
        update: vi.fn().mockReturnValue(updateEqChain),
      };
    }

    if (table === 'credentials') {
      return buildCredentialsChain({ id: 'cred-123' });
    }

    return {
      select: vi.fn().mockReturnValue(buildEqChain({ data: null, error: null })),
    };
  });

  return { insertMock };
}

// ── Property 12: Pipeline Creation Limit Enforcement ─────────────────────────

describe('Property 12: Pipeline Creation Limit Enforcement', () => {
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

  // ── Property A — At exactly limit → always 403 ───────────────────────────

  it(
    'Property A — currentCount === limit always returns 403',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // limit in [1, 5]
          fc.integer({ min: 1, max: 5 }),
          async (limit) => {
            // currentCount === limit → at the limit
            setupMocksWithCount(limit, limit);

            const token = getTestJwt(app);
            const csrf = getCsrfTokenPair(app);

            const response = await app.inject({
              method: 'POST',
              url: '/pipelines',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRF-Token': csrf.header,
                Cookie: csrf.cookie,
                'Content-Type': 'application/json',
              },
              payload: VALID_PIPELINE_BODY,
            });

            expect(response.statusCode).toBe(403);
          },
        ),
        { numRuns: 10 },
      );
    },
  );

  // ── Property B — currentCount < limit → always 201 ──────────────────────

  it(
    'Property B — currentCount < limit always returns 201',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // limit in [1, 5], currentCount in [0, limit-1]
          fc.integer({ min: 1, max: 5 }).chain((limit) =>
            fc.tuple(
              fc.constant(limit),
              fc.integer({ min: 0, max: limit - 1 }),
            ),
          ),
          async ([limit, currentCount]) => {
            setupMocksWithCount(limit, currentCount);

            const token = getTestJwt(app);
            const csrf = getCsrfTokenPair(app);

            const response = await app.inject({
              method: 'POST',
              url: '/pipelines',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRF-Token': csrf.header,
                Cookie: csrf.cookie,
                'Content-Type': 'application/json',
              },
              payload: VALID_PIPELINE_BODY,
            });

            expect(response.statusCode).toBe(201);
          },
        ),
        { numRuns: 10 },
      );
    },
  );

  // ── Property C — Message exactness ──────────────────────────────────────

  it(
    'Property C — 403 response message field is an exact match, not a substring',
    async () => {
      const EXPECTED_MESSAGE =
        'Pipeline limit reached. Upgrade your plan to create more pipelines.';

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (limit) => {
            setupMocksWithCount(limit, limit);

            const token = getTestJwt(app);
            const csrf = getCsrfTokenPair(app);

            const response = await app.inject({
              method: 'POST',
              url: '/pipelines',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRF-Token': csrf.header,
                Cookie: csrf.cookie,
                'Content-Type': 'application/json',
              },
              payload: VALID_PIPELINE_BODY,
            });

            expect(response.statusCode).toBe(403);

            const body = response.json<{ message: string; error_code: string }>();

            // Exact string match — not a substring, not case-insensitive
            expect(body.message).toBe(EXPECTED_MESSAGE);
            expect(body.message).toHaveLength(EXPECTED_MESSAGE.length);
            expect(body.error_code).toBe('pipeline_limit');
          },
        ),
        { numRuns: 10 },
      );
    },
  );

  // ── Property D — Count unchanged (no insert called) ─────────────────────

  it(
    'Property D — after a 403 rejection no insert is called on the pipelines table',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (limit) => {
            const { insertMock } = setupMocksWithCount(limit, limit);

            const token = getTestJwt(app);
            const csrf = getCsrfTokenPair(app);

            const response = await app.inject({
              method: 'POST',
              url: '/pipelines',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-CSRF-Token': csrf.header,
                Cookie: csrf.cookie,
                'Content-Type': 'application/json',
              },
              payload: VALID_PIPELINE_BODY,
            });

            expect(response.statusCode).toBe(403);

            // No insert should have been attempted on the pipelines table
            expect(insertMock).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 10 },
      );
    },
  );
});
