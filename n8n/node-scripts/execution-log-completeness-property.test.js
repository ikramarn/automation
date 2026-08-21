/**
 * execution-log-completeness-property.test.js
 * Property-Based Tests for Property 3: Pipeline Execution Logging Completeness
 *
 * **Validates: Requirements 15.5**
 *
 * Property 3: For any pipeline execution — regardless of which step fails or
 * succeeds — the resulting execution_logs record SHALL contain a non-null
 * started_at timestamp, a non-null ended_at timestamp, a non-null status value,
 * and a non-null {step}_status field for every step that was entered.
 *
 * We test the Cleanup node logic via the extracted `buildExecutionLogUpdate`
 * helper, which produces the payload POSTed to /internal/execution-log/update.
 *
 * Three properties are verified:
 *   A. status is always set to a valid non-null string
 *   B. If a step ran (its result exists in ctx.stepResults), its data is
 *      preserved in the output step_results
 *   C. If any step has __error=true, the final status is always 'failed'
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildExecutionLogUpdate } from './execution-log-completeness-helper.js';

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

/** Pipeline steps that can appear in stepResults */
const STEPS = [
  'content_fetch',
  'script_generation',
  'video_generation',
  'drive_upload',
  'social_publish',
];

/** Possible step-level status values */
const STEP_STATUSES = ['success', 'failed', 'skipped', 'partial'];

/** Possible social_publish_status values (top-level on ctx) */
const SOCIAL_STATUSES = ['success', 'failed', 'partial', 'skipped'];

/** Arbitrary: a non-empty subset of pipeline steps */
const arbStepSubset = fc
  .array(fc.constantFrom(...STEPS), { minLength: 0, maxLength: STEPS.length })
  .map((arr) => [...new Set(arr)]);

/** Arbitrary: a single step status */
const arbStepStatus = fc.constantFrom(...STEP_STATUSES);

/** Arbitrary: a social publish status */
const arbSocialStatus = fc.constantFrom(...SOCIAL_STATUSES);

/**
 * Arbitrary: a valid workflow context with a random subset of steps completed.
 * No error flag — this represents a normal (non-aborted) execution.
 */
const arbNormalCtx = fc
  .record({
    stepSubset: arbStepSubset,
    socialStatus: arbSocialStatus,
  })
  .map(({ stepSubset, socialStatus }) => {
    const stepResults = {};
    for (const step of stepSubset) {
      stepResults[step] = {
        status: 'success',
        // Add realistic step-specific fields
        ...(step === 'content_fetch' ? { article_url: 'https://example.com/article' } : {}),
        ...(step === 'script_generation' ? { word_count: 140 } : {}),
        ...(step === 'video_generation' ? { heygen_video_id: 'vid_123' } : {}),
        ...(step === 'drive_upload' ? { gdrive_file_id: 'file_abc', gdrive_link: 'https://drive.google.com/file/d/file_abc/view' } : {}),
      };
    }

    const ctx = {
      execution_id: 'exec_001',
      pipeline_id: 'pipe_001',
      user_id: 'user_001',
      started_at: new Date().toISOString(),
      stepResults,
      social_publish_status: stepSubset.includes('social_publish') ? socialStatus : undefined,
      social_publish_results: stepSubset.includes('social_publish')
        ? { youtube: { status: socialStatus === 'failed' ? 'failed' : 'success', post_id: null, error: null } }
        : undefined,
    };

    return ctx;
  });

/**
 * Arbitrary: a workflow context where one specific step failed and set __error=true.
 * This models a pipeline that was aborted at a given step.
 */
