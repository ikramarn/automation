/**
 * video-generator.test.js
 * Vitest unit tests for the Video_Generator / File_Stager node logic.
 *
 * Requirements validated: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildHeyGenPayload,
  extractVideoStatus,
  buildR2ObjectKey,
  parseHeyGenError,
  shouldRetryPoll,
  pollHeyGenStatus,
  uploadToR2,
} from './video-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock httpGet that returns "processing" for the first N-1 calls
 * then returns "completed" with a video URL.
 *
 * @param {number} completesOnPoll - 1-based index when "completed" is returned
 * @param {string} [videoUrl]
 */
function makePollingMock(completesOnPoll, videoUrl = 'https://cdn.heygen.com/video.mp4') {
  let callCount = 0;
  return async (_url, _headers) => {
    callCount++;
    if (callCount < completesOnPoll) {
      return { data: { status: 'processing' } };
    }
    return { data: { status: 'completed', video_url: videoUrl } };
  };
}

/**
 * Build a mock httpGet that always returns "failed".
 * @param {string} [reason]
 */
function makeFailedMock(reason) {
  return async () => ({
    data: {
      status: 'failed',
      error: reason ? { message: reason } : null,
    },
  });
}

// ---------------------------------------------------------------------------
// buildR2ObjectKey
// ---------------------------------------------------------------------------

describe('buildR2ObjectKey', () => {
  it('returns the correct path pattern', () => {
    const key = buildR2ObjectKey('user-1', 'pipe-2', 'exec-3');
    expect(key).toBe('user-1/pipe-2/exec-3/video.mp4');
  });

  it('always ends with /video.mp4', () => {
    const key = buildR2ObjectKey('u', 'p', 'e');
    expect(key.endsWith('/video.mp4')).toBe(true);
  });

  it('always has exactly four path segments', () => {
    const key = buildR2ObjectKey('userId', 'pipelineId', 'executionId');
    const parts = key.split('/');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('userId');
    expect(parts[1]).toBe('pipelineId');
    expect(parts[2]).toBe('executionId');
    expect(parts[3]).toBe('video.mp4');
  });

  it('does not add a leading slash', () => {
    const key = buildR2ObjectKey('u', 'p', 'e');
    expect(key.startsWith('/')).toBe(false);
  });

  it('uses all three parameters without mixing them up', () => {
    const key = buildR2ObjectKey('aaa', 'bbb', 'ccc');
    expect(key).toBe('aaa/bbb/ccc/video.mp4');
    // Verify order — user_id first, not pipeline_id or execution_id
    expect(key.startsWith('aaa/')).toBe(true);
    expect(key).toContain('/bbb/');
    expect(key).toContain('/ccc/');
  });
});

// ---------------------------------------------------------------------------
// parseHeyGenError
// ---------------------------------------------------------------------------

