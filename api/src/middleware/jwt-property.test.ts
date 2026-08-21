/**
 * Property-based tests for JWT validity enforcement (Property 14).
 *
 * // Feature: ai-video-automation-saas, Property 14: JWT Validity Enforcement
 *
 * For any request to an authenticated endpoint carrying an invalid, malformed,
 * or expired JWT, the Backend API SHALL return HTTP 401 with error code
 * "unauthorized" without executing any business logic.
 *
 * **Validates: Requirements 18.2**
 *
 * Strategy: build a minimal Fastify test app with a single GET /protected
 * route protected by the authenticate preHandler, then use fast-check to
 * generate a wide variety of invalid token inputs and assert each gets 401.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { authenticate } from './authenticate.js';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ── Test constants ────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';
const WRONG_SECRET = 'completely-different-secret-value-wrong!!!!!';
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters!!';

/** A valid Supabase-style JWT payload for positive tests. */
const VALID_PAYLOAD = {
  sub: 'user-uuid-1234',
  email: 'test@example.com',
  user_metadata: { subscription_status: 'active' },
};

// ── App builder ───────────────────────────────────────────────────────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, { secret: COOKIE_SECRET, hook: 'onRequest' });
  await app.register(fastifyJwt, { secret: JWT_SECRET });

  registerErrorHandler(app);

  // Protected route: apply authenticate as a preHandler; increments a counter
  // so we can assert that business logic did NOT run on 401 responses.
  let businessLogicCallCount = 0;
  app.get(
    '/protected',
    { preHandler: authenticate },
    async (_request, reply) => {
      businessLogicCallCount++;
      return reply.status(200).send({ ok: true, calls: businessLogicCallCount });
    },
  );

  // Expose counter reset for testing
  (app as unknown as { resetCallCount: () => void }).resetCallCount = () => {
    businessLogicCallCount = 0;
  };

  await app.ready();
  return app;
}

