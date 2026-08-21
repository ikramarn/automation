/**
 * Property-based tests for input sanitization middleware (Property 9).
 *
 * **Validates: Requirements 18.8**
 *
 * Uses fast-check to verify that:
 *   - Any string embedding a known prompt injection pattern always returns HTTP 400
 *     with `error_code: "invalid_input"`.
 *   - Benign strings (alphanumeric + common punctuation, no injection patterns) are
 *     accepted and return HTTP 200.
 *   - HTML tags are stripped and the sanitized body contains no `<tag>` patterns.
 *   - Control characters (chr 0–8, 11–12, 14–31) are stripped from output.
 *
 * // Feature: ai-video-automation-saas, Property 9: Input Sanitization — Injection
 * // Rejection and Benign Pass-Through
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { sanitizeInputs } from './sanitize.js';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** All injection patterns the middleware is required to block (case-insensitive). */
const INJECTION_PATTERNS = [
  'ignore previous instructions',
  'you are now',
  'disregard',
  'forget all',
  'system prompt',
] as const;

/**
 * Control character code-points stripped by sanitizeString:
 *   U+0000–U+0008, U+000B, U+000C, U+000E–U+001F
 * (Tab U+0009, LF U+000A, and CR U+000D are intentionally preserved.)
 */
const CONTROL_CHAR_CODE_POINTS = [
  ...Array.from({ length: 9 }, (_, i) => i),       // 0–8
  0x0b, 0x0c,                                        // 11, 12
  ...Array.from({ length: 18 }, (_, i) => i + 14),  // 14–31
] as const;

// ── Test app ──────────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  const echoHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ body: req.body });
  };

  app.post<{ Body: Record<string, unknown> }>(
    '/test',
    { preHandler: sanitizeInputs },
    echoHandler,
  );

  await app.ready();
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * POST { text: value } to /test and return the Fastify inject response.
 */
async function postText(app: FastifyInstance, text: string) {
  return app.inject({
    method: 'POST',
    url: '/test',
    payload: { text },
  });
}

/**
 * Returns true when `s` contains any of the injection patterns
 * (case-insensitive).  Used to pre-filter benign-string generators.
 */
function containsInjectionPattern(s: string): boolean {
  const lower = s.toLowerCase();
  return INJECTION_PATTERNS.some(p => lower.includes(p));
}

// ── Property 9 — Input Sanitization ──────────────────────────────────────────

describe('Property 9: Input Sanitization — Injection Rejection and Benign Pass-Through', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Property A — Injection rejection ─────────────────────────────────────

  it(
    'Property A — strings embedding any injection pattern → always 400 with error_code: "invalid_input"',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Choose one injection pattern at random
          fc.constantFrom(...INJECTION_PATTERNS),
          // Random prefix and suffix (printable ASCII, may include spaces)
          fc.string({ minLength: 0, maxLength: 40 }),
          fc.string({ minLength: 0, maxLength: 40 }),
          // Random case variation: 0 = lowercase, 1 = uppercase, 2 = mixed
          fc.integer({ min: 0, max: 2 }),
          async (pattern, prefix, suffix, caseVariant) => {
            const varied =
              caseVariant === 0
                ? pattern.toLowerCase()
                : caseVariant === 1
                  ? pattern.toUpperCase()
                  : pattern
                    .split('')
                    .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
                    .join('');

            const input = `${prefix}${varied}${suffix}`;
            const response = await postText(app, input);

            expect(response.statusCode).toBe(400);
            const body = response.json<{ error_code: string }>();
            expect(body.error_code).toBe('invalid_input');
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property B — Benign strings pass through ─────────────────────────────

  it(
    'Property B — benign strings (alphanumeric + common punctuation, no injection pattern) → 200',
    async () => {
      // Alphabet: printable ASCII chars that are commonly safe user input
      const benignAlphabet = fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?-_@#%&()[]{}:;/\\\'"+='
          .split(''),
      );

      await fc.assert(
        fc.asyncProperty(
          fc
            .array(benignAlphabet, { minLength: 1, maxLength: 120 })
            .map(chars => chars.join(''))
            .filter(s => !containsInjectionPattern(s)),
          async input => {
            const response = await postText(app, input);
            // Must NOT be a 400 — benign strings should be accepted
            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property C — HTML stripping ───────────────────────────────────────────

  it(
    'Property C — strings with HTML tags → 200, and sanitized output contains no <tag> patterns',
    async () => {
      // Generate a simple HTML tag name from a small safe set
      const tagName = fc.constantFrom('b', 'i', 'em', 'strong', 'div', 'span', 'p', 'script', 'a');
      // Text content that is benign (no injection patterns, no other tags)
      const safeText = fc
        .string({ minLength: 1, maxLength: 60 })
        .filter(s => !containsInjectionPattern(s) && !s.includes('<') && !s.includes('>'));

      await fc.assert(
        fc.asyncProperty(
          tagName,
          safeText,
          safeText,
          async (tag, textBefore, textAfter) => {
            const input = `${textBefore}<${tag}>${textAfter}</${tag}>`;
            const response = await postText(app, input);

            expect(response.statusCode).toBe(200);

            const data = response.json<{ body: { text: string } }>();
            const sanitized: string = data.body.text;

            // Must not contain tag patterns like <b> or </b>
            expect(sanitized).not.toMatch(/<[^>]*>/);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ── Property D — Control character stripping ─────────────────────────────

  it(
    'Property D — strings with control characters → 200, sanitized output has no control characters',
    async () => {
      // Safe base text (no injection, no control chars, no HTML)
      const safeText = fc
        .string({ minLength: 1, maxLength: 60 })
        .filter(
          s =>
            !containsInjectionPattern(s) &&
            !s.includes('<') &&
            !s.includes('>') &&
            !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s),
        );

      // A random control character from the set that should be stripped
      const controlChar = fc
        .integer({ min: 0, max: CONTROL_CHAR_CODE_POINTS.length - 1 })
        .map(i => String.fromCharCode(CONTROL_CHAR_CODE_POINTS[i]!));

      await fc.assert(
        fc.asyncProperty(safeText, controlChar, async (base, ctrl) => {
          // Embed one control char somewhere in the middle
          const mid = Math.floor(base.length / 2);
          const input = base.slice(0, mid) + ctrl + base.slice(mid);

          const response = await postText(app, input);
          expect(response.statusCode).toBe(200);

          const data = response.json<{ body: { text: string } }>();
          const sanitized: string = data.body.text;

          // Sanitized output must not contain any stripped control characters
          expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(sanitized)).toBe(false);
        }),
        { numRuns: 100 },
      );
    },
  );

  // ── Positive counter-examples ─────────────────────────────────────────────

  it('Positive counter-examples — specific benign strings → 200', async () => {
    const benignStrings = [
      'AI news in the tech industry',
      'latest developments in machine learning',
      'top 5 electric vehicles 2024',
      'how to grow your business online',
      'finance tips for small businesses',
      'Breaking: markets rally on Fed announcement',
      'Climate change: new research findings',
      'user-supplied keyword with punctuation!',
      '100% renewable energy by 2030',
      'C++ programming best practices',
      "what's new in TypeScript 5.x",
    ];

    for (const input of benignStrings) {
      const response = await postText(app, input);
      expect(
        response.statusCode,
        `Expected 200 for benign string: "${input}"`,
      ).toBe(200);
    }
  });
});
