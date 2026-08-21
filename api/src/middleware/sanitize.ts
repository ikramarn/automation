/**
 * Input sanitization preHandler middleware.
 *
 * Recursively traverses `request.body` and `request.query`, sanitizing every
 * string value in place:
 *
 *   - Strings containing prompt injection patterns → immediate HTTP 400
 *     `{ error_code: "invalid_input" }`
 *   - All other strings → HTML tags and control characters stripped, then
 *     encoded for JSON safety before reaching the route handler.
 *
 * Non-string values (numbers, booleans, null, arrays, objects) are traversed
 * but their non-string leaves are left unchanged.
 *
 * ── How to apply to route groups ────────────────────────────────────────────
 *
 * Import `sanitizeInputs` and add it as a `preHandler` hook on any route or
 * route group that accepts user-supplied text fields.
 *
 * Option A — per-route:
 *   app.post('/pipelines', { preHandler: [authenticate, csrfProtect, sanitizeInputs] }, handler);
 *
 * Option B — entire route group (recommended):
 *   async function pipelineRoutes(app: FastifyInstance) {
 *     app.addHook('preHandler', authenticate);
 *     app.addHook('preHandler', csrfProtect);
 *     app.addHook('preHandler', sanitizeInputs);  // sanitize all string fields
 *     app.post('/', createPipelineHandler);
 *     app.put('/:id', updatePipelineHandler);
 *   }
 *   await app.register(pipelineRoutes, { prefix: '/pipelines' });
 *
 * Routes that should apply sanitizeInputs (accept user-supplied text):
 *   /pipelines          — name, niche_keyword, script_tone, etc.
 *   /credentials        — API keys (masked after save; raw on write)
 *   /account            — display_name
 *   /account/notifications — (boolean fields only; safe to include anyway)
 *
 * Routes that do NOT need sanitizeInputs:
 *   /auth/*             — passwords are hashed, not passed to LLMs
 *   /webhooks/*         — Stripe signatures, not user text
 *   /internal/*         — service-token protected, not user-facing
 *
 * Requirements: 18.8
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { hasPromptInjection, sanitizeString } from '../lib/sanitize.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sanitizes a single user-supplied string value.
 *
 * - Strips HTML tags (`<...>` patterns).
 * - Strips control characters in range \x00-\x08\x0B\x0C\x0E-\x1F\x7F.
 * - Checks for prompt injection patterns (case-insensitive).
 * - Encodes the sanitized result for safe JSON embedding.
 *
 * @param value - Raw user-supplied string.
 * @returns Object with `sanitized` string and `injectionDetected` flag.
 *
 * Requirements: 18.8
 */
export function sanitizeInput(value: string): { sanitized: string; injectionDetected: boolean } {
  const injectionDetected = hasPromptInjection(value);
  const sanitized = injectionDetected ? '' : sanitizeString(value);
  return { sanitized, injectionDetected };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively walks a plain object/array and:
 *   - throws AppError(400, 'invalid_input') if any string contains an injection pattern
 *   - replaces every other string value in place with its sanitized form
 *
 * Only plain objects (`{}`) and arrays (`[]`) are traversed. Primitives that
 * are not strings (numbers, booleans, null) pass through unmodified.
 */
function sanitizeValue(value: unknown, parentObj: Record<string, unknown>, key: string): void;
function sanitizeValue(value: unknown, parentArr: unknown[], key: number): void;
function sanitizeValue(
  value: unknown,
  parent: Record<string, unknown> | unknown[],
  key: string | number,
): void {
  if (typeof value === 'string') {
    if (hasPromptInjection(value)) {
      throw new AppError(400, 'invalid_input', 'Input contains disallowed content');
    }
    (parent as Record<string | number, unknown>)[key] = sanitizeString(value);
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      sanitizeValue(value[i], value, i);
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      sanitizeValue(obj[k], obj, k);
    }
  }
}

/**
 * Recursively sanitizes all string fields within an arbitrary value.
 * Entry point used for request.body and request.query.
 */
function sanitizePayload(payload: unknown): void {
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      sanitizeValue(payload[i], payload, i);
    }
    return;
  }
  if (payload !== null && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      sanitizeValue(obj[k], obj, k);
    }
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook — input sanitization (body + query).
 *
 * Mutates `request.body` and `request.query` in place. Throws an AppError
 * (HTTP 400, error_code: "invalid_input") if any string value contains a
 * prompt injection pattern.
 *
 * Requirements: 18.8
 */
export async function sanitizeInputs(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (request.body !== undefined && request.body !== null) {
    sanitizePayload(request.body);
  }

  if (request.query !== undefined && request.query !== null) {
    sanitizePayload(request.query);
  }
}

/**
 * Fastify preHandler hook — body-only input sanitization.
 *
 * Recursively walks all string values in `request.body`:
 *   - If any string contains a prompt injection pattern: throws AppError(400, 'invalid_input').
 *   - Otherwise: replaces each string with its sanitized (HTML-stripped, JSON-encoded) form.
 *
 * Mutates `request.body` in-place. Does not touch `request.query`.
 *
 * Requirements: 18.8
 */
export async function sanitizeRequestBody(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (request.body !== undefined && request.body !== null) {
    sanitizePayload(request.body);
  }
}
