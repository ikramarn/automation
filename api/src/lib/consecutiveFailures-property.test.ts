/**
 * Property-based tests for consecutiveFailures.ts (Property 7).
 *
 * **Validates: Requirements 12.7**
 *
 * Uses fast-check to verify the consecutive failure counter monotonicity
 * properties across arbitrary inputs:
 *
 *   Property A — Counter increments monotonically (n → n+1 before max)
 *   Property B — Pipeline pauses exactly when counter reaches max
 *   Property C — consecutiveFailures never exceeds max on pause
 *   Property D — Success always resets counter to 0
 *   Property E — Multiple failures below max never trigger a pause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Environment stubs ────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key';

// ── Mock state ────────────────────────────────────────────────────────────────

let mockPipelineRow: Record<string, unknown> | null = null;
let mockPipelineFetchError: { message: string } | null = null;
let mockUserProfileRow: Record<string, unknown> | null = { email: 'owner@example.com' };
let mockUpdateError: { message: string } | null = null;
let lastUpdatePayload: Record<string, unknown> = {};

// ── Supabase mock (same pattern as consecutiveFailures.test.ts) ───────────────

function buildSupabaseMock() {
  return {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            if (table === 'pipelines') {
              return { data: mockPipelineRow, error: mockPipelineFetchError };
            }
            if (table === 'user_profiles') {
              return { data: mockUserProfileRow, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        lastUpdatePayload = payload;
        return {
          eq: (_col: string, _val: unknown) =>
            Promise.resolve({ data: null, error: mockUpdateError }),
        };
      },
    }),
  };
}

vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => buildSupabaseMock(),
}));

vi.mock('./email.js', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { recordExecutionOutcome } from './consecutiveFailures.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function setPipelineRow(
  consecutiveFailures: number,
  maxConsecutiveFailures: number,
): void {
  mockPipelineRow = {
    consecutive_failures: consecutiveFailures,
    max_consecutive_failures: maxConsecutiveFailures,
    name: 'Test Pipeline',
    user_id: 'user-123',
  };
  mockPipelineFetchError = null;
}

// ── Property 7: Consecutive Failure Counter Monotonicity ─────────────────────

describe('Property 7: Consecutive Failure Counter Monotonicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatePayload = {};
    mockPipelineRow = null;
    mockPipelineFetchError = null;
    mockUserProfileRow = { email: 'owner@example.com' };
    mockUpdateError = null;
  });

  // ── Property A — Counter increments monotonically ────────────────────────

  it(
    'Property A — for any starting counter n ∈ [0, max-2] and max ∈ [2,5], one failure increments counter to n+1 (not paused)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // max ∈ [2, 5]: need at least 2 so there exists an n (0..max-2) where
          // n+1 < max, meaning one failure does NOT trigger a pause
          fc.integer({ min: 2, max: 5 }).chain((max) =>
            fc.tuple(
              fc.constant(max),
              // n ∈ [0, max-2]: after one failure → n+1 ≤ max-1 < max, so no pause
              fc.integer({ min: 0, max: max - 2 }),
            ),
          ),
          async ([max, n]) => {
            setPipelineRow(n, max);

            const result = await recordExecutionOutcome('pipeline-uuid', false, 'test failure');

            expect(result.consecutiveFailures).toBe(n + 1);
            expect(result.paused).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property B — Pauses exactly at max ───────────────────────────────────

  it(
    'Property B — for any max ∈ [1,5], starting at max-1 failures, one more failure pauses the pipeline with consecutiveFailures=max',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // max ∈ [1, 5]
          fc.integer({ min: 1, max: 5 }),
          async (max) => {
            // Counter starts at exactly max-1 (one failure away from pause)
            setPipelineRow(max - 1, max);

            const result = await recordExecutionOutcome('pipeline-uuid', false, 'final failure');

            expect(result.paused).toBe(true);
            expect(result.consecutiveFailures).toBe(max);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property C — Never exceeds max on pause ───────────────────────────────

  it(
    'Property C — after reaching max and pausing, consecutiveFailures === max (exactly, not more)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (max) => {
            // Start at max-1 so the next failure is the boundary-crossing one
            setPipelineRow(max - 1, max);

            const result = await recordExecutionOutcome('pipeline-uuid', false, 'boundary failure');

            // Counter must equal max exactly — never overshoot
            expect(result.consecutiveFailures).toBe(max);
            expect(result.consecutiveFailures).not.toBeGreaterThan(max);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property D — Success always resets to 0 ──────────────────────────────

  it(
    'Property D — for any starting counter n ∈ [0,5], a success resets consecutiveFailures to 0 and paused=false',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // n ∈ [0, 5]: any possible counter state including post-pause
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 1, max: 5 }),
          async (n, max) => {
            setPipelineRow(n, max);

            const result = await recordExecutionOutcome('pipeline-uuid', true);

            expect(result.consecutiveFailures).toBe(0);
            expect(result.paused).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property E — Multiple failures below max don't pause ─────────────────

  it(
    'Property E — with max=3, after 1 failure then 2 failures (total 2 < 3), pipeline is never paused',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // failuresBefore ∈ [0, 1]: we will add failures such that total < max (3)
          // First call: starting at 0, one failure → counter=1
          // Second call: starting at 1, one failure → counter=2
          // Both times: total < 3 → should not pause
          fc.constant(3), // max is always 3 in this property
          async (max) => {
            // Step 1: start at 0 failures, record one failure
            setPipelineRow(0, max);
            const result1 = await recordExecutionOutcome('pipeline-uuid-1', false, 'first');
            expect(result1.paused).toBe(false);
            expect(result1.consecutiveFailures).toBe(1);

            // Step 2: counter now at 1, record another failure → total = 2 < 3
            setPipelineRow(1, max);
            const result2 = await recordExecutionOutcome('pipeline-uuid-2', false, 'second');
            expect(result2.paused).toBe(false);
            expect(result2.consecutiveFailures).toBe(2);
          },
        ),
        { numRuns: 30 },
      );
    },
  );
});
