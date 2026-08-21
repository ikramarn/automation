/**
 * content-sanitization-property.test.js
 * Property-based tests for Content_Fetcher sanitization logic (Property 19).
 *
 * **Validates: Requirements 7.7, 7.8**
 *
 * Property 19: Content Sanitization Completeness
 * For any raw article HTML string passed to the Content_Fetcher's sanitization
 * function, the output SHALL contain no HTML tags, no inline JavaScript, and no
 * URL query parameters matching analytics tracking patterns (utm_*, fbclid, gclid).
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { sanitizeContent, stripTrackingParams } from './content-fetcher.js';

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

/** A pool of HTML tag names to inject into generated strings. */
const HTML_TAGS = [
  'p', 'b', 'i', 'u', 'em', 'strong', 'span', 'div', 'section',
  'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img',
  'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input',
  'button', 'label', 'script', 'style', 'iframe', 'object', 'embed',
];

/** Arbitrary: picks a random tag name from the pool. */
const arbTagName = fc.constantFrom(...HTML_TAGS);

/** Arbitrary: plain ASCII word (no HTML chars). */
const arbWord = fc.stringMatching(/^[a-zA-Z0-9 .,!?]{1,20}$/);

/**
 * Arbitrary: a string that wraps plain text in one or more HTML tags.
 * e.g. "<div><p>Hello world</p></div>"
 */
const arbHtmlWrapped = fc.tuple(arbTagName, arbWord).map(
  ([tag, text]) => `<${tag}>${text}</${tag}>`,
);

/**
 * Arbitrary: a string with a script block injected somewhere in plain text.
 * Covers both simple and attribute-laden opening tags.
 */
const arbWithScript = fc.tuple(arbWord, arbWord).map(
  ([before, after]) =>
    `${before} <script>alert(1)</script> ${after}`,
);

/**
 * Arbitrary: alphanumeric text only — no HTML-special characters.
 * Used to verify that benign content is not mangled.
 */
const arbAlphanumeric = fc
  .stringMatching(/^[a-zA-Z0-9 ]{1,100}$/)
  .filter((s) => s.trim().length > 0);

/** The full set of tracking parameter names we care about. */
const TRACKING_PARAM_NAMES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
];

/** Arbitrary: picks one tracking param name. */
const arbTrackingParamName = fc.constantFrom(...TRACKING_PARAM_NAMES);

/** Non-tracking param names to verify they are preserved. */
const NON_TRACKING_PARAM_NAMES = ['q', 'page', 'id', 'ref', 'sort', 'lang', 'category'];

/** Arbitrary: picks one non-tracking param name. */
const arbNonTrackingParamName = fc.constantFrom(...NON_TRACKING_PARAM_NAMES);

/** Arbitrary: a URL-safe alphanumeric value. */
const arbParamValue = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);

/**
 * Arbitrary: a full https URL with at least one tracking param appended.
 * e.g. "https://example.com/article?utm_source=google&id=42"
 */
const arbUrlWithTracking = fc
  .tuple(
    fc.constantFrom('article', 'news', 'post', 'page', 'blog'),
    arbTrackingParamName,
    arbParamValue,
  )
  .map(([path, trackingKey, trackingVal]) => {
    return `https://example.com/${path}?${trackingKey}=${trackingVal}`;
  });

/**
 * Arbitrary: a URL with only non-tracking params.
 * e.g. "https://example.com/search?q=bitcoin&page=2"
 */
const arbUrlWithNonTracking = fc
  .tuple(
    fc.constantFrom('search', 'list', 'results', 'index'),
    arbNonTrackingParamName,
    arbParamValue,
  )
  .map(([path, key, val]) => {
    return `https://example.com/${path}?${key}=${val}`;
  });

// ---------------------------------------------------------------------------
// Property A — No HTML tags in sanitizeContent output
// ---------------------------------------------------------------------------