const arbErrorCtx = fc
  .record({
    failedStep: fc.constantFrom(
      'Initialize',
      'Content_Fetcher',
      'Script_Generator',
      'Video_Generator',
      'File_Stager',
    ),
    errorMessage: fc.string({ minLength: 1, maxLength: 100 }),
    // Steps that ran before the error step
    priorSteps: arbStepSubset,
  })
  .map(({ failedStep, errorMessage, priorSteps }) => {
    const stepResults = {};
    for (const step of priorSteps) {
      stepResults[step] = { status: 'success' };
    }

    return {
      execution_id: 'exec_err_001',
      pipeline_id: 'pipe_001',
      user_id: 'user_001',
      started_at: new Date().toISOString(),
      __error: true,
      __error_step: failedStep,
      __error_message: errorMessage,
      stepResults,
    };
  });

/**
 * Arbitrary: a context where each of the 5 pipeline steps is either run
 * (with a random status) or not run.
 */
const arbMixedCtx = fc
  .record({
    contentFetchRan: fc.boolean(),
    scriptGenRan: fc.boolean(),
    videoGenRan: fc.boolean(),
    driveUploadRan: fc.boolean(),
    socialPublishRan: fc.boolean(),
    socialStatus: arbSocialStatus,
    hadError: fc.boolean(),
    errorStep: fc.constantFrom('Content_Fetcher', 'Script_Generator', 'Video_Generator', 'File_Stager', 'Drive_Uploader'),
    errorMessage: fc.string({ minLength: 1, maxLength: 80 }),
  })
  .map(({
    contentFetchRan, scriptGenRan, videoGenRan, driveUploadRan, socialPublishRan,
    socialStatus, hadError, errorStep, errorMessage,
  }) => {
    const stepResults = {};
    if (contentFetchRan) stepResults.content_fetch = { status: 'success', article_url: 'https://example.com' };
    if (scriptGenRan) stepResults.script_generation = { status: 'success', word_count: 140 };
    if (videoGenRan) stepResults.video_generation = { status: 'success', heygen_video_id: 'vid_x' };
    if (driveUploadRan) stepResults.drive_upload = { status: 'success', gdrive_file_id: 'f1' };

    const ctx = {
      execution_id: 'exec_mixed',
      pipeline_id: 'pipe_001',
      user_id: 'user_001',
      started_at: new Date().toISOString(),
      stepResults,
      __error: hadError,
      __error_step: hadError ? errorStep : undefined,
      __error_message: hadError ? errorMessage : undefined,
      social_publish_status: socialPublishRan ? socialStatus : undefined,
      social_publish_results: socialPublishRan
        ? { youtube: { status: 'success', post_id: 'yt_1', error: null } }
        : undefined,
    };

    return ctx;
  });

// ---------------------------------------------------------------------------
// Property A — status is always set to a valid non-null value
// ---------------------------------------------------------------------------

