/**
 * Input sanitization utilities.
 *
 * Pure functions for stripping unsafe content from user-supplied strings and
 * detecting prompt injection patterns before passing data to downstream APIs
 * (OpenAI, HeyGen, etc.).
 *
 * Requirements: 18.8
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Regex that matches any HTML tag (opening, closing, self-closing, and
 * doctype/comment variants).
 */
const HTML_TAG_RE = /<[^>]*>/g;

/**
 * Regex that matches control characters unsafe in JSON strings:
 *   - U+0000–U+0008  (NUL through BS — excludes HT U+0009)
 *   - U+000B–U+000C  (VT, FF — excludes LF U+000A)
 *   - U+000E–U+001F  (SO through US — excludes CR U+000D)
 *   - U+007F         (DEL)
 *
 * Tab (U+0009), Line Feed (U+000A), and Carriage Return (U+000D) are
 * intentionally preserved as they are valid whitespace in most text inputs.
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Prompt injection patterns (case-insensitive).
 *
 * Any of these phrases in user input indicate an attempt to hijack the system
 * prompt or override model instructions.
 */
const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore previous instructions/i,
  /you are now/i,
  /disregard/i,
  /forget all/i,
  /system prompt/i,
];

// ── Pure utilities ────────────────────────────────────────────────────────────

/**
 * Removes all HTML tags (`<...>`) and unsafe control characters from the
 * input string.
 *
 * - HTML tags are replaced with an empty string (tag content is preserved).
 * - Control characters with code points 0–8, 11–12, 14–31, and 127 are
 *   stripped. Tab, LF, and CR are kept.
 *
 * @param input - Raw user-supplied string.
 * @returns String with HTML tags and control characters removed.
 */
export function stripHtml(input: string): string {
  return input.replace(HTML_TAG_RE, '').replace(CONTROL_CHAR_RE, '');
}

/**
 * Returns `true` when the input contains any prompt injection pattern.
 *
 * Patterns are matched case-insensitively. The check runs against the raw
 * (un-stripped) input so that injection attempts embedded in HTML are also
 * caught.
 *
 * @param input - Raw user-supplied string (before HTML stripping).
 * @returns `true` if a known injection pattern is found; `false` otherwise.
 */
export function hasPromptInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Strips HTML tags and control characters, then encodes the result for safe
 * embedding in a JSON string value.
 *
 * JSON encoding escapes `"`, `\`, and the remaining characters that are
 * illegal in JSON strings (U+0000–U+001F range still present after
 * `stripHtml`, i.e. Tab, LF, CR) as `\t`, `\n`, `\r`.  This prevents
 * JSON injection when the sanitized string is later serialised into an
 * OpenAI or HeyGen request payload.
 *
 * @param input - Raw user-supplied string.
 * @returns Sanitized, JSON-safe string.
 */
export function sanitizeString(input: string): string {
  const stripped = stripHtml(input);
  // JSON.stringify wraps in quotes and applies all necessary escaping.
  // Slice removes the surrounding double-quotes to get the escaped content.
  return JSON.stringify(stripped).slice(1, -1);
}

/**
 * Validates a single user-supplied string for injection and sanitizes it.
 *
 * - If a prompt injection pattern is detected, returns `{ rejected: true, clean: "" }`.
 * - Otherwise, returns `{ rejected: false, clean: sanitizeString(input) }`.
 *
 * @param input - Raw user-supplied string.
 * @returns Object with `rejected` flag and sanitized `clean` value.
 */
export function validateAndSanitize(input: string): { clean: string; rejected: boolean } {
  if (hasPromptInjection(input)) {
    return { rejected: true, clean: '' };
  }
  return { rejected: false, clean: sanitizeString(input) };
}
