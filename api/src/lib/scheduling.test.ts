/**
 * Unit tests for scheduling helpers.
 *
 * Tests use a Supabase mock to avoid real DB calls.
 *
 * Requirements: 12.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordSkippedExecution } from './scheduling.js';

// ── Mock Supabase admin client ────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockFrom = vi.fn();

vi.mock('./supabase.js', () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// Default: from() returns an object with insert()
function setupDefaultMock(insertResult: { error: null | { message: string } }) {
  mockFrom.mockReturnValue({ insert: mockInsert });
  mockInsert.mockResolvedValue(insertResult);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recordSkippedExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a record with status="skipped" and failure_reason="skipped: already running"', async () => {
    setupDefaultMock({ error: null });

    await recordSkippedExecution('pipeline-abc', 'user-123');

    expect(mockInsert).toHaveBeenCalledOnce();
    const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted['status']).toBe('skipped');
    expect(inserted['failure_reason']).toBe('skipped: already running');
    expect(inserted['pipeline_id']).toBe('pipeline-abc');
    expect(inserted['user_id']).toBe('user-123');
  });

  it('sets both started_at and ended_at (not null)', async () => {
    setupDefaultMock({ error: null });

    const before = new Date().toISOString();
    await recordSkippedExecution('pipeline-abc', 'user-123');
    const after = new Date().toISOString();

    const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;

    expect(inserted['started_at']).toBeDefined();
    expect(inserted['ended_at']).toBeDefined();
    expect(inserted['started_at']).not.toBeNull();
    expect(inserted['ended_at']).not.toBeNull();

    // Both timestamps should be within the test window
    expect(inserted['started_at'] as string >= before).toBe(true);
    expect(inserted['started_at'] as string <= after).toBe(true);
    expect(inserted['ended_at'] as string >= before).toBe(true);
    expect(inserted['ended_at'] as string <= after).toBe(true);
  });

  it('only touches execution_logs — does NOT modify the pipelines table', async () => {
    setupDefaultMock({ error: null });

    await recordSkippedExecution('pipeline-xyz', 'user-456');

    // from() should have been called exactly once, with 'execution_logs'
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledWith('execution_logs');

    // Confirm 'pipelines' table was never queried
    const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calledTables).not.toContain('pipelines');
  });

  it('throws when the Supabase insert returns an error', async () => {
    setupDefaultMock({ error: { message: 'constraint violation' } });

    await expect(
      recordSkippedExecution('pipeline-abc', 'user-123'),
    ).rejects.toThrow('Failed to record skipped execution: constraint violation');
  });
});
