/**
 * Property-based tests for scheduling helpers (Property 20).
 *
 * **Validates: Requirements 12.4**
 *
 * Uses fast-check to verify that recordSkippedExecution:
 *   - Always inserts a record with status='skipped'
 *   - Always sets failure_reason='skipped: already running'
 *   - Never touches the pipelines table (consecutive_failures is not modified)
 *   - Always sets both started_at and ended_at (not null)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { recordSkippedExecution } from './scheduling.js';

// ── Mock Supabase admin client ────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockFrom = vi.fn();

vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

function setupSuccessMock() {
  mockFrom.mockReturnValue({ insert: mockInsert });
  mockInsert.mockResolvedValue({ error: null });
}

// ── Property 20: Skip Trigger Not Counted as Failure ─────────────────────────

describe('Property 20: Skip Trigger Not Counted as Failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessMock();
  });

  // ── Property A — Skipped execution always has status='skipped' ───────────

  it(
    'Property A — recordSkippedExecution always inserts a record with status="skipped"',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuidV(4),
          fc.uuidV(4),
          async (pipelineId, userId) => {
            vi.clearAllMocks();
            setupSuccessMock();

            await recordSkippedExecution(pipelineId, userId);

            expect(mockInsert).toHaveBeenCalledOnce();
            const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;
            expect(inserted['status']).toBe('skipped');
            expect(inserted['pipeline_id']).toBe(pipelineId);
            expect(inserted['user_id']).toBe(userId);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property B — failure_reason is always 'skipped: already running' ─────

  it(
    'Property B — failure_reason is always exactly "skipped: already running"',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuidV(4),
          fc.uuidV(4),
          async (pipelineId, userId) => {
            vi.clearAllMocks();
            setupSuccessMock();

            await recordSkippedExecution(pipelineId, userId);

            expect(mockInsert).toHaveBeenCalledOnce();
            const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;
            expect(inserted['failure_reason']).toBe('skipped: already running');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property C — consecutive_failures is never modified ──────────────────
  //    recordSkippedExecution only calls supabase.from('execution_logs')
  //    It NEVER calls .from('pipelines'), so the counter is untouched.

  it(
    'Property C — pipelines table is never touched (consecutive_failures cannot be modified)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuidV(4),
          fc.uuidV(4),
          async (pipelineId, userId) => {
            vi.clearAllMocks();
            setupSuccessMock();

            await recordSkippedExecution(pipelineId, userId);

            // from() must have been called exactly once, with 'execution_logs' only
            expect(mockFrom).toHaveBeenCalledOnce();
            expect(mockFrom).toHaveBeenCalledWith('execution_logs');

            const calledTables = mockFrom.mock.calls.map(
              (c: unknown[]) => c[0] as string,
            );
            expect(calledTables).not.toContain('pipelines');
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ── Property D — both started_at and ended_at are always set ─────────────

  it(
    'Property D — inserted record always has both started_at and ended_at set (not null)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuidV(4),
          fc.uuidV(4),
          async (pipelineId, userId) => {
            vi.clearAllMocks();
            setupSuccessMock();

            const before = new Date().toISOString();
            await recordSkippedExecution(pipelineId, userId);
            const after = new Date().toISOString();

            expect(mockInsert).toHaveBeenCalledOnce();
            const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;

            // Both timestamps must be present and non-null
            expect(inserted['started_at']).toBeDefined();
            expect(inserted['ended_at']).toBeDefined();
            expect(inserted['started_at']).not.toBeNull();
            expect(inserted['ended_at']).not.toBeNull();

            // Both timestamps must be valid ISO strings within the test window
            const startedAt = inserted['started_at'] as string;
            const endedAt = inserted['ended_at'] as string;

            expect(startedAt >= before).toBe(true);
            expect(startedAt <= after).toBe(true);
            expect(endedAt >= before).toBe(true);
            expect(endedAt <= after).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});
