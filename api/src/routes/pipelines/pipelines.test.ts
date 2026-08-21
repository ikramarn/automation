/**
 * Pipeline route tests — POST /pipelines
 *
 * All tests use Fastify's app.inject() — no real HTTP server, no real Supabase
 * or n8n API calls. Both are mocked via vi.mock() so each test controls exact
 * responses.
 *
 * Covered scenarios:
 *   POST /pipelines with valid data          → 201 with pipeline record
 *   POST /pipelines when limit reached       → 403 with exact error message
 *   POST /pipelines without HeyGen key       → 400 with exact error message
 *   POST /pipelines with invalid name length → 400
 *   POST /pipelines with no platforms        → 400
 *
 * Requirements: 6.1, 6.2, 6.3, 6.6
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
// n8n env intentionally not set — triggers graceful degradation (placeholder IDs)

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

// ── Helper: build JWT for a test user ────────────────────────────────────────
let testJwt: string;

async function getTestJwt(app: FastifyInstance): Promise<string> {
  if (testJwt) return testJwt;
  testJwt = app.jwt.sign(
    {
      sub: 'user-test-123',
      email: 'test@example.com',
      user_metadata: { subscription_status: 'active' },
    },
    { expiresIn: '1h' },
  );
  return testJwt;
}

/**
 * Helper: creates a CSRF token cookie and header pair via the app's cookie
 * signing, so csrfProtect middleware accepts the POST request.
 */
async function getCsrfTokenPair(app: FastifyInstance): Promise<{
  cookie: string;
  header: string;
}> {
  const token = 'test-csrf-token-' + Math.random().toString(36).slice(2);
  // Sign the token using the app's cookie plugin (same as GET /auth/csrf-token does)
  const signed = app.signCookie(token);
  return {
    cookie: `csrf_token=${signed}`,
    header: token,
  };
}

// ── Supabase mock helpers ─────────────────────────────────────────────────────

/**
 * Full happy-path setup:
 *  - user_profiles: pipeline_limit = 5, current count = 0
 *  - credentials:   heygen_api_key active → found
 *  - pipelines insert: returns CREATED_PIPELINE
 *  - pipelines update (n8n_workflow_id): returns CREATED_PIPELINE
 */
function setupHappyPath(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'user_profiles') {
      return buildSelectChain({ pipeline_limit: 5 });
    }

    if (table === 'pipelines') {
      return buildPipelinesChain(0, CREATED_PIPELINE);
    }

    if (table === 'credentials') {
      return buildCredentialsChain({ id: 'cred-123' });
    }

    return buildSelectChain(null);
  });
}

/**
 * Setup where the user already has 5 pipelines (limit reached).
 */
function setupLimitReached(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'user_profiles') {
      return buildSelectChain({ pipeline_limit: 5 });
    }

    if (table === 'pipelines') {
      return buildPipelinesChain(5, CREATED_PIPELINE);
    }

    if (table === 'credentials') {
      return buildCredentialsChain({ id: 'cred-123' });
    }

    return buildSelectChain(null);
  });
}

/**
 * Setup where the user has no active HeyGen key.
 */
function setupNoHeyGenKey(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'user_profiles') {
      return buildSelectChain({ pipeline_limit: 5 });
    }

    if (table === 'pipelines') {
      return buildPipelinesChain(0, CREATED_PIPELINE);
    }

    if (table === 'credentials') {
      return buildCredentialsChain(null);
    }

    return buildSelectChain(null);
  });
}

// ── Low-level chain builders ──────────────────────────────────────────────────

function buildSelectChain(singleData: unknown) {
  const eqChain = buildEqChain({ data: singleData, error: null });
  return {
    select: vi.fn().mockReturnValue(eqChain),
  };
}

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
  const maybeSingleResult = { data: singleData, error: null };
  const eqChain: Record<string, unknown> = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult),
    single: vi.fn().mockResolvedValue(maybeSingleResult),
  };
  (eqChain['eq'] as ReturnType<typeof vi.fn>).mockReturnValue(eqChain);

  return {
    select: vi.fn().mockReturnValue(eqChain),
  };
}