describe('parseHeyGenError', () => {
  it('returns auth error on HTTP 401 (Req 9.5)', () => {
    expect(parseHeyGenError(null, 401)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns auth error on HTTP 403 (Req 9.5)', () => {
    expect(parseHeyGenError(null, 403)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns auth error on body code 40101 (Req 9.5)', () => {
    expect(parseHeyGenError({ code: 40101 }, 200)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns auth error on body code 40301 (Req 9.5)', () => {
    expect(parseHeyGenError({ code: 40301 }, 200)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns auth error when response.status is 401 (Req 9.5)', () => {
    expect(parseHeyGenError({ status: 401 }, 0)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns auth error when response.status is 403 (Req 9.5)', () => {
    expect(parseHeyGenError({ status: 403 }, 0)).toBe('HeyGen API key invalid or credits exhausted');
  });

  it('returns failure reason when "failed" status has data.error.message (Req 9.7)', () => {
    const response = { data: { status: 'failed', error: { message: 'Rendering error' } } };
    expect(parseHeyGenError(response, 200)).toBe('Rendering error');
  });

  it('returns failure reason when "failed" status has data.error as string (Req 9.7)', () => {
    const response = { data: { status: 'failed', error: 'Quota exceeded' } };
    expect(parseHeyGenError(response, 200)).toBe('Quota exceeded');
  });

  it('returns failure reason when "failed" status has top-level error.message (Req 9.7)', () => {
    const response = { status: 'failed', error: { message: 'Top-level error' } };
    expect(parseHeyGenError(response, 200)).toBe('Top-level error');
  });

  it('returns generic message when "failed" status has no reason (Req 9.7)', () => {
    const response = { data: { status: 'failed', error: null } };
    expect(parseHeyGenError(response, 200)).toBe('HeyGen reported failure with no reason provided');
  });

  it('returns generic message when "failed" status has undefined error (Req 9.7)', () => {
    const response = { data: { status: 'failed' } };
    expect(parseHeyGenError(response, 200)).toBe('HeyGen reported failure with no reason provided');
  });

  it('returns null for a successful response', () => {
    const response = { data: { status: 'completed', video_url: 'https://example.com/v.mp4' } };
    expect(parseHeyGenError(response, 200)).toBeNull();
  });

  it('returns null for a "processing" response', () => {
    const response = { data: { status: 'processing' } };
    expect(parseHeyGenError(response, 200)).toBeNull();
  });

  it('returns null for null response and non-auth status code', () => {
    expect(parseHeyGenError(null, 200)).toBeNull();
    expect(parseHeyGenError(null, 0)).toBeNull();
  });

  it('HTTP 401 takes precedence over response body', () => {
    // Even if the body has a "failed" status, a 401 HTTP code should return auth error
    const response = { data: { status: 'failed', error: { message: 'Some reason' } } };
    expect(parseHeyGenError(response, 401)).toBe('HeyGen API key invalid or credits exhausted');
  });
});

// ---------------------------------------------------------------------------
// shouldRetryPoll
// ---------------------------------------------------------------------------

describe('shouldRetryPoll', () => {
  it('returns true for "processing" (Req 9.3)', () => {
    expect(shouldRetryPoll('processing')).toBe(true);
  });

  it('returns true for "pending" (Req 9.3)', () => {
    expect(shouldRetryPoll('pending')).toBe(true);
  });

  it('returns false for "completed"', () => {
    expect(shouldRetryPoll('completed')).toBe(false);
  });

  it('returns false for "failed"', () => {
    expect(shouldRetryPoll('failed')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(shouldRetryPoll('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldRetryPoll(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(shouldRetryPoll(undefined)).toBe(false);
  });

  it('returns false for unknown status strings', () => {
    expect(shouldRetryPoll('queued')).toBe(false);
    expect(shouldRetryPoll('cancelled')).toBe(false);
    expect(shouldRetryPoll('PROCESSING')).toBe(false); // case-sensitive
  });
});

// ---------------------------------------------------------------------------
// pollHeyGenStatus
// ---------------------------------------------------------------------------

describe('pollHeyGenStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns video URL immediately when first poll returns completed', async () => {
    const httpGet = makePollingMock(1);
    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);
    // First poll has no pre-delay (poll === 0), so resolves immediately
    const url = await promise;
    expect(url).toBe('https://cdn.heygen.com/video.mp4');
  });

  it('returns video URL after N polls of "processing" then "completed"', async () => {
    // Completes on poll 3 (polls 1 and 2 return "processing")
    const httpGet = makePollingMock(3);
    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);

    // Advance past poll 2 delay (2 × 30s = 60s)
    await vi.advanceTimersByTimeAsync(60_001);
    const url = await promise;
    expect(url).toBe('https://cdn.heygen.com/video.mp4');
  });

  it('throws "HeyGen generation timeout" when maxPolls exhausted (Req 9.4)', async () => {
    // Always returns "processing"
    const httpGet = async () => ({ data: { status: 'processing' } });
    const maxPolls = 3;

    const promise = pollHeyGenStatus('vid-123', 'api-key', maxPolls, httpGet);
    // Attach rejection handler before advancing timers to prevent unhandled rejection warning
    const assertRejects = expect(promise).rejects.toThrow('HeyGen generation timeout');

    // Advance time past all poll intervals
    await vi.advanceTimersByTimeAsync(maxPolls * 30_001);
    await assertRejects;
  });

  it('throws "HeyGen API key invalid or credits exhausted" on 401 error (Req 9.5)', async () => {
    const httpGet = async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    };

    const promise = pollHeyGenStatus('vid-123', 'bad-key', 60, httpGet);
    await expect(promise).rejects.toThrow('HeyGen API key invalid or credits exhausted');
  });

  it('throws "HeyGen API key invalid or credits exhausted" on 403 error (Req 9.5)', async () => {
    const httpGet = async () => {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    };

    const promise = pollHeyGenStatus('vid-123', 'bad-key', 60, httpGet);
    await expect(promise).rejects.toThrow('HeyGen API key invalid or credits exhausted');
  });

  it('throws failure reason when HeyGen returns "failed" status with reason (Req 9.7)', async () => {
    const httpGet = makeFailedMock('Insufficient credits');
    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);
    await expect(promise).rejects.toThrow('Insufficient credits');
  });

  it('throws generic message when HeyGen "failed" has no reason (Req 9.7)', async () => {
    const httpGet = makeFailedMock(null);
    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);
    await expect(promise).rejects.toThrow('HeyGen reported failure with no reason provided');
  });

  it('respects maxPolls=60 (standard 30-minute limit, Req 9.4)', async () => {
    let callCount = 0;
    const httpGet = async () => {
      callCount++;
      return { data: { status: 'processing' } };
    };

    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);
    // Attach rejection handler before advancing timers
    const assertRejects = expect(promise).rejects.toThrow('HeyGen generation timeout');

    // Advance time well past 60 × 30s
    await vi.advanceTimersByTimeAsync(60 * 30_001);
    await assertRejects;
    expect(callCount).toBe(60);
  });

  it('polls again after 30s interval between polls (Req 9.3)', async () => {
    const callTimes = [];
    let startTime;

    const httpGet = async () => {
      const now = Date.now();
      if (!startTime) startTime = now;
      callTimes.push(now - startTime);
      if (callTimes.length >= 3) {
        return { data: { status: 'completed', video_url: 'https://cdn.heygen.com/v.mp4' } };
      }
      return { data: { status: 'processing' } };
    };

    const promise = pollHeyGenStatus('vid-123', 'api-key', 60, httpGet);
    await vi.advanceTimersByTimeAsync(60_001);
    await promise;

    // Poll 1: t=0, Poll 2: t=30000, Poll 3: t=60000
    expect(callTimes.length).toBe(3);
    expect(callTimes[1]).toBeGreaterThanOrEqual(29_999);
    expect(callTimes[2]).toBeGreaterThanOrEqual(59_999);
  });
});