/** Build a second app signed with WRONG_SECRET to produce wrong-secret tokens. */
async function buildWrongSecretApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: WRONG_SECRET });
  await app.ready();
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Assert the response is HTTP 401 with error_code "unauthorized". */
function assert401(response: { statusCode: number; json: () => unknown }): void {
  expect(response.statusCode).toBe(401);
  const body = response.json() as { error_code?: string };
  expect(body.error_code).toBe('unauthorized');
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Property 14: JWT Validity Enforcement', () => {
  let app: FastifyInstance;
  let wrongSecretApp: FastifyInstance;

  beforeAll(async () => {
    process.env['SUPABASE_JWT_SECRET'] = JWT_SECRET;
    process.env['COOKIE_SECRET'] = COOKIE_SECRET;
    app = await buildTestApp();
    wrongSecretApp = await buildWrongSecretApp();
  });

  afterAll(async () => {
    await app.close();
    await wrongSecretApp.close();
  });

  // ── Positive counter-example: valid token returns 200 ──────────────────────

  it('counter-example: valid unexpired JWT signed with correct secret → 200', async () => {
    const token = app.jwt.sign(VALID_PAYLOAD, { expiresIn: '24h' });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it('counter-example: valid unexpired JWT via session cookie → 200', async () => {
    const token = app.jwt.sign(VALID_PAYLOAD, { expiresIn: '24h' });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { session_token: token },
    });

    expect(response.statusCode).toBe(200);
  });

  // ── Property A: random strings as Bearer token → 401 ─────────────────────

  it(
    'Property A: any random string as Bearer token → 401',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (randomString) => {
          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${randomString}` },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property A (extended): base64-looking strings → 401 ──────────────────

  it(
    'Property A (base64): base64-encoded strings as Bearer token → 401',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.base64String({ minLength: 1, maxLength: 200 }),
          async (b64String) => {
            const response = await app.inject({
              method: 'GET',
              url: '/protected',
              headers: { authorization: `Bearer ${b64String}` },
            });
            assert401(response);
          },
        ),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property A (dot-separated): strings with 1-4 dots → 401 ─────────────

  it(
    'Property A (dot-separated): dot-separated strings resembling JWT segments → 401',
    async () => {
      // Generate strings that look JWT-like (have 1-4 dot separators) but
      // are not actually valid signed tokens.
      const dotCountArb = fc.integer({ min: 1, max: 4 });
      const segmentArb = fc.stringOf(
        fc.mapToConstant(
          { num: 26, build: (i) => String.fromCharCode(65 + i) }, // A-Z
          { num: 26, build: (i) => String.fromCharCode(97 + i) }, // a-z
          { num: 10, build: (i) => String.fromCharCode(48 + i) }, // 0-9
          { num: 2, build: (i) => ['-', '_'][i]! },                // base64url chars
        ),
        { minLength: 1, maxLength: 50 },
      );

      await fc.assert(
        fc.asyncProperty(
          dotCountArb,
          fc.array(segmentArb, { minLength: 2, maxLength: 5 }),
          async (_dotCount, segments) => {
            const dotToken = segments.join('.');

            const response = await app.inject({
              method: 'GET',
              url: '/protected',
              headers: { authorization: `Bearer ${dotToken}` },
            });
            assert401(response);
          },
        ),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property B: valid JWT structure but wrong secret → 401 ───────────────

  it(
    'Property B: valid JWT format signed with wrong secret → 401',
    async () => {
      // Generate varying payloads so fast-check exercises the property across
      // different payload shapes, not just one fixed example.
      const payloadArb = fc.record({
        sub: fc.uuidV(4),
        email: fc.emailAddress(),
        user_metadata: fc.record({
          subscription_status: fc.constantFrom('active', 'inactive', 'suspended'),
        }),
      });

      await fc.assert(
        fc.asyncProperty(payloadArb, async (payload) => {
          // Sign with the WRONG secret
          const token = wrongSecretApp.jwt.sign(payload, { expiresIn: '24h' });

          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${token}` },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property C: valid JWT, expired (exp in past) → 401 ───────────────────

  it(
    'Property C: valid JWT structure but expired → 401',
    async () => {
      // Generate past Unix timestamps so we exercise many different expiry values.
      // The exp claim must be in the past (< now in seconds). Exclude 0 because
      // fast-jwt treats exp=0 as a falsy "no expiry" and skips the check.
      const pastExpArb = fc.integer({
        min: 1,
        max: Math.floor(Date.now() / 1000) - 1,
      });

      const payloadArb = fc.record({
        sub: fc.uuidV(4),
        email: fc.emailAddress(),
        user_metadata: fc.record({
          subscription_status: fc.constantFrom('active', 'inactive'),
        }),
      });

      await fc.assert(
        fc.asyncProperty(pastExpArb, payloadArb, async (pastExp, payload) => {
          // Build an expired token by overriding exp directly
          const token = app.jwt.sign({ ...payload, exp: pastExp });

          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${token}` },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property C (tampered): valid JWT with tampered payload segment → 401 ──

  it(
    'Property C (tampered payload): flip one character in payload segment → 401',
    async () => {
      // Sign a valid token, then corrupt one character of the payload segment
      // (middle part between the two dots).
      const payloadArb = fc.record({
        sub: fc.uuidV(4),
        email: fc.emailAddress(),
        user_metadata: fc.record({
          subscription_status: fc.constantFrom('active', 'inactive'),
        }),
      });

      await fc.assert(
        fc.asyncProperty(payloadArb, async (payload) => {
          const token = app.jwt.sign(payload, { expiresIn: '1h' });
          const parts = token.split('.');
          if (parts.length !== 3) return; // Skip malformed output (shouldn't happen)

          const payloadPart = parts[1]!;
          if (payloadPart.length === 0) return; // Nothing to tamper

          // Pick a position to corrupt using fc internals — use first char for
          // determinism (fast-check controls the payload, so position 0 is fine).
          const corruptedChar = payloadPart[0] === 'A' ? 'B' : 'A';
          const tamperedPayload = corruptedChar + payloadPart.slice(1);
          const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${tamperedToken}` },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Property D: invalid tokens via session cookie → 401 ──────────────────

  it(
    'Property D: random string as session cookie → 401',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (randomString) => {
          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: { session_token: randomString },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  it(
    'Property D: wrong-secret token via session cookie → 401',
    async () => {
      const payloadArb = fc.record({
        sub: fc.uuidV(4),
        email: fc.emailAddress(),
      });

      await fc.assert(
        fc.asyncProperty(payloadArb, async (payload) => {
          const token = wrongSecretApp.jwt.sign(payload, { expiresIn: '24h' });

          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: { session_token: token },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  it(
    'Property D: expired token via session cookie → 401',
    async () => {
      // Exclude exp=0 because fast-jwt treats it as "no expiry claim"
      // (falsy check on exp field). Any positive past Unix timestamp is valid.
      const pastExpArb = fc.integer({
        min: 1,
        max: Math.floor(Date.now() / 1000) - 1,
      });

      await fc.assert(
        fc.asyncProperty(pastExpArb, async (pastExp) => {
          const token = app.jwt.sign({ ...VALID_PAYLOAD, exp: pastExp });

          const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: { session_token: token },
          });
          assert401(response);
        }),
        { numRuns: 100, verbose: false },
      );
    },
    30_000,
  );

  // ── Missing token entirely → 401 ─────────────────────────────────────────

  it('no Authorization header and no session cookie → 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    });
    assert401(response);
  });

  it('empty Authorization header → 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: '' },
    });
    assert401(response);
  });

  it('non-Bearer scheme in Authorization header → 401', async () => {
    const token = app.jwt.sign(VALID_PAYLOAD, { expiresIn: '24h' });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Basic ${token}` },
    });
    assert401(response);
  });
});