/**
 * Builds a mock for the `pipelines` table that:
 *  - Returns `count` from a count query (for limit check)
 *  - Returns `insertData` from insert().select().single()
 *  - Returns `insertData` from update().eq().select().single()
 */
function buildPipelinesChain(count: number, insertData: unknown) {
  const countEqChain = {
    eq: vi.fn(),
  };
  const headResult = { count, error: null };
  (countEqChain['eq'] as ReturnType<typeof vi.fn>).mockResolvedValue(headResult);

  const insertResult = { data: insertData, error: null };
  const insertSelectChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(insertResult),
    }),
  };

  const updateSelectChain = {
    single: vi.fn().mockResolvedValue(insertResult),
  };
  const updateEqChain = {
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(updateSelectChain),
    }),
  };
  const updateChain = {
    update: vi.fn().mockReturnValue(updateEqChain),
  };

  // The select mock needs to handle both:
  //   - .select('id', { count: 'exact', head: true }) → count query
  //   - .select() / .select('*') → not used directly here
  const selectMock = vi.fn().mockImplementation(
    (_cols: unknown, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === 'exact') {
        return countEqChain;
      }
      return buildEqChain({ data: null, error: null });
    },
  );

  return {
    select: selectMock,
    insert: vi.fn().mockReturnValue(insertSelectChain),
    ...updateChain,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('POST /pipelines', () => {
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
    // Reset testJwt so it's re-signed for each test run (needed after app rebuild)
    // but since the app is reused, the existing token remains valid.
  });

  // ── 201 happy path ───────────────────────────────────────────────────────

  it('returns 201 with the created pipeline for valid data', async () => {
    setupHappyPath();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

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
    const body = response.json<typeof CREATED_PIPELINE>();
    expect(body.name).toBe('Tech News Daily');
    expect(body.id).toBe('pipeline-uuid-123');
    expect(body.n8n_workflow_id).toBe('n8n-workflow-test-id');
  });

  // ── 403 pipeline limit reached ───────────────────────────────────────────

  it('returns 403 with exact message when 5-pipeline limit is reached', async () => {
    setupLimitReached();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

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
    expect(body.message).toBe(
      'Pipeline limit reached. Upgrade your plan to create more pipelines.',
    );
    expect(body.error_code).toBe('pipeline_limit');
  });

  // ── 400 missing HeyGen key ────────────────────────────────────────────────

  it('returns 400 with exact message when HeyGen API key is missing', async () => {
    setupNoHeyGenKey();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

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

    expect(response.statusCode).toBe(400);
    const body = response.json<{ message: string }>();
    expect(body.message).toBe(
      'HeyGen API key required. Add your key in Settings > Credentials.',
    );
  });

  // ── 400 invalid name length ───────────────────────────────────────────────

  it('returns 400 when name is empty (0 chars)', async () => {
    setupHappyPath();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

    const response = await app.inject({
      method: 'POST',
      url: '/pipelines',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-CSRF-Token': csrf.header,
        Cookie: csrf.cookie,
        'Content-Type': 'application/json',
      },
      payload: { ...VALID_PIPELINE_BODY, name: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    setupHappyPath();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

    const longName = 'A'.repeat(101);

    const response = await app.inject({
      method: 'POST',
      url: '/pipelines',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-CSRF-Token': csrf.header,
        Cookie: csrf.cookie,
        'Content-Type': 'application/json',
      },
      payload: { ...VALID_PIPELINE_BODY, name: longName },
    });

    expect(response.statusCode).toBe(400);
  });

  // ── 400 no publishing platforms ───────────────────────────────────────────

  it('returns 400 when publishing_platforms is empty', async () => {
    setupHappyPath();
    const token = await getTestJwt(app);
    const csrf = await getCsrfTokenPair(app);

    const response = await app.inject({
      method: 'POST',
      url: '/pipelines',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-CSRF-Token': csrf.header,
        Cookie: csrf.cookie,
        'Content-Type': 'application/json',
      },
      payload: { ...VALID_PIPELINE_BODY, publishing_platforms: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  // ── 401 unauthenticated ──────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/pipelines',
      headers: {
        'Content-Type': 'application/json',
      },
      payload: VALID_PIPELINE_BODY,
    });

    expect(response.statusCode).toBe(401);
  });
});
