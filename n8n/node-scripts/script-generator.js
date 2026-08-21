/**
 * script-generator.js
 * Standalone logic for the Script_Generator n8n node.
 * Exported functions can be unit-tested independently of n8n.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Count words in a string. Words are sequences of non-whitespace characters.
 *
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Truncate text to the nearest sentence boundary at or below maxChars (character limit).
 *
 * A sentence boundary is the end of a sentence-terminating character:
 * `.`, `!`, or `?` optionally followed by a closing quote/bracket.
 *
 * If no sentence boundary exists within the character limit, the function
 * returns the text truncated hard at maxChars (trimmed).
 *
 * If the text is already at or below maxChars, it is returned unchanged.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateAtSentenceBoundary(text, maxChars) {
  if (!text || typeof text !== 'string') return '';
  if (typeof maxChars !== 'number' || maxChars <= 0) return '';
  if (text.length <= maxChars) return text;

  const candidate = text.substring(0, maxChars);

  // Find the last sentence boundary (. ! ?) within the candidate
  const sentenceEndRegex = /[.!?]['")\]]?\s*/g;
  let lastEnd = -1;
  let match;

  while ((match = sentenceEndRegex.exec(candidate)) !== null) {
    lastEnd = match.index + match[0].trimEnd().length;
  }

  if (lastEnd > 0) {
    return candidate.substring(0, lastEnd).trim();
  }

  // No sentence boundary found — return up to maxChars
  return candidate.trim();
}

/**
 * Trim a script to targetWords (or below) at the nearest sentence boundary,
 * but only when the script word count exceeds maxWords.
 *
 * - If countWords(script) <= maxWords: return script unchanged.
 * - If countWords(script) > maxWords: trim to the nearest sentence boundary
 *   at or below targetWords words.
 *
 * @param {string} script
 * @param {number} maxWords  - threshold above which trimming is applied (e.g. 200)
 * @param {number} targetWords - target word count ceiling after trimming (e.g. 150)
 * @returns {string}
 */
function trimScriptToWordLimit(script, maxWords, targetWords) {
  if (!script || typeof script !== 'string') return '';
  if (countWords(script) <= maxWords) return script;

  const words = script.trim().split(/\s+/);
  // Take the first targetWords words as our candidate window
  const candidates = words.slice(0, targetWords);
  const joined = candidates.join(' ');

  // Find the last sentence-ending punctuation within the candidate string
  const sentenceEndRegex = /[.!?]['")\]]?\s*/g;
  let lastEnd = -1;
  let match;

  while ((match = sentenceEndRegex.exec(joined)) !== null) {
    lastEnd = match.index + match[0].trimEnd().length;
  }

  if (lastEnd > 0) {
    return joined.substring(0, lastEnd).trim();
  }

  // No sentence boundary found — fall back to targetWords word boundary
  return joined.trim();
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Returns the system prompt instructing the model to produce clean scripts.
 *
 * @returns {string}
 */
function buildSystemPrompt() {
  return (
    'You are a professional video script writer. ' +
    'Write scripts that are factually accurate, engaging, and suitable for all audiences. ' +
    'Your scripts MUST NOT contain any copyrighted quotes or lyrics, profanity, or misinformation. ' +
    'Write in a clear, spoken-word style appropriate for an AI avatar video. ' +
    'Output only the script text with no stage directions, scene labels, or formatting markers.'
  );
}

/**
 * Builds the user prompt for script generation.
 *
 * @param {string} articleTitle
 * @param {string} articleSummary
 * @param {string} tone - one of: professional, casual, energetic, educational, entertaining
 * @param {number} durationSecs - target video duration in seconds
 * @returns {string}
 */
function buildUserPrompt(articleTitle, articleSummary, tone, durationSecs) {
  const targetWords = Math.round((durationSecs / 60) * 140); // ~140 words per minute spoken
  return (
    `Write a ${tone} video script of approximately ${targetWords} words (target duration: ${durationSecs} seconds) ` +
    `based on the following article.\n\n` +
    `Article Title: ${articleTitle}\n\n` +
    `Article Summary:\n${articleSummary}\n\n` +
    `Requirements:\n` +
    `- Aim for exactly 130–150 words\n` +
    `- Do not include any copyrighted material, profanity, or misinformation\n` +
    `- Write in a ${tone} tone suitable for a short social media video\n` +
    `- Output only the script text, no formatting or labels`
  );
}

// ---------------------------------------------------------------------------
// Article truncation — alias of truncateAtSentenceBoundary (Req 8.1)
// ---------------------------------------------------------------------------

/**
 * Truncate article content to at most maxChars characters, ending at the
 * nearest sentence boundary at or below that limit.
 *
 * @param {string} text
 * @param {number} maxChars - defaults to 5000
 * @returns {string}
 */
function truncateArticleToCharLimit(text, maxChars = 5000) {
  return truncateAtSentenceBoundary(text, maxChars);
}

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
// OpenAI call with retry (Req 8.5, 8.6, 8.7)
// ---------------------------------------------------------------------------

/**
 * Call the OpenAI Chat Completions API and return the script text.
 *
 * On API error or empty response: retries once after 10 seconds.
 * If retry also fails: throws an error with message "script generation failed".
 *
 * @param {string} apiKey
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {Function} httpPost - async (url, headers, body) => responseObject
 * @returns {Promise<string>} - the generated script text
 */
async function callOpenAI(apiKey, model, systemPrompt, userPrompt, httpPost) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 400,
  };

  /**
   * Attempt a single call. Returns the script text string, or null on failure.
   * @returns {Promise<string|null>}
   */
  async function attempt() {
    try {
      const response = await httpPost(url, headers, body);
      const data = typeof response === 'string' ? JSON.parse(response) : response;

      // An HTTP-level error (non-2xx) surfaces as a thrown error from httpPost.
      // Empty or malformed response also counts as failure (Req 8.6).
      if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        return null;
      }

      const content = data.choices[0]?.message?.content;
      if (!content || typeof content !== 'string' || content.trim() === '') {
        return null;
      }

      return content.trim();
    } catch {
      return null;
    }
  }

  // First attempt
  let result = await attempt();
  if (result !== null) return result;

  // Retry once after 10 seconds (Req 8.6)
  await sleep(10000);
  result = await attempt();
  if (result !== null) return result;

  // Both attempts failed
  throw new Error('script generation failed');
}

