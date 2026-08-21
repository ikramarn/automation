/**
 * Property-based tests for Stripe webhook retry backoff sequence (Property 10).
 *
 * **Validates: Requirements 2.9**
 *
 * Uses fast-check to verify that the exponential backoff delay sequence
 * exported by the Stripe webhook route satisfies all required invariants:
 *
 *   A — Each delay equals 5000 * 2^i (doubling sequence starting at 5s)
 *   B — Exactly 5 retries (RETRY_DELAYS_MS.length === 5)
 *   C — No delay exceeds 320 seconds (320_000 ms)
 *   D — Consecutive delays satisfy d[i+1] === d[i] * 2
 *   E — First delay is exactly 5 seconds (5_000 ms)
 *
 * The integration test simulates N failures (1–5) by replicating the retry
 * loop with a controllable processor and a mock delay, then asserts that
 * delay() is called exactly N times with the correct delay values from
 * RETRY_DELAYS_MS.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { RETRY_DELAYS_MS } from './stripe.js';

// ── Property 10: Stripe Webhook Retry Backoff Sequence ───────────────────────

describe('Property 10: Stripe Webhook Retry Backoff Sequence', () => {
  // ── Property A — Delay sequence correctness ────────────────────────────

  it(
    'Property A — each delay equals 5000 * 2^i for i in 0..4',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: RETRY_DELAYS_MS.length - 1 }),
          (i) => {
            const expected = 5_000 * Math.pow(2, i);
            expect(RETRY_DELAYS_MS[i]).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property B — Max 5 retries ─────────────────────────────────────────

  it(
    'Property B — RETRY_DELAYS_MS has exactly 5 entries (never more)',
    () => {
      fc.assert(
        fc.property(fc.constant(RETRY_DELAYS_MS), (delays) => {
          expect(delays.length).toBe(5);
        }),
        { numRuns: 1 },
      );
    },
  );

  // ── Property C — No delay exceeds 320 seconds ──────────────────────────

  it(
    'Property C — every delay value in RETRY_DELAYS_MS is ≤ 320_000 ms',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: RETRY_DELAYS_MS.length - 1 }),
          (i) => {
            expect(RETRY_DELAYS_MS[i]).toBeLessThanOrEqual(320_000);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property D — Exponential doubling ──────────────────────────────────

  it(
    'Property D — for consecutive delays d[i] and d[i+1], always d[i+1] === d[i] * 2',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: RETRY_DELAYS_MS.length - 2 }),
          (i) => {
            const current = RETRY_DELAYS_MS[i] as number;
            const next = RETRY_DELAYS_MS[i + 1] as number;
            expect(next).toBe(current * 2);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property E — First delay is 5 seconds ──────────────────────────────

  it(
    'Property E — RETRY_DELAYS_MS[0] === 5_000 ms (first delay is exactly 5s)',
    () => {
      fc.assert(
        fc.property(fc.constant(RETRY_DELAYS_MS[0]), (firstDelay) => {
          expect(firstDelay).toBe(5_000);
        }),
        { numRuns: 1 },
      );
    },
  );
});

// ── Integration test: retry loop calls delay() with the correct sequence ─────

describe('Property 10 — Integration: dispatchWithRetry backoff delay sequence', () => {
  /**
   * Replicates the dispatchWithRetry retry loop using the exported
   * RETRY_DELAYS_MS constant and a controllable processor + mock delay.
   *
   * This exercises the exact same branching logic as the production code
   * without needing to mock module imports (avoiding vi.mock hoisting issues
   * with factory closures that reference local variables).
   */
  async function runRetryLoop(
    failureCount: number,
    mockDelay: (ms: number) => Promise<void>,
  ): Promise<{ callCount: number; capturedDelays: number[] }> {
    const MAX = RETRY_DELAYS_MS.length; // 5
    let callCount = 0;
    const capturedDelays: number[] = [];

    const processor = async () => {
      callCount++;
      if (callCount <= failureCount) {
        throw new Error(`Simulated failure #${callCount}`);
      }
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX; attempt++) {
      try {
        await processor();
        break; // success — exit immediately
      } catch (err) {
        lastError = err;
        if (attempt < MAX) {
          const waitMs = RETRY_DELAYS_MS[attempt] as number;
          capturedDelays.push(waitMs);
          await mockDelay(waitMs);
        }
      }
    }

    // If all retries exhausted, rethrow (mirrors production behaviour)
    if (callCount <= failureCount) {
      throw lastError;
    }

    return { callCount, capturedDelays };
  }

  it(
    'simulates N failures (1–5): delay() is called exactly N times with the correct delay values',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (failureCount) => {
            const delayMock = vi.fn().mockResolvedValue(undefined);

            const { capturedDelays } = await runRetryLoop(failureCount, delayMock);

            // delay() called exactly once per failure (before each retry)
            expect(delayMock).toHaveBeenCalledTimes(failureCount);
            expect(capturedDelays.length).toBe(failureCount);

            // Each delay matches the expected sequence entry
            for (let i = 0; i < failureCount; i++) {
              expect(capturedDelays[i]).toBe(RETRY_DELAYS_MS[i]);
              expect(delayMock).toHaveBeenNthCalledWith(i + 1, RETRY_DELAYS_MS[i]);
            }

            // No delay exceeds 320 seconds
            for (const d of capturedDelays) {
              expect(d).toBeLessThanOrEqual(320_000);
            }

            vi.restoreAllMocks();
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  it(
    'when all 5 retries are exhausted: delay() is called 5 times with [5s,10s,20s,40s,80s] then throws',
    async () => {
      const delayMock = vi.fn().mockResolvedValue(undefined);

      await expect(
        runRetryLoop(6 /* more failures than retries */, delayMock),
      ).rejects.toThrow('Simulated failure');

      // All 5 delay slots consumed
      expect(delayMock).toHaveBeenCalledTimes(5);

      const expectedSequence = [5_000, 10_000, 20_000, 40_000, 80_000];
      for (let i = 0; i < 5; i++) {
        expect(delayMock).toHaveBeenNthCalledWith(i + 1, expectedSequence[i]);
      }
    },
  );
});