// ---------------------------------------------------------------------------
// uploadToR2
// ---------------------------------------------------------------------------

describe('uploadToR2', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeR2Config = () => ({
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    bucketName: 'video-staging',
  });

  const makeExecPath = () => ({
    user_id: 'user-abc',
    pipeline_id: 'pipe-xyz',
    execution_id: 'exec-123',
  });

  const makeVideoDownload = (size = 1024 * 1024) =>
    async () => ({
      data: new Uint8Array(size),
      contentType: 'video/mp4',
      size,
    });

  it('builds the correct R2 object key (Req 9.8)', async () => {
    const capturedKeys = [];
    const r2Put = async (_bucket, key, _data, _ct, _cfg) => {
      capturedKeys.push(key);
    };

    await uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      makeVideoDownload(),
      r2Put
    );

    expect(capturedKeys[0]).toBe('user-abc/pipe-xyz/exec-123/video.mp4');
  });

  it('R2 path follows /{user_id}/{pipeline_id}/{execution_id}/video.mp4 format', async () => {
    const capturedKeys = [];
    const r2Put = async (_bucket, key) => { capturedKeys.push(key); };

    const execPath = {
      user_id: 'u-001',
      pipeline_id: 'p-002',
      execution_id: 'e-003',
    };

    await uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      execPath,
      makeVideoDownload(),
      r2Put
    );

    const [key] = capturedKeys;
    const parts = key.split('/');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('u-001');
    expect(parts[1]).toBe('p-002');
    expect(parts[2]).toBe('e-003');
    expect(parts[3]).toBe('video.mp4');
  });

  it('returns r2_object_key and video_file_size_bytes (Req 9.8)', async () => {
    const r2Put = async () => {};
    const result = await uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      makeVideoDownload(2_500_000),
      r2Put
    );

    expect(result.r2_object_key).toBe('user-abc/pipe-xyz/exec-123/video.mp4');
    expect(result.video_file_size_bytes).toBe(2_500_000);
  });

  it('uses the correct bucket name when uploading', async () => {
    const capturedBuckets = [];
    const r2Put = async (bucket) => { capturedBuckets.push(bucket); };

    await uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      makeVideoDownload(),
      r2Put
    );

    expect(capturedBuckets[0]).toBe('video-staging');
  });

  it('retries once after 30s on first download failure (Req 9.6)', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const httpGet = async () => {
      callCount++;
      if (callCount === 1) throw new Error('Download failed');
      return { data: new Uint8Array(512), contentType: 'video/mp4', size: 512 };
    };
    const r2Put = async () => {};

    const promise = uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      httpGet,
      r2Put
    );

    // Advance past 30s retry delay
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.video_file_size_bytes).toBe(512);
  });

  it('throws "HeyGen video download failed" when both download attempts fail (Req 9.6)', async () => {
    vi.useFakeTimers();
    const httpGet = async () => { throw new Error('Network error'); };
    const r2Put = async () => {};

    const promise = uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      httpGet,
      r2Put
    );

    const assertRejects = expect(promise).rejects.toThrow('HeyGen video download failed');
    await vi.advanceTimersByTimeAsync(30_001);
    await assertRejects;
  });

  it('throws "HeyGen video download failed" when R2 upload fails on both attempts', async () => {
    vi.useFakeTimers();
    const httpGet = makeVideoDownload();
    const r2Put = async () => { throw new Error('R2 write error'); };

    const promise = uploadToR2(
      'https://cdn.heygen.com/video.mp4',
      makeR2Config(),
      makeExecPath(),
      httpGet,
      r2Put
    );

    const assertRejects = expect(promise).rejects.toThrow('HeyGen video download failed');
    await vi.advanceTimersByTimeAsync(30_001);
    await assertRejects;
  });
});

