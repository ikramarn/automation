/**
 * social-publisher.js
 * Standalone logic for the Social_Publisher n8n node.
 * Exported functions can be unit-tested independently of n8n.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 5.9, 5.10
 */

// ---------------------------------------------------------------------------
// Platform caption / title limits (Req 11.7)
// ---------------------------------------------------------------------------

const CAPTION_LIMITS = {
  youtube: 100,      // YouTube title ≤ 100 chars
  tiktok: 2200,
  facebook: 2200,
  instagram: 2200,
};

/**
 * Enforce the platform-specific caption/title character limit.
 * Truncates to the limit if the caption exceeds it; returns the string as-is if
 * it is within the limit. Returns an empty string for null/undefined input.
 *
 * Limits:
 *   - youtube  → 100 characters  (this is the title field)
 *   - tiktok   → 2,200 characters
 *   - facebook → 2,200 characters
 *   - instagram→ 2,200 characters
 *   - unknown  → 2,200 characters (safe default)
 *
 * @param {string|null|undefined} caption - The caption or title text.
 * @param {string} platform               - Platform key (case-insensitive).
 * @returns {string}
 */
function enforceCaptionLimit(caption, platform) {
  if (caption == null) return '';
  const text = String(caption);
  const key = (platform || '').toLowerCase();
  const limit = CAPTION_LIMITS[key] !== undefined ? CAPTION_LIMITS[key] : 2200;
  if (text.length <= limit) return text;
  return text.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Result builders (Req 11.10)
// ---------------------------------------------------------------------------

/**
 * Build the social_publish_results JSONB object that is stored in the execution log.
 *
 * For each platform in the `platforms` array, merges any entry found in `results`.
 * Platforms without a matching result entry default to { status: 'skipped', post_id: null, error: null }.
 *
 * @param {string[]} platforms - Ordered list of platform keys (e.g. ['youtube','tiktok']).
 * @param {Object.<string, { status: string, post_id?: string|null, ayrshare_post_id?: string|null, error?: string|null }>} results
 *   - A map of platform key → result object.
 * @returns {Object.<string, { status: string, post_id: string|null, ayrshare_post_id?: string|null, error: string|null }>}
 */
function buildPlatformResults(platforms, results) {
  const output = {};
  const platformList = Array.isArray(platforms) ? platforms : [];
  const resultMap = (results && typeof results === 'object') ? results : {};

  for (const platform of platformList) {
    const key = (platform || '').toLowerCase();
    if (resultMap[key]) {
      output[key] = {
        status: resultMap[key].status || 'skipped',
        post_id: resultMap[key].post_id !== undefined ? resultMap[key].post_id : null,
        ayrshare_post_id: resultMap[key].ayrshare_post_id !== undefined
          ? resultMap[key].ayrshare_post_id
          : undefined,
        error: resultMap[key].error !== undefined ? resultMap[key].error : null,
      };
      // Remove undefined ayrshare_post_id to keep JSON clean
      if (output[key].ayrshare_post_id === undefined) {
        delete output[key].ayrshare_post_id;
      }
    } else {
      output[key] = { status: 'skipped', post_id: null, error: null };
    }
  }

  return output;
}

/**
 * Returns true if every platform entry in `results` has status === 'failed'.
 * Returns false for an empty results object (vacuous — no platforms configured = not all failed).
 *
 * @param {Object.<string, { status: string }>} results
 * @returns {boolean}
 */
function isAllFailed(results) {
  if (!results || typeof results !== 'object') return false;
  const entries = Object.values(results);
  if (entries.length === 0) return false;
  return entries.every((r) => r && r.status === 'failed');
}

/**
 * Determine the overall publishing step status from per-platform results.
 *
 * Rules (Req 11.10):
 *   - 'failed'  → all configured platforms have status 'failed'
 *   - 'success' → all configured platforms have status 'success'
 *   - 'partial' → a mix of success/failed/skipped across platforms
 *
 * Platforms with status 'skipped: no video' count as skipped (not failed).
 *
 * @param {Object.<string, { status: string }>} results
 * @returns {'success' | 'failed' | 'partial' | 'skipped'}
 */
function determinePublishStatus(results) {
  if (!results || typeof results !== 'object') return 'failed';
  const entries = Object.values(results);
  if (entries.length === 0) return 'skipped';

  const statuses = entries.map((r) => (r && r.status) || 'failed');

  // All entries are skipped (e.g. no video URL)
  if (statuses.every((s) => s === 'skipped' || s.startsWith('skipped:'))) {
    return 'skipped';
  }

  // Exclude skipped entries from success/failure accounting
  const actionable = statuses.filter((s) => s !== 'skipped' && !s.startsWith('skipped:'));

  if (actionable.length === 0) return 'skipped';

  const allFailed = actionable.every((s) => s === 'failed');
  if (allFailed) return 'failed';

  const allSuccess = actionable.every((s) => s === 'success');
  if (allSuccess) return 'success';

  return 'partial';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  enforceCaptionLimit,
  buildPlatformResults,
  isAllFailed,
  determinePublishStatus,
  CAPTION_LIMITS,
};