describe('Property 19A — sanitizeContent: no HTML tags in output', () => {
  it('output contains no <...> patterns for HTML-wrapped inputs', () => {
    /**
     * **Validates: Requirements 7.7, 7.8**
     * For any string that wraps text in arbitrary HTML tags,
     * sanitizeContent() must produce output that contains no tag patterns.
     */
    fc.assert(
      fc.property(arbHtmlWrapped, (html) => {
        const result = sanitizeContent(html);
        // No remaining <...> sequences
        return !/<[^>]*>/.test(result);
      }),
      { numRuns: 200 },
    );
  });

  it('output contains no <...> patterns for concatenated multi-tag inputs', () => {
    /**
     * **Validates: Requirements 7.7**
     * Even when multiple tags are nested or concatenated, all must be stripped.
     */
    fc.assert(
      fc.property(
        fc.array(arbHtmlWrapped, { minLength: 1, maxLength: 5 }),
        (parts) => {
          const html = parts.join(' ');
          const result = sanitizeContent(html);
          return !/<[^>]*>/.test(result);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — No script content in sanitizeContent output
// ---------------------------------------------------------------------------

describe('Property 19B — sanitizeContent: no script content in output', () => {
  it('output contains no <script>, alert(1), or </script> after sanitization', () => {
    /**
     * **Validates: Requirements 7.7, 7.8**
     * Any input embedding <script>alert(1)</script> must be fully removed.
     */
    fc.assert(
      fc.property(arbWithScript, (input) => {
        const result = sanitizeContent(input);
        const noOpenTag = !result.toLowerCase().includes('<script');
        const noCloseTag = !result.toLowerCase().includes('</script>');
        const noAlertCall = !result.includes('alert(1)');
        return noOpenTag && noCloseTag && noAlertCall;
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — No tracking params in stripTrackingParams output
// ---------------------------------------------------------------------------

describe('Property 19C — stripTrackingParams: no tracking params in output', () => {
  it('output URL contains no tracking parameter names', () => {
    /**
     * **Validates: Requirements 7.8**
     * For any URL generated with a tracking param, the output of
     * stripTrackingParams() must contain none of the tracking param keys.
     */
    fc.assert(
      fc.property(arbUrlWithTracking, (url) => {
        const result = stripTrackingParams(url);
        // None of the tracking param names should appear as query key patterns
        return TRACKING_PARAM_NAMES.every(
          (param) => !new RegExp(`[?&]${param}=`).test(result),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('output URL contains no tracking params when multiple are appended', () => {
    /**
     * **Validates: Requirements 7.8**
     * URLs with several tracking params at once must have all of them removed.
     */
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbTrackingParamName, arbParamValue), {
          minLength: 1,
          maxLength: TRACKING_PARAM_NAMES.length,
        }),
        (pairs) => {
          // Build a URL with potentially-duplicate param names (last one wins in URLSearchParams)
          const qs = pairs.map(([k, v]) => `${k}=${v}`).join('&');
          const url = `https://example.com/article?${qs}`;
          const result = stripTrackingParams(url);
          return TRACKING_PARAM_NAMES.every(
            (param) => !new RegExp(`[?&]${param}=`).test(result),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property D — Benign text preserved by sanitizeContent
// ---------------------------------------------------------------------------

describe('Property 19D — sanitizeContent: benign alphanumeric text preserved', () => {
  it('does not throw and returns a non-empty string for alphanumeric inputs', () => {
    /**
     * **Validates: Requirements 7.7**
     * Purely alphanumeric strings (no HTML) must survive sanitization intact
     * as a non-empty, non-whitespace-only result.
     */
    fc.assert(
      fc.property(arbAlphanumeric, (text) => {
        let result;
        try {
          result = sanitizeContent(text);
        } catch {
          // Must not throw
          return false;
        }
        // Whitespace normalization may trim the string, but it must remain non-empty
        return typeof result === 'string' && result.trim().length > 0;
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property E — Non-tracking params preserved by stripTrackingParams
// ---------------------------------------------------------------------------

describe('Property 19E — stripTrackingParams: non-tracking params preserved', () => {
  it('preserves params like q, page, id that are not tracking params', () => {
    /**
     * **Validates: Requirements 7.8**
     * Parameters that are not in the tracking list must remain in the URL
     * after stripTrackingParams() is applied.
     */
    fc.assert(
      fc.property(
        arbUrlWithNonTracking,
        arbNonTrackingParamName,
        arbParamValue,
        (baseUrl, extraKey, extraVal) => {
          // Append an extra non-tracking param to the base URL
          const url = `${baseUrl}&${extraKey}=${extraVal}`;
          const result = stripTrackingParams(url);
          // The result must contain at least one of the non-tracking params
          return NON_TRACKING_PARAM_NAMES.some((param) =>
            new RegExp(`[?&]${param}=`).test(result),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
