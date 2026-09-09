/**
 * video-generator.js
 * Standalone logic for the Video_Generator and File_Stager n8n nodes.
 * Exported functions can be unit-tested independently of n8n.
 *
 * HeyGen v3 API — supports:
 *   - Classic avatar video  : POST /v3/videos  (avatar_id + script + engine)
 *   - Video Agent           : POST /v3/video-agents  (prompt → HeyGen does everything)
 *
 * Engines (classic mode only):
 *   avatar_v   — highest fidelity, full-body realism, 20 credits/min, explicit opt-in
 *   avatar_iv  — default, expressive facial motion, 20 credits/min
 *   avatar_iii — fast precise lip-sync, 3 credits/min (cheapest), photo avatars only
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 */

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

function buildR2ObjectKey(userId, pipelineId, executionId) {
  return `${userId}/${pipelineId}/${executionId}/video.mp4`;
}

/**
 * Parse a HeyGen API response and return the appropriate error message.
 *
 * @param {object|null} response
 * @param {number} [statusCode=0]
 * @returns {string|null}
 */
function parseHeyGenError(response, statusCode = 0) {
  if (statusCode === 401 || statusCode === 403) {
    return 'HeyGen API key invalid or credits exhausted';
  }
  if (!response) return null;
  if (response.code === 40101 || response.code === 40301) {
    return 'HeyGen API key invalid or credits exhausted';
  }
  if (response.status === 401 || response.status === 403) {
    return 'HeyGen API key invalid or credits exhausted';
  }
  const videoStatus = response?.data?.status || response?.status;
  if (videoStatus === 'failed') {
    const reason =
      response?.data?.error?.message ||
      response?.data?.error ||
      response?.data?.failure_message ||
      response?.error?.message ||
      response?.error ||
      response?.failure_message ||
      null;
    return reason ? String(reason) : 'HeyGen reported failure with no reason provided';
  }
  return null;
}

function shouldRetryPoll(status) {
  return status === 'processing' || status === 'pending' || status === 'thinking' || status === 'generating';
}

function extractVideoStatus(heygenResponse) {
  if (!heygenResponse || typeof heygenResponse !== 'object') return 'processing';
  return (
    heygenResponse?.data?.status ||
    heygenResponse?.status ||
    'processing'
  );
}

/**
 * Build the v3 classic avatar video request payload.
 *
 * Engine mapping:
 *   'avatar_v'   → { type: 'avatar_v' }       (highest quality, most credits)
 *   'avatar_iv'  → { type: 'avatar_iv' }       (default, good quality)
 *   'avatar_iii' → omitted (server default for photo avatars)
 *
 * @param {object} params
 * @param {string} params.avatarId
 * @param {string} params.voiceId       - Optional; empty string = avatar default voice
 * @param {string} params.videoLanguage - e.g. "English"
 * @param {string} params.scriptText
 * @param {string} params.engine        - 'avatar_v' | 'avatar_iv' | 'avatar_iii'
 * @param {string} params.resolution    - '1080p' | '720p' | '4k'
 * @param {string} params.aspectRatio   - '9:16' | '16:9' | '1:1' | '4:5'
 * @param {string} [params.motionPrompt]
 * @returns {object}
 */
function buildHeyGenV3Payload(params) {
  const {
    avatarId,
    voiceId       = '',
    videoLanguage = 'English',
    scriptText,
    engine        = 'avatar_iv',
    resolution    = '1080p',
    aspectRatio   = '9:16',
    motionPrompt  = '',
  } = params;

  const body = {
    type: 'avatar',
    avatar_id: avatarId,
    script: scriptText,
    resolution,
    aspect_ratio: aspectRatio,
  };

  // Voice: if voiceId provided use it, otherwise HeyGen uses avatar default
  if (voiceId) {
    body.voice_id = voiceId;
  }

  // Engine selection (avatar_iii is the default for photo avatars — omitting
  // the engine field lets HeyGen pick the right one automatically)
  if (engine === 'avatar_v') {
    body.engine = { type: 'avatar_v' };
  } else if (engine === 'avatar_iv') {
    body.engine = { type: 'avatar_iv' };
  }
  // avatar_iii: omit engine field — server picks it for photo avatars

  // Motion prompt: supported by avatar_v and photo avatars on avatar_iv
  if (motionPrompt) {
    body.motion_prompt = motionPrompt;
  }

  return body;
}

