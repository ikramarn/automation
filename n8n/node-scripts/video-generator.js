/**
 * video-generator.js
 * Standalone logic for the Video_Generator and File_Stager n8n nodes.
 * Exported functions can be unit-tested independently of n8n.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 */

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

/**
 * Wait for the given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Edge-case helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the R2 object key for a given execution.
 * Returns: {userId}/{pipelineId}/{executionId}/video.mp4
 *
 * Note: The leading slash is intentionally omitted to produce a valid
 * S3-compatible object key (keys must not start with "/").
 * The design document shows the bucket structure with a leading slash
 * for illustration only.
 *
 * @param {string} userId
 * @param {string} pipelineId
 * @param {string} executionId
 * @returns {string}
 */
function buildR2ObjectKey(userId, pipelineId, executionId) {
  return `${userId}/${pipelineId}/${executionId}/video.mp4`;
}

/**
 * Parse a HeyGen API response and return the appropriate error message.
 *
 * Covers:
 *   - HTTP 401 / 403 → "HeyGen API key invalid or credits exhausted" (Req 9.5)
 *   - Response body auth codes (40101, 40301) → same message
 *   - "failed" status with a reason in the payload → the reason string (Req 9.7)
 *   - "failed" status with no reason → "HeyGen reported failure with no reason provided" (Req 9.7)
 *   - No error condition matched → null
 *
 * @param {object|null} response - parsed response body (may be null)
 * @param {number} [statusCode=0] - HTTP status code
 * @returns {string|null}
 */
function parseHeyGenError(response, statusCode = 0) {
  // HTTP-level auth errors
  if (statusCode === 401 || statusCode === 403) {
    return 'HeyGen API key invalid or credits exhausted';
  }

  if (!response) return null;

  // Auth error codes embedded in response body
  if (response.code === 40101 || response.code === 40301) {
    return 'HeyGen API key invalid or credits exhausted';
  }

  // HTTP status surfaced as a field in response body
  if (response.status === 401 || response.status === 403) {
    return 'HeyGen API key invalid or credits exhausted';
  }

  // "failed" status with optional reason
  const videoStatus = response?.data?.status || response?.status;
  if (videoStatus === 'failed') {
    const reason =
      response?.data?.error?.message ||
      response?.data?.error ||
      response?.error?.message ||
      response?.error ||
      null;
    return reason
      ? String(reason)
      : 'HeyGen reported failure with no reason provided';
  }

  return null;
}

/**
 * Returns true if the HeyGen status string indicates polling should continue.
 * Polling continues for "processing" and "pending" statuses (Req 9.3).
 *
 * @param {string} status
 * @returns {boolean}
 */
function shouldRetryPoll(status) {
  return status === 'processing' || status === 'pending';
}

/**
 * Build the HeyGen Video Agent API request payload.
 *
 * @param {string} avatarId      - HeyGen avatar ID
 * @param {string} videoLanguage - ISO language code (e.g. "en")
 * @param {string} scriptText    - Script text spoken by the avatar
 * @returns {object} - Ready-to-serialize request body for POST /v2/video/generate
 */
function buildHeyGenPayload(avatarId, videoLanguage, scriptText) {
  return {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: scriptText,
          voice_id: '',
        },
      },
    ],
    dimension: { width: 1080, height: 1920 },
    aspect_ratio: '9:16',
    language: videoLanguage || 'en',
  };
}

/**
 * Extract the video generation status string from a HeyGen status-poll response.
 *
 * Handles both wrapped (`data.status`) and flat (`status`) response shapes.
 * Returns one of: "completed", "failed", "processing", or an unknown string.
 * Defaults to "processing" when the response is absent or has no status field.
 *
 * @param {object} heygenResponse - Parsed JSON response from HeyGen status endpoint
 * @returns {string} - Status string
 */
function extractVideoStatus(heygenResponse) {
  if (!heygenResponse || typeof heygenResponse !== 'object') return 'processing';
  return heygenResponse?.data?.status || heygenResponse?.status || 'processing';
}

// ---------------------------------------------------------------------------
// HeyGen: Submit video generation request (Req 9.1)
// ---------------------------------------------------------------------------

/**
 * Submit a video generation request to the HeyGen Video Agent API.
 * Returns the video_id from the response.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.avatarId
 * @param {string} params.videoLanguage
 * @param {string} params.scriptText
 * @param {Function} httpPost - async (url, headers, body) => responseObject
 * @returns {Promise<string>} video_id
 */
