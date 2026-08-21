/**
 * social-publisher-property.test.js
 * Property-based tests for Social_Publisher node logic (Property 4).
 *
 * **Validates: Requirements 11.8, 15.2**
 *
 * Property 4: Social Publisher Per-Platform Independence
 * For any subset of platform failures, the remaining platforms are still
 * attempted and all have result entries. The publish status correctly reflects
 * the combination of outcomes across all platforms.
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import {
  isAllFailed,
  determinePublishStatus,
  buildPlatformResults,
  enforceCaptionLimit,
} from './social-publisher.js';

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

const PLATFORMS = ['youtube', 'tiktok', 'facebook', 'instagram'];
const STATUSES = ['success', 'failed', 'skipped'];

/** Arbitrary: a non-empty subset of platforms */
const arbPlatformSubset = fc
  .array(fc.constantFrom(...PLATFORMS), { minLength: 1, maxLength: 4 })
  .map((arr) => [...new Set(arr)]); // deduplicate

/** Arbitrary: a status value for a single platform */
const arbStatus = fc.constantFrom(...STATUSES);

/**
 * Arbitrary: a results map for a given subset of platforms.
 * Each platform gets a random status.
 */
const arbResultsForPlatforms = (platforms) =>
  fc.record(
    Object.fromEntries(platforms.map((p) => [p, fc.record({ status: arbStatus })])),
  );

// ---------------------------------------------------------------------------
// Property A — determinePublishStatus correctly classifies outcomes
// ---------------------------------------------------------------------------

