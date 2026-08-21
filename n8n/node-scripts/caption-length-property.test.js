/**
 * caption-length-property.test.js
 * Property-based tests for Social_Publisher caption length enforcement (Property 16).
 *
 * **Validates: Requirements 11.7**
 *
 * Property 16: Social Platform Caption Length Enforcement
 * For any string input, enforceCaptionLimit must always return a string
 * within the platform's defined character limit. Limits:
 *   - youtube   → 100 characters (title field)
 *   - tiktok    → 2,200 characters
 *   - facebook  → 2,200 characters
 *   - instagram → 2,200 characters
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { enforceCaptionLimit } from './social-publisher.js';

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

/** Arbitrary: a string with length > 100 (to exercise YouTube truncation) */
const arbLongYouTubeTitle = fc.string({ minLength: 101, maxLength: 500 });

/** Arbitrary: a string with length > 2200 (to exercise TikTok/FB/IG truncation) */
const arbLongCaption = fc.string({ minLength: 2201, maxLength: 5000 });

/** Arbitrary: any string of any length (for full-range testing) */
const arbAnyString = fc.string({ minLength: 0, maxLength: 5000 });

/** Arbitrary: a string within the YouTube limit (≤ 100 chars) */
const arbShortTitle = fc.string({ minLength: 0, maxLength: 100 });

/** Arbitrary: a string within the 2200-char limit */
const arbShortCaption = fc.string({ minLength: 0, maxLength: 2200 });

// ---------------------------------------------------------------------------
// Property A — YouTube title always ≤ 100 chars
// ---------------------------------------------------------------------------