async function submitHeyGenVideo({ apiKey, avatarId, videoLanguage, scriptText }, httpPost) {
  const url = 'https://api.heygen.com/v2/video/generate';
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
  const body = {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: scriptText,
          voice_id: '',
        },
      },
    ],
    dimension: { width: 1080, height: 1920 },
    aspect_ratio: '9:16',
    language: videoLanguage || 'en',
  };

  let response;
  try {
    response = await httpPost(url, headers, body);
  } catch (err) {
    // Surface HTTP-level errors (4xx/5xx) with their status code if available
    const status = err.status || err.statusCode || 0;
    if (status === 401 || status === 403) {
      throw new Error('HeyGen API key invalid or credits exhausted');
    }
    throw err;
  }

  const data = typeof response === 'string' ? JSON.parse(response) : response;

  // Check for auth errors in response body
  if (data && (data.code === 40101 || data.code === 40301)) {
    throw new Error('HeyGen API key invalid or credits exhausted');
  }

  const videoId = data?.data?.video_id || data?.video_id;
  if (!videoId) {
    throw new Error('HeyGen did not return a video_id');
  }

  return videoId;
}

// ---------------------------------------------------------------------------
// HeyGen: Poll status endpoint (Req 9.3, 9.4, 9.5, 9.7)
// ---------------------------------------------------------------------------

/**
 * Poll the HeyGen status endpoint until the video is "completed" or "failed",
 * or until maxPolls is reached.
 *
 * Polling interval: 30 seconds (POLL_INTERVAL_MS).
 * Maximum polls: 60 (= 30 minutes).
 *
 * Returns the completed video URL on success.
 * Throws descriptive errors on 401/403, failure status, or timeout.
 *
 * @param {string} videoId
 * @param {string} apiKey
 * @param {number} [maxPolls=60]
 * @param {Function} httpGet - async (url, headers) => responseObject
 * @returns {Promise<string>} - video download URL
 */
async function pollHeyGenStatus(videoId, apiKey, maxPolls = 60, httpGet) {
  const POLL_INTERVAL_MS = 30_000;
  const url = `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`;
  const headers = { 'X-Api-Key': apiKey };

  for (let poll = 0; poll < maxPolls; poll++) {
    // Wait before polling (except on first poll — we wait first to give HeyGen
    // time to start processing; alternatively wait after. We wait before each
    // poll including the first to keep the loop uniform and the test simple.)
    if (poll > 0) {
      await sleep(POLL_INTERVAL_MS);
    }

    let response;
    try {
      response = await httpGet(url, headers);
    } catch (err) {
      const status = err.status || err.statusCode || 0;
      if (status === 401 || status === 403) {
        throw new Error('HeyGen API key invalid or credits exhausted');
      }
      // Transient network error — continue polling
      continue;
    }

    const data = typeof response === 'string' ? JSON.parse(response) : response;

    // Auth error in response body
    if (data?.code === 40101 || data?.code === 40301) {
      throw new Error('HeyGen API key invalid or credits exhausted');
    }

    // HTTP-layer auth error surfaced as a response code field
    if (data?.status === 401 || data?.status === 403) {
      throw new Error('HeyGen API key invalid or credits exhausted');
    }

    const videoStatus = data?.data?.status || data?.status;

    if (videoStatus === 'completed') {
      const videoUrl = data?.data?.video_url || data?.video_url;
      if (!videoUrl) {
        throw new Error('HeyGen returned completed status but no video_url');
      }
      return videoUrl;
    }

    if (videoStatus === 'failed') {
      const reason =
        data?.data?.error?.message ||
        data?.data?.error ||
        data?.error?.message ||
        data?.error ||
        null;
      throw new Error(
        reason
          ? String(reason)
          : 'HeyGen reported failure with no reason provided'
      );
    }

    // Status is "processing" or unknown — continue polling
  }

  // Exhausted all polls
  throw new Error('HeyGen generation timeout');
}

// ---------------------------------------------------------------------------
// R2 upload (Req 9.6, 9.8)
// ---------------------------------------------------------------------------