/**
 * Build the v3 Video Agent request payload.
 * The agent handles scripting, avatar selection, scene composition automatically.
 *
 * @param {object} params
 * @param {string} params.prompt        - Natural language description (1–10,000 chars)
 * @param {string} [params.avatarId]    - Optional; omit to let agent choose
 * @param {string} [params.voiceId]     - Optional; omit to let agent choose
 * @param {string} [params.orientation] - 'portrait' | 'landscape'; auto if omitted
 * @param {string} [params.callbackUrl]
 * @returns {object}
 */
function buildHeyGenAgentPayload(params) {
  const { prompt, avatarId = '', voiceId = '', orientation = 'portrait', callbackUrl = '' } = params;

  const body = {
    prompt,
    mode: 'generate', // fire-and-forget (vs 'chat' for multi-turn)
    orientation,
  };

  if (avatarId) body.avatar_id = avatarId;
  if (voiceId)  body.voice_id  = voiceId;
  if (callbackUrl) body.callback_url = callbackUrl;

  return body;
}

// Legacy helper kept for backwards-compat with existing tests
function buildHeyGenPayload(avatarId, videoLanguage, scriptText) {
  return buildHeyGenV3Payload({ avatarId, videoLanguage, scriptText, engine: 'avatar_iv', resolution: '1080p', aspectRatio: '9:16' });
}

// ---------------------------------------------------------------------------
// HeyGen: Classic video generation via POST /v3/videos
// ---------------------------------------------------------------------------

/**
 * Submit a classic avatar video request to HeyGen v3 API.
 * Returns the video_id.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.avatarId
 * @param {string} params.voiceId
 * @param {string} params.videoLanguage
 * @param {string} params.scriptText
 * @param {string} params.engine         - 'avatar_v' | 'avatar_iv' | 'avatar_iii'
 * @param {string} params.resolution     - '1080p' | '720p' | '4k'
 * @param {string} params.aspectRatio    - '9:16' | '16:9' | '1:1' | '4:5'
 * @param {string} params.motionPrompt
 * @param {Function} httpPost
 * @returns {Promise<string>} video_id
 */
async function submitHeyGenVideo(params, httpPost) {
  const { apiKey, ...rest } = params;

  const url = 'https://api.heygen.com/v3/videos';
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
  const body = buildHeyGenV3Payload(rest);

  let response;
  try {
    response = await httpPost(url, headers, body);
  } catch (err) {
    const status = err.status || err.statusCode || 0;
    if (status === 401 || status === 403) {
      throw new Error('HeyGen API key invalid or credits exhausted');
    }
    throw err;
  }

  const data = typeof response === 'string' ? JSON.parse(response) : response;

  if (data && (data.code === 40101 || data.code === 40301)) {
    throw new Error('HeyGen API key invalid or credits exhausted');
  }

  // v3 response: { data: { video_id: '...' } }
  const videoId = data?.data?.video_id || data?.video_id;
  if (!videoId) {
    throw new Error('HeyGen did not return a video_id');
  }

  return videoId;
}

// ---------------------------------------------------------------------------
// HeyGen: Video Agent via POST /v3/video-agents
// ---------------------------------------------------------------------------

/**
 * Submit a Video Agent request to HeyGen.
 * Returns { sessionId, videoId } — videoId may be null initially and needs polling.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.prompt
 * @param {string} [params.avatarId]
 * @param {string} [params.voiceId]
 * @param {string} [params.orientation]
 * @param {Function} httpPost
 * @returns {Promise<{ sessionId: string, videoId: string|null }>}
 */
async function submitHeyGenAgent(params, httpPost) {
  const { apiKey, ...rest } = params;

  const url = 'https://api.heygen.com/v3/video-agents';
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
  const body = buildHeyGenAgentPayload(rest);

  let response;
  try {
    response = await httpPost(url, headers, body);
  } catch (err) {
    const status = err.status || err.statusCode || 0;
    if (status === 401 || status === 403) {
      throw new Error('HeyGen API key invalid or credits exhausted');
    }
    throw err;
  }

  const data = typeof response === 'string' ? JSON.parse(response) : response;

  if (data && (data.code === 40101 || data.code === 40301)) {
    throw new Error('HeyGen API key invalid or credits exhausted');
  }

  const sessionId = data?.session_id || data?.data?.session_id;
  if (!sessionId) {
    throw new Error('HeyGen Video Agent did not return a session_id');
  }

  // video_id may already be present or null at this stage
  const videoId = data?.video_id || data?.data?.video_id || null;

  return { sessionId, videoId };
}