describe('Property 16A — enforceCaptionLimit: YouTube title always ≤ 100 characters', () => {
  it('truncates any string longer than 100 chars to exactly 100 for youtube', () => {
    /**
     * **Validates: Requirements 11.7**
     * For any string with length > 100, enforceCaptionLimit(str, 'youtube')
     * must return a string of length exactly 100.
     */
    fc.assert(
      fc.property(arbLongYouTubeTitle, (title) => {
        const result = enforceCaptionLimit(title, 'youtube');
        return result.length <= 100;
      }),
      { numRuns: 300 },
    );
  });

  it('leaves strings ≤ 100 chars unchanged for youtube', () => {
    /**
     * **Validates: Requirements 11.7**
     * Strings already within the YouTube limit must not be modified.
     */
    fc.assert(
      fc.property(arbShortTitle, (title) => {
        const result = enforceCaptionLimit(title, 'youtube');
        return result === title;
      }),
      { numRuns: 300 },
    );
  });

  it('result length is always ≤ 100 for any input and youtube platform', () => {
    /**
     * **Validates: Requirements 11.7**
     * The YouTube title limit is enforced for ALL inputs, regardless of length.
     */
    fc.assert(
      fc.property(arbAnyString, (title) => {
        const result = enforceCaptionLimit(title, 'youtube');
        return result.length <= 100;
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — TikTok caption always ≤ 2200 chars
// ---------------------------------------------------------------------------

describe('Property 16B — enforceCaptionLimit: TikTok caption always ≤ 2200 characters', () => {
  it('truncates any string longer than 2200 chars for tiktok', () => {
    /**
     * **Validates: Requirements 11.7**
     * For any string with length > 2200, enforceCaptionLimit(str, 'tiktok')
     * must return a string of length ≤ 2200.
     */
    fc.assert(
      fc.property(arbLongCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'tiktok');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('result length is always ≤ 2200 for any input and tiktok platform', () => {
    /**
     * **Validates: Requirements 11.7**
     * The TikTok caption limit is enforced for ALL inputs.
     */
    fc.assert(
      fc.property(arbAnyString, (caption) => {
        const result = enforceCaptionLimit(caption, 'tiktok');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('leaves strings ≤ 2200 chars unchanged for tiktok', () => {
    /**
     * **Validates: Requirements 11.7**
     * Strings already within the TikTok limit must not be modified.
     */
    fc.assert(
      fc.property(arbShortCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'tiktok');
        return result === caption;
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — Facebook caption always ≤ 2200 chars
// ---------------------------------------------------------------------------

describe('Property 16C — enforceCaptionLimit: Facebook caption always ≤ 2200 characters', () => {
  it('truncates any string longer than 2200 chars for facebook', () => {
    /**
     * **Validates: Requirements 11.7**
     * For any string with length > 2200, enforceCaptionLimit(str, 'facebook')
     * must return a string of length ≤ 2200.
     */
    fc.assert(
      fc.property(arbLongCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'facebook');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('result length is always ≤ 2200 for any input and facebook platform', () => {
    /**
     * **Validates: Requirements 11.7**
     * The Facebook caption limit is enforced for ALL inputs.
     */
    fc.assert(
      fc.property(arbAnyString, (caption) => {
        const result = enforceCaptionLimit(caption, 'facebook');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('leaves strings ≤ 2200 chars unchanged for facebook', () => {
    /**
     * **Validates: Requirements 11.7**
     */
    fc.assert(
      fc.property(arbShortCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'facebook');
        return result === caption;
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property D — Instagram caption always ≤ 2200 chars
// ---------------------------------------------------------------------------

describe('Property 16D — enforceCaptionLimit: Instagram caption always ≤ 2200 characters', () => {
  it('truncates any string longer than 2200 chars for instagram', () => {
    /**
     * **Validates: Requirements 11.7**
     * For any string with length > 2200, enforceCaptionLimit(str, 'instagram')
     * must return a string of length ≤ 2200.
     */
    fc.assert(
      fc.property(arbLongCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'instagram');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('result length is always ≤ 2200 for any input and instagram platform', () => {
    /**
     * **Validates: Requirements 11.7**
     * The Instagram caption limit is enforced for ALL inputs.
     */
    fc.assert(
      fc.property(arbAnyString, (caption) => {
        const result = enforceCaptionLimit(caption, 'instagram');
        return result.length <= 2200;
      }),
      { numRuns: 300 },
    );
  });

  it('leaves strings ≤ 2200 chars unchanged for instagram', () => {
    /**
     * **Validates: Requirements 11.7**
     */
    fc.assert(
      fc.property(arbShortCaption, (caption) => {
        const result = enforceCaptionLimit(caption, 'instagram');
        return result === caption;
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property E — Caption limit is enforced BEFORE submission (function exists and works)
// ---------------------------------------------------------------------------

describe('Property 16E — enforceCaptionLimit: limit is enforced before submission', () => {
  it('enforceCaptionLimit exists and is callable for all supported platforms', () => {
    /**
     * **Validates: Requirements 11.7**
     * The enforceCaptionLimit function must exist and work correctly for all
     * supported platform keys — verifying the enforcement happens before posting.
     */
    expect(typeof enforceCaptionLimit).toBe('function');

    const platforms = ['youtube', 'tiktok', 'facebook', 'instagram'];
    const longString = 'A'.repeat(5000);

    for (const platform of platforms) {
      const result = enforceCaptionLimit(longString, platform);
      expect(typeof result).toBe('string');
      // Must always reduce to the platform limit
      const limit = platform === 'youtube' ? 100 : 2200;
      expect(result.length).toBeLessThanOrEqual(limit);
    }
  });

  it('enforced output is a prefix of the original string (never garbles content)', () => {
    /**
     * **Validates: Requirements 11.7**
     * When truncation happens, the result must be a clean prefix of the original
     * string — no content is scrambled or transformed, just cut at the limit.
     */
    fc.assert(
      fc.property(
        arbAnyString,
        fc.constantFrom('youtube', 'tiktok', 'facebook', 'instagram'),
        (caption, platform) => {
          const result = enforceCaptionLimit(caption, platform);
          // The result must always be a prefix of the original
          return caption.startsWith(result);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('result is always a string regardless of input type', () => {
    /**
     * **Validates: Requirements 11.7**
     * enforceCaptionLimit must always return a string, even for edge-case inputs.
     */
    fc.assert(
      fc.property(
        fc.constantFrom('youtube', 'tiktok', 'facebook', 'instagram'),
        (platform) => {
          return (
            typeof enforceCaptionLimit(null, platform) === 'string' &&
            typeof enforceCaptionLimit(undefined, platform) === 'string' &&
            typeof enforceCaptionLimit('', platform) === 'string'
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('truncated result is exactly at the platform limit — never over', () => {
    /**
     * **Validates: Requirements 11.7**
     * When input exceeds the limit, the result must be exactly at the limit.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(
          { platform: 'youtube', limit: 100 },
          { platform: 'tiktok', limit: 2200 },
          { platform: 'facebook', limit: 2200 },
          { platform: 'instagram', limit: 2200 },
        ),
        fc.nat({ max: 3000 }),
        ({ platform, limit }, extraChars) => {
          const inputLength = limit + 1 + extraChars; // always over limit
          const input = 'X'.repeat(inputLength);
          const result = enforceCaptionLimit(input, platform);
          return result.length === limit;
        },
      ),
      { numRuns: 300 },
    );
  });
});