// ---------------------------------------------------------------------------
// buildHeyGenPayload
// ---------------------------------------------------------------------------

describe('buildHeyGenPayload', () => {
  it('includes the correct avatarId in character block', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Hello world.');
    expect(payload.video_inputs[0].character.avatar_id).toBe('avatar-001');
  });

  it('sets character type to "avatar"', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Hello world.');
    expect(payload.video_inputs[0].character.type).toBe('avatar');
  });

  it('sets avatar_style to "normal"', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Hello world.');
    expect(payload.video_inputs[0].character.avatar_style).toBe('normal');
  });

  it('includes the script text as voice input_text', () => {
    const script = 'Welcome to the show. Today we cover AI trends.';
    const payload = buildHeyGenPayload('avatar-002', 'en', script);
    expect(payload.video_inputs[0].voice.input_text).toBe(script);
  });

  it('sets voice type to "text"', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Script text.');
    expect(payload.video_inputs[0].voice.type).toBe('text');
  });

  it('sets the language from the videoLanguage parameter', () => {
    const payload = buildHeyGenPayload('avatar-001', 'fr', 'Bonjour le monde.');
    expect(payload.language).toBe('fr');
  });

  it('defaults language to "en" when videoLanguage is falsy', () => {
    const payload = buildHeyGenPayload('avatar-001', '', 'Hello.');
    expect(payload.language).toBe('en');
  });

  it('sets 9:16 aspect ratio for short-form video', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Test.');
    expect(payload.aspect_ratio).toBe('9:16');
  });

  it('sets portrait dimensions (1080x1920)', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Test.');
    expect(payload.dimension).toEqual({ width: 1080, height: 1920 });
  });

  it('has exactly one video_input entry', () => {
    const payload = buildHeyGenPayload('avatar-001', 'en', 'Test script.');
    expect(Array.isArray(payload.video_inputs)).toBe(true);
    expect(payload.video_inputs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractVideoStatus
// ---------------------------------------------------------------------------

describe('extractVideoStatus', () => {
  it('returns "completed" from nested data.status', () => {
    const response = { data: { status: 'completed', video_url: 'https://example.com/v.mp4' } };
    expect(extractVideoStatus(response)).toBe('completed');
  });

  it('returns "failed" from nested data.status', () => {
    const response = { data: { status: 'failed', error: { message: 'Render failed' } } };
    expect(extractVideoStatus(response)).toBe('failed');
  });

  it('returns "processing" from nested data.status', () => {
    const response = { data: { status: 'processing' } };
    expect(extractVideoStatus(response)).toBe('processing');
  });

  it('falls back to top-level status when data.status is absent', () => {
    const response = { status: 'completed' };
    expect(extractVideoStatus(response)).toBe('completed');
  });

  it('falls back to top-level status "failed"', () => {
    const response = { status: 'failed' };
    expect(extractVideoStatus(response)).toBe('failed');
  });

  it('defaults to "processing" for null input', () => {
    expect(extractVideoStatus(null)).toBe('processing');
  });

  it('defaults to "processing" for undefined input', () => {
    expect(extractVideoStatus(undefined)).toBe('processing');
  });

  it('defaults to "processing" when response has no status fields', () => {
    expect(extractVideoStatus({})).toBe('processing');
    expect(extractVideoStatus({ data: {} })).toBe('processing');
  });

  it('prefers data.status over top-level status', () => {
    // data.status should win over a conflicting top-level status
    const response = { data: { status: 'completed' }, status: 'processing' };
    expect(extractVideoStatus(response)).toBe('completed');
  });
});