/**
 * Poll the Video Agent session until video_id is assigned, then poll the
 * video until completed.
 *
 * Two-phase polling:
 *   Phase 1: GET /v3/video-agents/{sessionId} — wait for video_id (status: thinking → generating)
 *   Phase 2: GET /v3/videos/{videoId} — wait for video_url (status: pending → processing → completed)
 *
 * @param {string} sessionId
 * @param {string|null} initialVideoId  - If already assigned from the create response
 * @param {string} apiKey
 * @param {number} [maxPolls=90]        - Total polls across both phases (90 × 20s = 30 min)
 * @param {Function} httpGet
 * @returns {Promise<string>} video download URL
 */
async function pollHeyGenAgentStatus(sessionId, initialVideoId, apiKey, maxPolls = 90, httpGet) {
  const POLL_INTERVAL_MS = 20_000;
  const headers = { 'X-Api-Key': apiKey };

  let videoId = initialVideoId;
  let polls = 0;

  // Phase 1: wait for video_id to be assigned to the session
  while (!videoId && polls < maxPolls) {
    if (polls > 0) await sleep(POLL_INTERVAL_MS);
    polls++;

    let resp;
    try {
      resp = await httpGet(`https://api.heygen.com/v3/video-agents/${sessionId}`, headers);
    } catch (err) {
      const status = err.status || err.statusCode || 0;
      if (status === 401 || status === 403) throw new Error('HeyGen API key invalid or credits exhausted');
      continue;
    }

    const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
    if (data?.code === 40101 || data?.code === 40301) throw new Error('HeyGen API key invalid or credits exhausted');

    videoId = data?.video_id || data?.data?.video_id || null;

    const sessionStatus = data?.status || data?.data?.status || '';
    if (sessionStatus === 'failed') {
      const msg = data?.failure_message || data?.data?.failure_message || 'Video Agent failed';
      throw new Error(msg);
    }
  }

  if (!videoId) throw new Error('HeyGen Video Agent timed out before video_id was assigned');

  // Phase 2: poll video until completed
  return pollHeyGenStatus(videoId, apiKey, maxPolls - polls, httpGet);
}

// ---------------------------------------------------------------------------
// HeyGen: Poll video status via GET /v3/videos/{videoId}
// ---------------------------------------------------------------------------

/**
 * Poll until video_url is ready. Works for both classic and agent videos.
 *
 * @param {string} videoId
 * @param {string} apiKey
 * @param {number} [maxPolls=60]
 * @param {Function} httpGet
 * @returns {Promise<string>} video download URL
 */
async function pollHeyGenStatus(videoId, apiKey, maxPolls = 60, httpGet) {
  const POLL_INTERVAL_MS = 30_000;
  // Try the v3 endpoint first; v1 kept as legacy fallback for backwards compat
  const urlV3 = `https://api.heygen.com/v3/videos/${videoId}`;
  const headers = { 'X-Api-Key': apiKey };

  for (let poll = 0; poll < maxPolls; poll++) {
    if (poll > 0) await sleep(POLL_INTERVAL_MS);

    let response;
    try {
      response = await httpGet(urlV3, headers);
    } catch (err) {
      const status = err.status || err.statusCode || 0;
      if (status === 401 || status === 403) throw new Error('HeyGen API key invalid or credits exhausted');
      // 404 on v3 — fall back to v1 legacy endpoint
      if (status === 404) {
        try {
          const legacyUrl = `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`;
          response = await httpGet(legacyUrl, headers);
        } catch {
          continue;
        }
      } else {
        continue;
      }
    }

    const data = typeof response === 'string' ? JSON.parse(response) : response;

    if (data?.code === 40101 || data?.code === 40301) throw new Error('HeyGen API key invalid or credits exhausted');
    if (data?.status === 401 || data?.status === 403)  throw new Error('HeyGen API key invalid or credits exhausted');

    // v3 shape: { id, status, video_url, ... }
    // v1 shape: { data: { status, video_url } }
    const videoStatus = data?.status || data?.data?.status || 'processing';

    if (videoStatus === 'completed') {
      const videoUrl = data?.video_url || data?.data?.video_url;
      if (!videoUrl) throw new Error('HeyGen returned completed status but no video_url');
      return videoUrl;
    }

    if (videoStatus === 'failed') {
      const reason =
        data?.failure_message ||
        data?.data?.error?.message ||
        data?.data?.error ||
        data?.error?.message ||
        data?.error ||
        null;
      throw new Error(reason ? String(reason) : 'HeyGen reported failure with no reason provided');
    }

    // pending / processing / thinking / generating → continue polling
  }

  throw new Error('HeyGen generation timeout');
}