describe('Property 3A — status is always a valid non-null string', () => {
  /**
   * **Validates: Requirements 15.5**
   *
   * For any combination of step outcomes (including all-success, all-failed,
   * and mixed), buildExecutionLogUpdate must always return a record with a
   * valid non-null status field.
   */
  const VALID_STATUSES = ['success', 'failed', 'partial'];

  it('returns a valid status for any normal (no-error) execution context', () => {
    fc.assert(
      fc.property(arbNormalCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        // status must be present, non-null, and one of the allowed values
        expect(result.status).toBeDefined();
        expect(result.status).not.toBeNull();
        expect(VALID_STATUSES).toContain(result.status);
      }),
      { numRuns: 300 },
    );
  });

  it('returns a valid status for any error-state execution context', () => {
    fc.assert(
      fc.property(arbErrorCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        expect(result.status).toBeDefined();
        expect(result.status).not.toBeNull();
        expect(VALID_STATUSES).toContain(result.status);
      }),
      { numRuns: 300 },
    );
  });

  it('returns a valid status for any mixed execution context', () => {
    fc.assert(
      fc.property(arbMixedCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        expect(result.status).toBeDefined();
        expect(result.status).not.toBeNull();
        expect(VALID_STATUSES).toContain(result.status);
      }),
      { numRuns: 300 },
    );
  });

  it('step_results is always an object (never null or undefined)', () => {
    /**
     * **Validates: Requirements 15.5**
     * step_results must always be a non-null object.
     */
    fc.assert(
      fc.property(arbMixedCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        expect(result.step_results).toBeDefined();
        expect(result.step_results).not.toBeNull();
        expect(typeof result.step_results).toBe('object');
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — step statuses are preserved in output
// ---------------------------------------------------------------------------

describe('Property 3B — step statuses are preserved in step_results', () => {
  /**
   * **Validates: Requirements 15.5**
   *
   * If a step ran (its result exists in ctx.stepResults), the output
   * step_results must include that step's data. No entered step is silently
   * dropped from the log.
   */

  it('all steps from ctx.stepResults appear in output step_results', () => {
    fc.assert(
      fc.property(arbNormalCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        // Every step in the input stepResults must appear in the output
        const inputSteps = Object.keys(ctx.stepResults || {});
        for (const step of inputSteps) {
          expect(result.step_results).toHaveProperty(step);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('step_results has at least as many keys as ctx.stepResults', () => {
    fc.assert(
      fc.property(arbNormalCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);
        const inputCount = Object.keys(ctx.stepResults || {}).length;
        const outputCount = Object.keys(result.step_results).length;

        // Output may have MORE keys (social_publish merged in), never fewer
        expect(outputCount).toBeGreaterThanOrEqual(inputCount);
      }),
      { numRuns: 300 },
    );
  });

  it('social_publish step is included in step_results when social_publish_results exist', () => {
    /**
     * **Validates: Requirements 15.5**
     * When social_publish_results is present in ctx, the Cleanup node merges
     * it into step_results.social_publish. This must always happen.
     */
    fc.assert(
      fc.property(
        arbSocialStatus,
        fc.array(fc.constantFrom(...STEPS.slice(0, 4)), { minLength: 0, maxLength: 4 })
          .map((arr) => [...new Set(arr)]),
        (socialStatus, priorSteps) => {
          const stepResults = {};
          for (const step of priorSteps) {
            stepResults[step] = { status: 'success' };
          }

          const ctx = {
            execution_id: 'exec_social',
            stepResults,
            social_publish_status: socialStatus,
            social_publish_results: {
              youtube: { status: 'success', post_id: 'yt_123', error: null },
            },
          };

          const result = buildExecutionLogUpdate(ctx);

          // social_publish must be merged into step_results
          expect(result.step_results).toHaveProperty('social_publish');
          expect(result.step_results.social_publish.status).toBe(socialStatus);
          expect(result.step_results.social_publish.results).toEqual(ctx.social_publish_results);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('step data is not mutated — original ctx.stepResults remains unchanged', () => {
    fc.assert(
      fc.property(arbNormalCtx, (ctx) => {
        const originalStepKeys = Object.keys(ctx.stepResults || {});
        buildExecutionLogUpdate(ctx);

        // ctx.stepResults should still have the same keys as before
        const afterStepKeys = Object.keys(ctx.stepResults || {});
        expect(afterStepKeys.sort()).toEqual(originalStepKeys.sort());
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — failure at any step produces status='failed'
// ---------------------------------------------------------------------------

describe('Property 3C — failure at any step produces status=\'failed\'', () => {
  /**
   * **Validates: Requirements 15.5**
   *
   * For any step where __error=true, the final status is always 'failed'.
   * This holds regardless of which step set the error flag.
   */

  it('status is always "failed" when ctx.__error is true', () => {
    fc.assert(
      fc.property(arbErrorCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);
        expect(result.status).toBe('failed');
      }),
      { numRuns: 300 },
    );
  });

  it('failure_reason is non-null when ctx.__error is true', () => {
    /**
     * **Validates: Requirements 15.5**
     * When an error occurs, failure_reason must be set so the dashboard can
     * display a meaningful message.
     */
    fc.assert(
      fc.property(arbErrorCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        expect(result.failure_reason).not.toBeNull();
        expect(typeof result.failure_reason).toBe('string');
        expect(result.failure_reason.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it('failure_reason includes error step name when __error_step is set', () => {
    /**
     * **Validates: Requirements 15.5**
     * The failure_reason should identify which step caused the error.
     */
    fc.assert(
      fc.property(arbErrorCtx, (ctx) => {
        const result = buildExecutionLogUpdate(ctx);

        if (ctx.__error_step) {
          expect(result.failure_reason).toContain(ctx.__error_step);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('status is "failed" when social_publish_status is "failed" (no __error)', () => {
    /**
     * **Validates: Requirements 15.5**
     * Even without an explicit __error flag, if social publishing completely
     * failed, the final status must be 'failed'.
     */
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...STEPS.slice(0, 4)), { minLength: 0, maxLength: 4 })
          .map((arr) => [...new Set(arr)]),
        (priorSteps) => {
          const stepResults = {};
          for (const step of priorSteps) {
            stepResults[step] = { status: 'success' };
          }

          const ctx = {
            stepResults,
            social_publish_status: 'failed',
            social_publish_results: {
              youtube: { status: 'failed', post_id: null, error: 'Upload failed' },
            },
            __error: false,
          };

          const result = buildExecutionLogUpdate(ctx);
          expect(result.status).toBe('failed');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('status is "partial" when social_publish_status is "partial" (no __error)', () => {
    /**
     * **Validates: Requirements 15.5**
     * Partial social publish → partial execution status.
     */
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...STEPS.slice(0, 4)), { minLength: 0, maxLength: 4 })
          .map((arr) => [...new Set(arr)]),
        (priorSteps) => {
          const stepResults = {};
          for (const step of priorSteps) {
            stepResults[step] = { status: 'success' };
          }

          const ctx = {
            stepResults,
            social_publish_status: 'partial',
            social_publish_results: {
              youtube: { status: 'success', post_id: 'yt_1', error: null },
              tiktok: { status: 'failed', post_id: null, error: 'TikTok error' },
            },
            __error: false,
          };

          const result = buildExecutionLogUpdate(ctx);
          expect(result.status).toBe('partial');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('__error=true always overrides social_publish_status in determining final status', () => {
    /**
     * **Validates: Requirements 15.5**
     * The error flag has highest priority. Even if social_publish_status
     * somehow says 'success', __error=true must still produce 'failed'.
     */
    fc.assert(
      fc.property(
        arbSocialStatus,
        fc.constantFrom(
          'Content_Fetcher',
          'Script_Generator',
          'Video_Generator',
          'File_Stager',
          'Initialize',
        ),
        fc.string({ minLength: 1, maxLength: 60 }),
        (socialStatus, errorStep, errorMessage) => {
          const ctx = {
            stepResults: {},
            __error: true,
            __error_step: errorStep,
            __error_message: errorMessage,
            social_publish_status: socialStatus,
          };

          const result = buildExecutionLogUpdate(ctx);
          expect(result.status).toBe('failed');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('all possible failure injection points produce status=failed', () => {
    /**
     * **Validates: Requirements 15.5**
     * Exhaustive check: inject __error=true at each pipeline step in turn,
     * with varying numbers of prior steps having succeeded. Status must
     * always be 'failed'.
     */
    const FAILURE_STEPS = [
      'Initialize',
      'Content_Fetcher',
      'Script_Generator',
      'Video_Generator',
      'File_Stager',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...FAILURE_STEPS),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.array(fc.constantFrom('content_fetch', 'script_generation', 'video_generation'), {
          minLength: 0,
          maxLength: 3,
        }).map((arr) => [...new Set(arr)]),
        (failedStep, errorMessage, completedSteps) => {
          const stepResults = {};
          for (const step of completedSteps) {
            stepResults[step] = { status: 'success' };
          }

          const ctx = {
            execution_id: 'exec_inject',
            stepResults,
            __error: true,
            __error_step: failedStep,
            __error_message: errorMessage,
          };

          const result = buildExecutionLogUpdate(ctx);
          expect(result.status).toBe('failed');
        },
      ),
      { numRuns: 300 },
    );
  });
});
