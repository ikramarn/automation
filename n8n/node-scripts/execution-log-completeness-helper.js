/**
 * execution-log-completeness-helper.js
 * Standalone module that mirrors the Cleanup node logic from video-automation-pipeline.json.
 *
 * Exports `buildExecutionLogUpdate(ctx)` — takes a workflow context object
 * (the shape passed into the Cleanup node) and returns the payload that would
 * be POSTed to /internal/execution-log/update.
 *
 * Requirements: 15.5
 */

/**
 * Determine the final pipeline status from the workflow context.
 *
 * Priority (mirrors Cleanup node):
 *   1. ctx.__error === true              → 'failed'
 *   2. social_publish_status === 'failed'  → 'failed'
 *   3. social_publish_status === 'partial' → 'partial'
 *   4. Otherwise                           → 'success'
 *
 * @param {object} ctx - Workflow execution context
 * @returns {'failed' | 'partial' | 'success'}
 */
function determineFinalStatus(ctx) {
  const hadError = ctx.__error === true;

  if (hadError) {
    return 'failed';
  }

  const socialStatus = ctx.social_publish_status || 'success';
  if (socialStatus === 'failed') {
    return 'failed';
  }
  if (socialStatus === 'partial') {
    return 'partial';
  }
  return 'success';
}

/**
 * Build the execution-log update payload from the workflow context.
 *
 * This mirrors what the Cleanup node computes and POSTs to
 * /internal/execution-log/update.
 *
 * @param {object} ctx - Workflow execution context. Shape:
 *   {
 *     __error?: boolean,
 *     __error_step?: string,
 *     __error_message?: string,
 *     social_publish_status?: string,
 *     social_publish_results?: object,
 *     stepResults?: object,
 *     started_at?: string,
 *     execution_id?: string,
 *   }
 *
 * @returns {{
 *   status: 'failed' | 'partial' | 'success',
 *   failure_reason: string | null,
 *   step_results: object,
 * }}
 */
function buildExecutionLogUpdate(ctx) {
  const hadError = ctx.__error === true;
  const errorStep = ctx.__error_step || null;
  const errorMessage = ctx.__error_message || null;

  // Determine final status
  const status = determineFinalStatus(ctx);

  // Determine failure reason
  let failureReason = null;
  if (hadError) {
    failureReason = errorStep
      ? `[${errorStep}]: ${errorMessage}`
      : errorMessage;
  } else {
    const socialStatus = ctx.social_publish_status || 'success';
    if (socialStatus === 'failed') {
      failureReason = '[Social_Publisher]: all platform publish attempts failed';
    } else if (socialStatus === 'partial') {
      failureReason = '[Social_Publisher]: one or more platform publish attempts failed';
    }
  }

  // Build step_results — start from ctx.stepResults and merge social_publish if present
  const stepResults = Object.assign({}, ctx.stepResults || {});

  if (ctx.social_publish_results && typeof ctx.social_publish_results === 'object') {
    stepResults.social_publish = {
      status: ctx.social_publish_status || 'skipped',
      results: ctx.social_publish_results,
    };
  }

  return {
    status,
    failure_reason: failureReason,
    step_results: stepResults,
  };
}

export { buildExecutionLogUpdate, determineFinalStatus };