// ---------------------------------------------------------------------------
// Script post-processing (Req 8.8)
// ---------------------------------------------------------------------------

/**
 * If the script exceeds maxWords words, trim it to the nearest sentence
 * boundary at or below targetWords words.
 *
 * Defaults: maxWords = 200, targetWords = 150  (per Req 8.8).
 *
 * @param {string} script
 * @param {number} [maxWords=200]
 * @param {number} [targetWords=150]
 * @returns {string}
 */
function enforceScriptWordLimit(script, maxWords = 200, targetWords = 150) {
  if (!script) return '';
  return trimScriptToWordLimit(script, maxWords, targetWords);
}

// ---------------------------------------------------------------------------
// Main entry point — called from n8n Script_Generator node
// ---------------------------------------------------------------------------

/**
 * Run the full script-generation pipeline.
 *
 * @param {object} ctx - n8n execution context
 * @param {Function} httpPost - async (url, headers, body) => responseObject
 * @param {string} [platformOpenAIKey] - fallback platform key from env
 * @returns {Promise<{ script_text: string, script_gen_status: string }>}
 */
async function runScriptGenerator(ctx, httpPost, platformOpenAIKey = '') {
  const articleTitle = ctx.article_title || '';
  const articleSummary = ctx.article_summary || '';
  const tone = ctx.script_tone || 'professional';
  const durationSecs = ctx.target_duration_secs || 60;
  const model = ctx.openai_model || 'gpt-4o-mini';

  // Req 8.3: Use user key if present, otherwise platform key
  const apiKey = (ctx.credentials && ctx.credentials.openai_api_key)
    ? ctx.credentials.openai_api_key
    : platformOpenAIKey;

  if (!apiKey) {
    throw new Error('script generation failed');
  }

  // Req 8.1: Cap article content at 5,000 chars, truncated at nearest sentence boundary
  const cappedSummary = truncateAtSentenceBoundary(articleSummary, 5000);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(articleTitle, cappedSummary, tone, durationSecs);

  // Call OpenAI with retry logic (throws "script generation failed" on both failures)
  let script = await callOpenAI(apiKey, model, systemPrompt, userPrompt, httpPost);

  // Req 8.8: Trim if script exceeds 200 words
  script = enforceScriptWordLimit(script);

  return {
    script_text: script,
    script_gen_status: 'success',
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  countWords,
  truncateAtSentenceBoundary,
  trimScriptToWordLimit,
  truncateArticleToCharLimit,    // alias kept for backward compat
  buildSystemPrompt,
  buildUserPrompt,
  enforceScriptWordLimit,
  runScriptGenerator,
};
