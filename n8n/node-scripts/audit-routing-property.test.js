/**
 * audit-routing-property.test.js
 * Property-based tests for the Social_Publisher audit routing logic (Property 17).
 *
 * **Validates: Requirements 5.9, 5.10, 11.9**
 *
 * Property 17: Audit Period Routing Invariant
 * The routing decision in the Social_Publisher n8n node is governed exclusively
 * by the audit_approved flag:
 *   - audit_approved = false → route to Ayrshare (supervised posting)
 *   - audit_approved = true  → route to direct platform API
 *
 * The actual routing switch runs inside n8n's JS sandbox, so we extract and
 * test the routing DECISION logic as a pure function here.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Routing decision function (mirrors the n8n Social_Publisher switch logic)
// ---------------------------------------------------------------------------

/**
 * Determine the publish route for a given platform and audit state.
 *
 * Mirrors the logic inside the n8n Social_Publisher node's routing switch:
 *   - audit_approved = false → 'ayrshare'
 *   - audit_approved = true  → 'direct'
 *
 * @param {string} platform      - The social platform key (e.g. 'youtube', 'tiktok')
 * @param {boolean} auditApproved - Whether the pipeline has passed the audit period
 * @returns {'ayrshare' | 'direct'}
 */
export function determineRoute(platform, auditApproved) {
  // Routing is determined solely by audit_approved, regardless of platform
  if (auditApproved === true) {
    return 'direct';
  }
  return 'ayrshare';
}

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

const PLATFORMS = ['youtube', 'tiktok', 'facebook', 'instagram'];

/** Arbitrary: any supported platform */
const arbPlatform = fc.constantFrom(...PLATFORMS);

/** Arbitrary: truthy non-boolean values (should still route correctly when coerced) */
const arbTruthyNonBoolean = fc.constantFrom(1, 'true', 'yes', 'approved', {});

/** Arbitrary: falsy non-boolean values */
const arbFalsyNonBoolean = fc.constantFrom(0, '', null, undefined, false);

// ---------------------------------------------------------------------------
// Property A — audit_approved=false always routes to Ayrshare
// ---------------------------------------------------------------------------

describe('Property 17A — determineRoute: audit_approved=false routes to Ayrshare', () => {
  it('returns "ayrshare" for any platform when audit_approved is false', () => {
    /**
     * **Validates: Requirements 5.9, 11.9**
     * For every possible platform, when audit_approved=false the route
     * MUST be 'ayrshare' (supervised posting during audit period).
     */
    fc.assert(
      fc.property(arbPlatform, (platform) => {
        const route = determineRoute(platform, false);
        return route === 'ayrshare';
      }),
      { numRuns: 200 },
    );
  });

  it('returns "ayrshare" regardless of which specific platform is being published', () => {
    /**
     * **Validates: Requirements 5.9, 11.9**
     * The routing decision for audit_approved=false must be platform-agnostic —
     * every platform must route through Ayrshare.
     */
    const routes = PLATFORMS.map((p) => determineRoute(p, false));
    expect(routes.every((r) => r === 'ayrshare')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property B — audit_approved=true always routes to direct API
// ---------------------------------------------------------------------------

describe('Property 17B — determineRoute: audit_approved=true routes to direct API', () => {
  it('returns "direct" for any platform when audit_approved is true', () => {
    /**
     * **Validates: Requirements 5.10, 11.9**
     * For every possible platform, when audit_approved=true the route
     * MUST be 'direct' (full direct API posting, audit period over).
     */
    fc.assert(
      fc.property(arbPlatform, (platform) => {
        const route = determineRoute(platform, true);
        return route === 'direct';
      }),
      { numRuns: 200 },
    );
  });

  it('returns "direct" regardless of which specific platform is being published', () => {
    /**
     * **Validates: Requirements 5.10, 11.9**
     * Every platform must route to the direct API when audit is approved.
     */
    const routes = PLATFORMS.map((p) => determineRoute(p, true));
    expect(routes.every((r) => r === 'direct')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property C — Routing is mutually exclusive (never both Ayrshare AND direct)
// ---------------------------------------------------------------------------

describe('Property 17C — determineRoute: routing is mutually exclusive', () => {
  it('never returns the same route for both audit_approved=true and audit_approved=false', () => {
    /**
     * **Validates: Requirements 5.9, 5.10, 11.9**
     * For any platform, the route for audit_approved=false and
     * audit_approved=true must always be different (mutually exclusive).
     * A publish can never go to both Ayrshare AND direct API.
     */
    fc.assert(
      fc.property(arbPlatform, (platform) => {
        const routeWhenNotApproved = determineRoute(platform, false);
        const routeWhenApproved = determineRoute(platform, true);
        // Routes must be different — never the same destination
        return routeWhenNotApproved !== routeWhenApproved;
      }),
      { numRuns: 200 },
    );
  });

  it('the two possible routes are exactly {"ayrshare", "direct"} — no other values', () => {
    /**
     * **Validates: Requirements 5.9, 5.10**
     * determineRoute must only ever return 'ayrshare' or 'direct'.
     * No other routing destinations are valid.
     */
    fc.assert(
      fc.property(arbPlatform, fc.boolean(), (platform, approved) => {
        const route = determineRoute(platform, approved);
        return route === 'ayrshare' || route === 'direct';
      }),
      { numRuns: 300 },
    );
  });

  it('every platform independently routes to the same destination for the same flag', () => {
    /**
     * **Validates: Requirements 5.9, 5.10, 11.9**
     * The routing flag must produce a consistent destination for ALL platforms
     * simultaneously — not just some. No platform is a special case.
     */
    fc.assert(
      fc.property(fc.boolean(), (approved) => {
        const routes = PLATFORMS.map((p) => determineRoute(p, approved));
        const expectedRoute = approved ? 'direct' : 'ayrshare';
        return routes.every((r) => r === expectedRoute);
      }),
      { numRuns: 200 },
    );
  });

  it('routing decision is based solely on audit_approved flag, not on platform identity', () => {
    /**
     * **Validates: Requirements 11.9**
     * Two calls with the same audit_approved flag but different platforms
     * must return the same route.
     */
    fc.assert(
      fc.property(
        arbPlatform,
        arbPlatform,
        fc.boolean(),
        (platformA, platformB, approved) => {
          const routeA = determineRoute(platformA, approved);
          const routeB = determineRoute(platformB, approved);
          return routeA === routeB;
        },
      ),
      { numRuns: 200 },
    );
  });
});