describe('Property 4A — determinePublishStatus: correctly identifies partial/failed/success', () => {
  it('returns "failed" when all actionable platforms fail', () => {
    /**
     * **Validates: Requirements 11.8, 15.2**
     * For any subset of platforms that all have status="failed",
     * determinePublishStatus must return "failed".
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        const results = Object.fromEntries(
          platforms.map((p) => [p, { status: 'failed' }]),
        );
        const status = determinePublishStatus(results);
        return status === 'failed';
      }),
      { numRuns: 200 },
    );
  });

  it('returns "success" when all actionable platforms succeed', () => {
    /**
     * **Validates: Requirements 11.8, 15.2**
     * For any subset of platforms that all have status="success",
     * determinePublishStatus must return "success".
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        const results = Object.fromEntries(
          platforms.map((p) => [p, { status: 'success' }]),
        );
        const status = determinePublishStatus(results);
        return status === 'success';
      }),
      { numRuns: 200 },
    );
  });

  it('returns "partial" for any mixed success/failed combination', () => {
    /**
     * **Validates: Requirements 11.8, 15.2**
     * When at least one platform succeeds and at least one fails,
     * determinePublishStatus must return "partial".
     */
    fc.assert(
      fc.property(
        // At least 2 platforms needed: one success, one failed
        fc
          .array(fc.constantFrom(...PLATFORMS), { minLength: 2, maxLength: 4 })
          .map((arr) => [...new Set(arr)])
          .filter((arr) => arr.length >= 2),
        (platforms) => {
          // Always assign success to first, failed to second
          const results = Object.fromEntries(
            platforms.map((p, i) => [p, { status: i === 0 ? 'success' : 'failed' }]),
          );
          const status = determinePublishStatus(results);
          return status === 'partial';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('output is always one of the defined status strings', () => {
    /**
     * **Validates: Requirements 11.8**
     * determinePublishStatus always returns a valid, defined status string.
     */
    const VALID_STATUSES = ['success', 'failed', 'partial', 'skipped'];
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        const results = Object.fromEntries(
          platforms.map((p) => [p, { status: fc.sample(arbStatus, 1)[0] }]),
        );
        const status = determinePublishStatus(results);
        return VALID_STATUSES.includes(status);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — buildPlatformResults always produces an entry for every platform
// ---------------------------------------------------------------------------

describe('Property 4B — buildPlatformResults: every platform has an entry in output', () => {
  it('creates a result entry for every platform, including ones that failed', () => {
    /**
     * **Validates: Requirements 11.8, 15.2**
     * For any set of platforms and any subset that have failures,
     * buildPlatformResults must include an entry for every platform in the
     * input array. No platform is silently dropped.
     */
    fc.assert(
      fc.property(
        arbPlatformSubset,
        fc.array(fc.nat({ max: 3 }), { minLength: 0, maxLength: 4 }),
        (platforms, failedIndices) => {
          // Build a results map where some platforms have 'failed', others 'success'
          const resultMap = {};
          platforms.forEach((p, i) => {
            resultMap[p] = {
              status: failedIndices.includes(i % 4) ? 'failed' : 'success',
              post_id: failedIndices.includes(i % 4) ? null : `id-${i}`,
              error: failedIndices.includes(i % 4) ? 'simulated error' : null,
            };
          });

          const output = buildPlatformResults(platforms, resultMap);

          // Every platform in the input must have a key in the output
          return platforms.every((p) => p in output);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('output has exactly the same number of keys as the input platforms array', () => {
    /**
     * **Validates: Requirements 11.8**
     * The output of buildPlatformResults has exactly one entry per platform.
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        const output = buildPlatformResults(platforms, {});
        return Object.keys(output).length === platforms.length;
      }),
      { numRuns: 200 },
    );
  });

  it('platforms with no result entry default to status "skipped"', () => {
    /**
     * **Validates: Requirements 11.8**
     * When a platform has no matching result, it defaults to skipped — not dropped.
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        // Pass empty results map — all platforms should default to skipped
        const output = buildPlatformResults(platforms, {});
        return platforms.every((p) => output[p] && output[p].status === 'skipped');
      }),
      { numRuns: 200 },
    );
  });

  it('each output entry always has required fields: status, post_id, error', () => {
    /**
     * **Validates: Requirements 11.8**
     * Every entry in the output has the required shape fields.
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        const resultMap = Object.fromEntries(
          platforms.map((p, i) => [
            p,
            { status: i % 2 === 0 ? 'success' : 'failed', post_id: `id-${i}`, error: null },
          ]),
        );
        const output = buildPlatformResults(platforms, resultMap);
        return platforms.every(
          (p) =>
            typeof output[p].status === 'string' &&
            'post_id' in output[p] &&
            'error' in output[p],
        );
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — isAllFailed is true only when EVERY platform has status='failed'
// ---------------------------------------------------------------------------

describe('Property 4C — isAllFailed: true only when every platform is failed', () => {
  it('returns true only when every platform has status="failed"', () => {
    /**
     * **Validates: Requirements 11.8**
     * isAllFailed must return true if and only if every entry has status='failed'.
     * If any entry has a different status, it must return false.
     */
    fc.assert(
      fc.property(
        arbPlatformSubset,
        fc.array(arbStatus, { minLength: 1, maxLength: 4 }),
        (platforms, statusList) => {
          const results = Object.fromEntries(
            platforms.map((p, i) => [p, { status: statusList[i % statusList.length] }]),
          );

          const allFailed = Object.values(results).every((r) => r.status === 'failed');
          const result = isAllFailed(results);

          return result === allFailed;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns false if ANY platform is not failed (success case)', () => {
    /**
     * **Validates: Requirements 11.8**
     * A single successful platform prevents isAllFailed from being true.
     */
    fc.assert(
      fc.property(
        arbPlatformSubset.filter((p) => p.length >= 1),
        (platforms) => {
          // Ensure at least one platform is "success"
          const results = Object.fromEntries(
            platforms.map((p, i) => [
              p,
              { status: i === 0 ? 'success' : 'failed' },
            ]),
          );
          return isAllFailed(results) === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns false if ANY platform is skipped', () => {
    /**
     * **Validates: Requirements 11.8**
     * A skipped platform also prevents isAllFailed from being true.
     */
    fc.assert(
      fc.property(
        arbPlatformSubset.filter((p) => p.length >= 1),
        (platforms) => {
          const results = Object.fromEntries(
            platforms.map((p, i) => [
              p,
              { status: i === 0 ? 'skipped' : 'failed' },
            ]),
          );
          return isAllFailed(results) === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isAllFailed result is consistent with determinePublishStatus result', () => {
    /**
     * **Validates: Requirements 11.8, 15.2**
     * When isAllFailed returns true, determinePublishStatus must return "failed".
     * When determinePublishStatus returns "failed", isAllFailed must return true
     * (for non-empty, all-failed inputs).
     */
    fc.assert(
      fc.property(arbPlatformSubset, (platforms) => {
        // Create all-failed results
        const allFailedResults = Object.fromEntries(
          platforms.map((p) => [p, { status: 'failed' }]),
        );
        const allFailedFlag = isAllFailed(allFailedResults);
        const publishStatus = determinePublishStatus(allFailedResults);

        // If isAllFailed is true, publishStatus must be 'failed'
        if (allFailedFlag && publishStatus !== 'failed') return false;
        // If publishStatus is 'failed', isAllFailed must be true
        if (publishStatus === 'failed' && !allFailedFlag) return false;
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
