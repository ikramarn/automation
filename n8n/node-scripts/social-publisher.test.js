/**
 * social-publisher.test.js
 * Vitest unit tests for the Social_Publisher node logic.
 *
 * Requirements validated: 11.1, 11.7, 11.10
 */

import { describe, it, expect } from 'vitest';
import {
  enforceCaptionLimit,
  buildPlatformResults,
  isAllFailed,
  determinePublishStatus,
} from './social-publisher.js';

// ---------------------------------------------------------------------------
// enforceCaptionLimit — Req 11.7
// ---------------------------------------------------------------------------

describe('enforceCaptionLimit', () => {
  // YouTube title ≤ 100 chars
  describe('youtube', () => {
    it('returns the title unchanged when ≤ 100 characters', () => {
      const title = 'A'.repeat(100);
      expect(enforceCaptionLimit(title, 'youtube')).toBe(title);
    });

    it('truncates to exactly 100 characters when input exceeds 100', () => {
      const title = 'A'.repeat(150);
      const result = enforceCaptionLimit(title, 'youtube');
      expect(result.length).toBe(100);
      expect(result).toBe('A'.repeat(100));
    });

    it('returns the full title when it is exactly 100 characters', () => {
      const title = 'B'.repeat(100);
      expect(enforceCaptionLimit(title, 'youtube').length).toBe(100);
    });

    it('returns a short title unchanged', () => {
      expect(enforceCaptionLimit('Short title', 'youtube')).toBe('Short title');
    });

    it('is case-insensitive for platform name', () => {
      const title = 'A'.repeat(150);
      expect(enforceCaptionLimit(title, 'YouTube').length).toBe(100);
      expect(enforceCaptionLimit(title, 'YOUTUBE').length).toBe(100);
    });

    it('returns empty string for null caption', () => {
      expect(enforceCaptionLimit(null, 'youtube')).toBe('');
    });

    it('returns empty string for undefined caption', () => {
      expect(enforceCaptionLimit(undefined, 'youtube')).toBe('');
    });
  });

  // TikTok caption ≤ 2200 chars
  describe('tiktok', () => {
    it('returns caption unchanged when ≤ 2200 characters', () => {
      const caption = 'X'.repeat(2200);
      expect(enforceCaptionLimit(caption, 'tiktok')).toBe(caption);
    });

    it('truncates to exactly 2200 characters when input exceeds 2200', () => {
      const caption = 'X'.repeat(3000);
      const result = enforceCaptionLimit(caption, 'tiktok');
      expect(result.length).toBe(2200);
    });

    it('returns short captions unchanged', () => {
      const caption = 'Hello TikTok! #trending';
      expect(enforceCaptionLimit(caption, 'tiktok')).toBe(caption);
    });
  });

  // Facebook caption ≤ 2200 chars
  describe('facebook', () => {
    it('returns caption unchanged when ≤ 2200 characters', () => {
      const caption = 'F'.repeat(2200);
      expect(enforceCaptionLimit(caption, 'facebook')).toBe(caption);
    });

    it('truncates to exactly 2200 characters when input exceeds 2200', () => {
      const caption = 'F'.repeat(2500);
      const result = enforceCaptionLimit(caption, 'facebook');
      expect(result.length).toBe(2200);
    });
  });

  // Instagram caption ≤ 2200 chars
  describe('instagram', () => {
    it('returns caption unchanged when ≤ 2200 characters', () => {
      const caption = 'I'.repeat(2200);
      expect(enforceCaptionLimit(caption, 'instagram')).toBe(caption);
    });

    it('truncates to exactly 2200 characters when input exceeds 2200', () => {
      const caption = 'I'.repeat(4000);
      const result = enforceCaptionLimit(caption, 'instagram');
      expect(result.length).toBe(2200);
    });
  });

  // Unknown platform falls back to 2200
  describe('unknown platform', () => {
    it('applies 2200 character limit for unknown platforms', () => {
      const caption = 'U'.repeat(3000);
      const result = enforceCaptionLimit(caption, 'linkedin');
      expect(result.length).toBe(2200);
    });

    it('applies 2200 character limit when platform is empty string', () => {
      const caption = 'U'.repeat(3000);
      expect(enforceCaptionLimit(caption, '').length).toBe(2200);
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('handles empty string caption', () => {
      expect(enforceCaptionLimit('', 'youtube')).toBe('');
    });

    it('converts non-string caption to string', () => {
      // @ts-ignore — testing runtime coercion
      expect(typeof enforceCaptionLimit(12345, 'tiktok')).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// isAllFailed — Req 11.10
// ---------------------------------------------------------------------------

describe('isAllFailed', () => {
  it('returns true when all platforms have status "failed"', () => {
    const results = {
      youtube: { status: 'failed', post_id: null, error: 'API error' },
      tiktok: { status: 'failed', post_id: null, error: 'Auth error' },
    };
    expect(isAllFailed(results)).toBe(true);
  });

  it('returns false when at least one platform has status "success"', () => {
    const results = {
      youtube: { status: 'success', post_id: 'yt-123', error: null },
      tiktok: { status: 'failed', post_id: null, error: 'Auth error' },
    };
    expect(isAllFailed(results)).toBe(false);
  });

  it('returns false when at least one platform has status "skipped"', () => {
    const results = {
      youtube: { status: 'failed', post_id: null, error: 'error' },
      tiktok: { status: 'skipped', post_id: null, error: null },
    };
    expect(isAllFailed(results)).toBe(false);
  });

  it('returns false for empty results object', () => {
    expect(isAllFailed({})).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAllFailed(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAllFailed(undefined)).toBe(false);
  });

  it('returns true for a single platform with status "failed"', () => {
    expect(isAllFailed({ youtube: { status: 'failed', error: 'err' } })).toBe(true);
  });

  it('returns false for a single platform with status "success"', () => {
    expect(isAllFailed({ youtube: { status: 'success', post_id: 'id' } })).toBe(false);
  });

  it('handles all four platforms all failed', () => {
    const results = {
      youtube: { status: 'failed', error: 'e' },
      tiktok: { status: 'failed', error: 'e' },
      facebook: { status: 'failed', error: 'e' },
      instagram: { status: 'failed', error: 'e' },
    };
    expect(isAllFailed(results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// determinePublishStatus — Req 11.10
// ---------------------------------------------------------------------------

describe('determinePublishStatus', () => {
  // Success scenarios
  describe('success', () => {
    it('returns "success" when all platforms succeeded', () => {
      const results = {
        youtube: { status: 'success' },
        tiktok: { status: 'success' },
      };
      expect(determinePublishStatus(results)).toBe('success');
    });

    it('returns "success" for a single successful platform', () => {
      expect(determinePublishStatus({ youtube: { status: 'success' } })).toBe('success');
    });
  });

  // Failed scenarios
  describe('failed', () => {
    it('returns "failed" when all platforms failed', () => {
      const results = {
        youtube: { status: 'failed' },
        tiktok: { status: 'failed' },
      };
      expect(determinePublishStatus(results)).toBe('failed');
    });

    it('returns "failed" for a single failed platform', () => {
      expect(determinePublishStatus({ youtube: { status: 'failed' } })).toBe('failed');
    });

    it('returns "failed" for null input', () => {
      expect(determinePublishStatus(null)).toBe('failed');
    });

    it('returns "failed" for undefined input', () => {
      expect(determinePublishStatus(undefined)).toBe('failed');
    });

    it('returns "failed" when all four platforms fail', () => {
      const results = {
        youtube: { status: 'failed' },
        tiktok: { status: 'failed' },
        facebook: { status: 'failed' },
        instagram: { status: 'failed' },
      };
      expect(determinePublishStatus(results)).toBe('failed');
    });
  });

  // Partial scenarios
  describe('partial', () => {
    it('returns "partial" when some platforms succeed and some fail', () => {
      const results = {
        youtube: { status: 'success' },
        tiktok: { status: 'failed' },
      };
      expect(determinePublishStatus(results)).toBe('partial');
    });

    it('returns "partial" for success + failed + skipped mix', () => {
      const results = {
        youtube: { status: 'success' },
        tiktok: { status: 'failed' },
        facebook: { status: 'skipped' },
      };
      expect(determinePublishStatus(results)).toBe('partial');
    });

    it('returns "partial" when only one platform succeeds out of four', () => {
      const results = {
        youtube: { status: 'failed' },
        tiktok: { status: 'failed' },
        facebook: { status: 'failed' },
        instagram: { status: 'success' },
      };
      expect(determinePublishStatus(results)).toBe('partial');
    });
  });

  // Skipped scenarios
  describe('skipped', () => {
    it('returns "skipped" when all platforms are skipped', () => {
      const results = {
        youtube: { status: 'skipped' },
        tiktok: { status: 'skipped' },
      };
      expect(determinePublishStatus(results)).toBe('skipped');
    });

    it('returns "skipped" for all platforms with "skipped: no video"', () => {
      const results = {
        youtube: { status: 'skipped: no video' },
        tiktok: { status: 'skipped: no video' },
        facebook: { status: 'skipped: no video' },
      };
      expect(determinePublishStatus(results)).toBe('skipped');
    });

    it('returns "skipped" for empty results', () => {
      expect(determinePublishStatus({})).toBe('skipped');
    });
  });
});

// ---------------------------------------------------------------------------
// buildPlatformResults — Req 11.10
// ---------------------------------------------------------------------------

describe('buildPlatformResults', () => {
  it('builds result for each platform from results map', () => {
    const platforms = ['youtube', 'tiktok'];
    const results = {
      youtube: { status: 'success', post_id: 'yt-abc', error: null },
      tiktok: { status: 'failed', post_id: null, error: 'TikTok API error' },
    };

    const output = buildPlatformResults(platforms, results);
    expect(output.youtube.status).toBe('success');
    expect(output.youtube.post_id).toBe('yt-abc');
    expect(output.tiktok.status).toBe('failed');
    expect(output.tiktok.error).toBe('TikTok API error');
  });

  it('defaults missing platforms to { status: "skipped", post_id: null, error: null }', () => {
    const platforms = ['youtube', 'facebook'];
    const results = {
      youtube: { status: 'success', post_id: 'yt-xyz', error: null },
    };

    const output = buildPlatformResults(platforms, results);
    expect(output.facebook).toEqual({ status: 'skipped', post_id: null, error: null });
  });

  it('preserves ayrshare_post_id when present', () => {
    const platforms = ['youtube'];
    const results = {
      youtube: { status: 'success', post_id: null, ayrshare_post_id: 'ayr-123', error: null },
    };

    const output = buildPlatformResults(platforms, results);
    expect(output.youtube.ayrshare_post_id).toBe('ayr-123');
  });

  it('does not add ayrshare_post_id key when not in result', () => {
    const platforms = ['tiktok'];
    const results = {
      tiktok: { status: 'success', post_id: 'tt-1', error: null },
    };

    const output = buildPlatformResults(platforms, results);
    expect('ayrshare_post_id' in output.tiktok).toBe(false);
  });

  it('handles empty platforms array', () => {
    expect(buildPlatformResults([], { youtube: { status: 'success' } })).toEqual({});
  });

  it('handles null results', () => {
    const output = buildPlatformResults(['youtube'], null);
    expect(output.youtube).toEqual({ status: 'skipped', post_id: null, error: null });
  });

  it('handles all four platforms', () => {
    const platforms = ['youtube', 'tiktok', 'facebook', 'instagram'];
    const results = {
      youtube: { status: 'success', post_id: 'yt1', error: null },
      tiktok: { status: 'success', post_id: 'tt1', error: null },
      facebook: { status: 'failed', post_id: null, error: 'FB error' },
      instagram: { status: 'skipped: no video', post_id: null, error: null },
    };

    const output = buildPlatformResults(platforms, results);
    expect(Object.keys(output)).toHaveLength(4);
    expect(output.youtube.status).toBe('success');
    expect(output.facebook.status).toBe('failed');
    expect(output.instagram.status).toBe('skipped: no video');
  });
});