// ---------------------------------------------------------------------------
// R2 upload (Req 9.6, 9.8) — unchanged
// ---------------------------------------------------------------------------

async function uploadToR2(videoUrl, r2Config, executionPath, httpGet, r2Put) {
  const { user_id, pipeline_id, execution_id } = executionPath;
  const objectKey = `${user_id}/${pipeline_id}/${execution_id}/video.mp4`;

  async function attempt() {
    try {
      const { data, contentType, size } = await httpGet(videoUrl);
      await r2Put(r2Config.bucketName, objectKey, data, contentType || 'video/mp4', r2Config);
      return { r2_object_key: objectKey, video_file_size_bytes: size };
    } catch {
      return null;
    }
  }

  let result = await attempt();
  if (result !== null) return result;

  await sleep(30_000);
  result = await attempt();
  if (result !== null) return result;

  throw new Error('HeyGen video download failed');
}

// ---------------------------------------------------------------------------
// Main entry point — called from n8n Video_Generator node
// ---------------------------------------------------------------------------

/**
 * Run the full video-generation pipeline.
 *
 * Supports two modes via ctx.heygen_mode:
 *   'classic' (default) — classic avatar video: needs avatar_id + script_text + engine
 *   'agent'             — Video Agent: sends a prompt, HeyGen handles everything
 *
 * New context fields consumed:
 *   ctx.heygen_mode          — 'classic' | 'agent'  (default: 'classic')
 *   ctx.heygen_engine        — 'avatar_v' | 'avatar_iv' | 'avatar_iii'  (classic only, default: 'avatar_iv')
 *   ctx.heygen_voice_id      — optional voice ID
 *   ctx.heygen_resolution    — '1080p' | '720p' | '4k'  (default: '1080p')
 *   ctx.heygen_aspect_ratio  — '9:16' | '16:9' | '1:1' | '4:5'  (default: '9:16')
 *   ctx.heygen_motion_prompt — optional natural-language motion/gesture hint
 *   ctx.heygen_agent_prompt  — full prompt for Video Agent mode
 *   ctx.heygen_orientation   — 'portrait' | 'landscape'  (agent only, default: 'portrait')
 *
 * @param {object} ctx
 * @param {Function} httpPost
 * @param {Function} httpGet
 * @param {Function} r2Put
 */