/**
 * Download a video from a URL and upload it to Cloudflare R2.
 *
 * The R2 object key follows the pattern:
 *   /{user_id}/{pipeline_id}/{execution_id}/video.mp4
 *
 * On download failure, retries once after 30 seconds.
 * On retry failure, throws "HeyGen video download failed".
 *
 * @param {string} videoUrl - HeyGen CDN URL to download from
 * @param {object} r2Config
 * @param {string} r2Config.accessKeyId
 * @param {string} r2Config.secretAccessKey
 * @param {string} r2Config.endpoint
 * @param {string} r2Config.bucketName
 * @param {object} executionPath
 * @param {string} executionPath.user_id
 * @param {string} executionPath.pipeline_id
 * @param {string} executionPath.execution_id
 * @param {Function} httpGet - async (url) => { data: Buffer|Uint8Array, contentType: string, size: number }
 * @param {Function} r2Put - async (bucketName, objectKey, data, contentType, r2Config) => void
 * @returns {Promise<{ r2_object_key: string, video_file_size_bytes: number }>}
 */
async function uploadToR2(videoUrl, r2Config, executionPath, httpGet, r2Put) {
  const { user_id, pipeline_id, execution_id } = executionPath;
  const objectKey = `${user_id}/${pipeline_id}/${execution_id}/video.mp4`;

  /**
   * Attempt to download and upload. Returns result on success, null on failure.
   * @returns {Promise<{ r2_object_key: string, video_file_size_bytes: number }|null>}
   */
  async function attempt() {
    try {
      const { data, contentType, size } = await httpGet(videoUrl);
      await r2Put(r2Config.bucketName, objectKey, data, contentType || 'video/mp4', r2Config);
      return {
        r2_object_key: objectKey,
        video_file_size_bytes: size,
      };
    } catch {
      return null;
    }
  }

  // First attempt
  let result = await attempt();
  if (result !== null) return result;

  // Retry once after 30 seconds (Req 9.6)
  await sleep(30_000);
  result = await attempt();
  if (result !== null) return result;

  throw new Error('HeyGen video download failed');
}

// ---------------------------------------------------------------------------
// Main entry point — called from n8n Video_Generator node
// ---------------------------------------------------------------------------

/**
 * Run the full video-generation pipeline:
 * 1. Submit HeyGen video generation request.
 * 2. Poll for completion.
 * 3. Upload to R2.
 *
 * @param {object} ctx - n8n execution context
 * @param {Function} httpPost - async (url, headers, body) => responseObject
 * @param {Function} httpGet  - async (url, headers?) => responseObject
 * @param {Function} r2Put   - async (bucket, key, data, contentType, r2Config) => void
 * @returns {Promise<{
 *   heygen_video_id: string,
 *   r2_object_key: string,
 *   video_file_size_bytes: number,
 *   video_gen_status: string
 * }>}
 */
async function runVideoGenerator(ctx, httpPost, httpGet, r2Put) {
  const apiKey = ctx.credentials?.heygen_api_key;

  // Req 9.9
  if (!apiKey) {
    throw new Error('HeyGen API key not configured');
  }

  const avatarId = ctx.heygen_avatar_id || '';
  const videoLanguage = ctx.video_language || 'en';
  const scriptText = ctx.script_text || '';

  // Req 9.1, 9.2: Submit and get video_id
  const videoId = await submitHeyGenVideo(
    { apiKey, avatarId, videoLanguage, scriptText },
    httpPost
  );

  // Req 9.3, 9.4, 9.5, 9.7: Poll for completion
  const videoUrl = await pollHeyGenStatus(videoId, apiKey, 60, httpGet);

  // Req 9.6, 9.8: Download and upload to R2
  const r2Config = {
    accessKeyId: ctx.credentials.r2_access_key_id || '',
    secretAccessKey: ctx.credentials.r2_secret_access_key || '',
    endpoint: ctx.credentials.r2_endpoint || '',
    bucketName: ctx.credentials.r2_bucket_name || '',
  };

  const { r2_object_key, video_file_size_bytes } = await uploadToR2(
    videoUrl,
    r2Config,
    {
      user_id: ctx.user_id,
      pipeline_id: ctx.pipeline_id,
      execution_id: ctx.execution_id,
    },
    httpGet,
    r2Put
  );

  return {
    heygen_video_id: videoId,
    r2_object_key,
    video_file_size_bytes,
    video_gen_status: 'success',
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  // Utility helpers (standalone, testable)
  buildHeyGenPayload,
  extractVideoStatus,
  buildR2ObjectKey,
  parseHeyGenError,
  shouldRetryPoll,
  // Core pipeline functions
  submitHeyGenVideo,
  pollHeyGenStatus,
  uploadToR2,
  runVideoGenerator,
};
