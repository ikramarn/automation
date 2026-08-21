/**
 * Property-based and unit tests for credential masking (Property 1).
 *
 * **Validates: Requirements 3.4, 18.4**
 *
 * Verifies the `maskApiKey` / `maskValue` function in vault.ts:
 *   - Property A: Masking rule — masked output is always "••••" + key.slice(-4)
 *   - Property B: No key leakage — first (len - 4) characters are never exposed
 *   - Property C: Short keys — strings < 4 chars return "••••" with no key chars
 *   - Property D: Fixed prefix — masked value always starts with exactly "••••"
 *   - Property E: Fixed length — for keys ≥ 4, masked length = 4 bullet chars + 4 trailing chars
 *
 * The bullet character is U+2022 (•), which encodes to 3 bytes in UTF-8 but is
 * a single JS character — so "••••".length === 4.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { maskApiKey, maskValue } from './vault.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** The exact bullet prefix used by the masking function (4 × U+2022). */
const BULLET_PREFIX = '\u2022\u2022\u2022\u2022';

// ── Arbitraries ────────────────────────────────────────────────────────────

/** Keys of any printable length (1–128 chars), per task spec. */
const anyKey = fc.string({ minLength: 1, maxLength: 128 });

/** Keys that are long enough to show trailing chars (≥ 4 chars). */
const longKey = fc.string({ minLength: 4, maxLength: 128 });

/** Keys that are too short to expose trailing chars (1–3 chars). */
const shortKey = fc.string({ minLength: 1, maxLength: 3 });

// ── Property 1: Credential Masking Round-Trip ──────────────────────────────

describe('Property 1: Credential Masking Round-Trip', () => {

  // ── Property A — Masking rule ────────────────────────────────────────────

  it(
    'Property A — for any key ≥ 4 chars, masked output === "••••" + key.slice(-4)',
    () => {
      fc.assert(
        fc.property(longKey, (key) => {
          const masked = maskApiKey(key);
          const expected = `${BULLET_PREFIX}${key.slice(-4)}`;
          expect(masked).toBe(expected);
        }),
        { numRuns: 500 },
      );
    },
  );

  // ── Property B — No key leakage ──────────────────────────────────────────

  it(
    'Property B — for any key ≥ 9 chars, the hidden prefix (first len-4 chars) is not a substring of the masked value',
    () => {
      fc.assert(
        fc.property(
          // Use minLength 9 so hiddenPart is at least 5 chars long — long enough
          // that it cannot accidentally coincide with the 4-char visible suffix.
          // (A 1–4 char hidden prefix could legitimately overlap with the suffix,
          //  which is not a leak — e.g. key "AAAAA" → suffix "AAAA" contains "A".)
          fc.string({ minLength: 9, maxLength: 128 }),
          (key) => {
            const masked = maskApiKey(key);
            // Strip the bullet prefix to get only the visible trailing characters
            const visiblePart = masked.slice(BULLET_PREFIX.length); // last 4 chars of key
            // The hidden portion is everything before the last 4 characters
            const hiddenPart = key.slice(0, key.length - 4);
            // The full hidden prefix must not appear anywhere in the masked string
            expect(masked).not.toContain(hiddenPart);
            // The visible part must be exactly the last 4 chars of the key
            expect(visiblePart).toBe(key.slice(-4));
          },
        ),
        { numRuns: 500 },
      );
    },
  );

  // ── Property C — Short keys ───────────────────────────────────────────────

  it(
    'Property C — for any key < 4 chars, masked output is exactly "••••" with none of the key characters',
    () => {
      fc.assert(
        fc.property(shortKey, (key) => {
          const masked = maskApiKey(key);
          // Must be exactly the bullet prefix with no key characters appended
          expect(masked).toBe(BULLET_PREFIX);
          // Also verify none of the key's characters leak into the result
          for (const ch of key) {
            expect(masked).not.toContain(ch);
          }
        }),
        { numRuns: 300 },
      );
    },
  );

  // ── Property D — Fixed prefix ─────────────────────────────────────────────

  it(
    'Property D — for any key, masked value always starts with exactly "••••" (4 × U+2022)',
    () => {
      fc.assert(
        fc.property(anyKey, (key) => {
          const masked = maskApiKey(key);
          expect(masked.startsWith(BULLET_PREFIX)).toBe(true);
          // The prefix must be exactly 4 bullets — not 3, not 5
          expect(masked.slice(0, 4)).toBe(BULLET_PREFIX);
        }),
        { numRuns: 500 },
      );
    },
  );

  // ── Property E — Fixed length ─────────────────────────────────────────────

  it(
    'Property E — for any key ≥ 4 chars, masked length === 4 (bullets) + 4 (last chars) = 8',
    () => {
      fc.assert(
        fc.property(longKey, (key) => {
          const masked = maskApiKey(key);
          // "••••" is 4 JS characters + 4 trailing chars = 8 total
          expect(masked.length).toBe(8);
        }),
        { numRuns: 500 },
      );
    },
  );
});

// ── Unit Tests ─────────────────────────────────────────────────────────────

describe('maskApiKey — unit tests', () => {
  it('masks a typical API key (10 chars) → "••••" + last 4', () => {
    expect(maskApiKey('sk-abcdefgh')).toBe('••••efgh');
  });

  it('returns "••••" for a 3-char key (too short)', () => {
    expect(maskApiKey('abc')).toBe('••••');
  });

  it('masks an 8-char key → "••••" + last 4', () => {
    expect(maskApiKey('12345678')).toBe('••••5678');
  });

  it('masks a key of exactly 4 chars → "••••" + all 4 chars', () => {
    expect(maskApiKey('abcd')).toBe('••••abcd');
  });

  it('returns "••••" for a 1-char key', () => {
    expect(maskApiKey('x')).toBe('••••');
  });

  it('returns "••••" for an empty string', () => {
    // key.length === 0 < 4 → bullet-only branch
    expect(maskApiKey('')).toBe('••••');
  });

  it('uses the same logic for maskValue (alias)', () => {
    expect(maskValue('sk-abcdefgh')).toBe(maskApiKey('sk-abcdefgh'));
    expect(maskValue('abc')).toBe(maskApiKey('abc'));
  });
});