async function runVideoGenerator(ctx, httpPost, httpGet, r2Put) {
  const apiKey = ctx.credentials?.heygen_api_key;
  if (!apiKey) throw new Error('HeyGen API key not configured');

  const contentSource  = ctx.content_source   || 'openai';
  const mode           = ctx.heygen_mode        || 'classic';
  const engine         = ctx.heygen_engine       || 'avatar_iv';
  const voiceId        = ctx.heygen_voice_id     || '';
  const resolution     = ctx.heygen_resolution   || '1080p';
  const aspectRatio    = ctx.heygen_aspect_ratio || '9:16';
  const motionPrompt   = ctx.heygen_motion_prompt || '';

  const r2Config = {
    accessKeyId:     ctx.credentials.r2_access_key_id    || '',
    secretAccessKey: ctx.credentials.r2_secret_access_key || '',
    endpoint:        ctx.credentials.r2_endpoint          || '',
    bucketName:      ctx.credentials.r2_bucket_name       || '',
  };

  let videoId;

  // ── AGENT MODE ─────────────────────────────────────────────────────────
  if (contentSource === 'agent' || mode === 'agent') {
    const agentPrompt =
      ctx.heygen_agent_prompt ||
      buildAgentPromptFromContext(ctx);

    const avatarId    = ctx.heygen_avatar_id  || '';
    const orientation = ctx.heygen_orientation || 'portrait';

    const result = await submitHeyGenAgent(
      { apiKey, prompt: agentPrompt, avatarId, voiceId, orientation },
      httpPost
    );

    const videoUrl = await pollHeyGenAgentStatus(result.sessionId, result.videoId, apiKey, 90, httpGet);

    const { r2_object_key, video_file_size_bytes } = await uploadToR2(
      videoUrl, r2Config,
      { user_id: ctx.user_id, pipeline_id: ctx.pipeline_id, execution_id: ctx.execution_id },
      httpGet, r2Put
    );

    return {
      heygen_video_id: result.sessionId,
      r2_object_key,
      video_file_size_bytes,
      video_gen_status: 'success',
    };
  }

  // ── CUSTOM SCRIPT MODE ─────────────────────────────────────────────────
  // User provided a verbatim script — skip news fetch and OpenAI entirely.
  if (contentSource === 'custom_script') {
    const scriptText = ctx.heygen_custom_script || ctx.script_text || '';
    if (!scriptText) {
      throw new Error('custom_script mode requires heygen_custom_script to be set');
    }

    const avatarId    = ctx.heygen_avatar_id  || '';
    const videoLanguage = ctx.video_language  || 'English';

    videoId = await submitHeyGenVideo(
      { apiKey, avatarId, voiceId, videoLanguage, scriptText, engine, resolution, aspectRatio, motionPrompt },
      httpPost
    );

    const videoUrl = await pollHeyGenStatus(videoId, apiKey, 60, httpGet);

    const { r2_object_key, video_file_size_bytes } = await uploadToR2(
      videoUrl, r2Config,
      { user_id: ctx.user_id, pipeline_id: ctx.pipeline_id, execution_id: ctx.execution_id },
      httpGet, r2Put
    );

    return {
      heygen_video_id: videoId,
      r2_object_key,
      video_file_size_bytes,
      video_gen_status: 'success',
    };
  }

  // ── CLASSIC / OPENAI MODE (default) ────────────────────────────────────
  // script_text is populated by the Script_Generator n8n node before this runs
  const avatarId    = ctx.heygen_avatar_id  || '';
  const videoLanguage = ctx.video_language  || 'English';
  const scriptText  = ctx.script_text       || '';

  videoId = await submitHeyGenVideo(
    { apiKey, avatarId, voiceId, videoLanguage, scriptText, engine, resolution, aspectRatio, motionPrompt },
    httpPost
  );

  const videoUrl = await pollHeyGenStatus(videoId, apiKey, 60, httpGet);

  const { r2_object_key, video_file_size_bytes } = await uploadToR2(
    videoUrl, r2Config,
    { user_id: ctx.user_id, pipeline_id: ctx.pipeline_id, execution_id: ctx.execution_id },
    httpGet, r2Put
  );

  return {
    heygen_video_id: videoId,
    r2_object_key,
    video_file_size_bytes,
    video_gen_status: 'success',
  };
}

/**
 * Build a Video Agent prompt from pipeline context fields.
 * Used when no explicit heygen_agent_prompt is set.
 *
 * @param {object} ctx
 * @returns {string}
 */
function buildAgentPromptFromContext(ctx) {
  const topic    = ctx.niche_keyword   || 'general interest';
  const title    = ctx.article_title   || '';
  const summary  = ctx.article_summary || '';
  const tone     = ctx.script_tone     || 'professional';
  const duration = ctx.target_duration_secs || 60;
  const lang     = ctx.video_language  || 'English';

  const lines = [
    `Create a ${duration}-second ${tone} video in ${lang} about: ${topic}.`,
  ];
  if (title)   lines.push(`Topic: ${title}.`);
  if (summary) lines.push(`Key points to cover: ${summary.slice(0, 500)}.`);
  lines.push('Style: portrait orientation (9:16), suitable for social media. No text overlays needed.');

  return lines.join(' ');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  // Helpers
  buildHeyGenPayload,          // legacy alias
  buildHeyGenV3Payload,
  buildHeyGenAgentPayload,
  buildAgentPromptFromContext,
  extractVideoStatus,
  buildR2ObjectKey,
  parseHeyGenError,
  shouldRetryPoll,
  // Core functions
  submitHeyGenVideo,
  submitHeyGenAgent,
  pollHeyGenStatus,
  pollHeyGenAgentStatus,
  uploadToR2,
  runVideoGenerator,
};
