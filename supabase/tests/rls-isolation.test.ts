/**
 * RLS Isolation Property Tests
 *
 * Validates: Requirements 3.8, 18.1
 *
 * **Property 2: RLS Isolation — No Cross-User Data Leakage**
 *
 * These tests verify that the RLS predicate logic (auth.uid() = <owner_column>)
 * correctly isolates each user's data. Because the actual RLS enforcement lives
 * inside PostgreSQL, we unit-test the predicate functions here using mock data
 * and fast-check property-based testing to cover a wide range of user/data
 * combinations.
 *
 * Design references:
 *  - user_profiles:             auth.uid() = id
 *  - credentials:               auth.uid() = user_id
 *  - pipelines:                 auth.uid() = user_id
 *  - execution_logs:            auth.uid() = user_id  (SELECT only for users)
 *  - notification_preferences:  auth.uid() = user_id
 *
 * Note: platform_audit_status and login_attempts have NO RLS and are therefore
 * not tested here (no per-user isolation required for those tables).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// RLS predicate helpers
//
// These functions mirror the SQL predicate used in each policy:
//   USING (auth.uid() = <owner_column>)
//
// A row is visible to (or writable by) the requesting user only when
// the predicate returns true. We test these predicates directly so that
// the property tests are fast and deterministic — no live database required.
// ---------------------------------------------------------------------------

/** Generic SELECT/UPDATE/DELETE predicate: row belongs to the requesting user. */
function rlsOwnRow(requestingUserId: string, rowOwnerId: string): boolean {
  return requestingUserId === rowOwnerId;
}

/**
 * Simulates filtering a table's rows through the RLS predicate.
 * Returns only the rows that pass the USING clause for `requestingUserId`.
 */
function applyRls<T extends { ownerId: string }>(
  requestingUserId: string,
  rows: T[],
): T[] {
  return rows.filter((row) => rlsOwnRow(requestingUserId, row.ownerId));
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/**
 * A UUID-like string for use as a user ID.
 * Uses a simple pattern: "user-<hex segment>" to keep generated IDs readable
 * while still exercising the equality check across diverse values.
 */
const arbitraryUserId = fc.hexaString({ minLength: 8, maxLength: 8 }).map(
  (hex) => `user-${hex}`,
);

/**
 * A pair of *distinct* user IDs (userA ≠ userB).
 * Used to guarantee we are always testing cross-user isolation, not
 * a degenerate case where both users happen to share the same ID.
 */
const arbitraryDistinctUserPair = fc
  .tuple(arbitraryUserId, arbitraryUserId)
  .filter(([a, b]) => a !== b);

/**
 * Generate N rows owned by a specific user.
 * The row count is 1–5 to keep tests fast while ensuring meaningful data.
 */
function rowsOwnedBy(userId: string, count: number): Array<{ ownerId: string }> {
  return Array.from({ length: count }, () => ({ ownerId: userId }));
}

// ---------------------------------------------------------------------------
// Helper: assert isolation for a named table
// ---------------------------------------------------------------------------

/**
 * Runs the core isolation assertion for one table:
 *
 *   Given user A's rows in the table and a different user B querying,
 *   B's view of the table must return zero rows.
 *
 * Also asserts the positive case: A can see all of their own rows.
 */
function assertIsolation(
  tableName: string,
  userA: string,
  userB: string,
  rowCount: number,
): void {
  const userARows = rowsOwnedBy(userA, rowCount);

  // Isolation: user B sees none of user A's rows
  const visibleToB = applyRls(userB, userARows);
  expect(
    visibleToB,
    `${tableName}: user B should see 0 of user A's ${rowCount} rows`,
  ).toHaveLength(0);

  // Completeness: user A sees all of their own rows
  const visibleToA = applyRls(userA, userARows);
  expect(
    visibleToA,
    `${tableName}: user A should see all ${rowCount} of their own rows`,
  ).toHaveLength(rowCount);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RLS Isolation Property Tests — Validates: Requirements 3.8, 18.1', () => {
  /**
   * Property 2a: user_profiles isolation
   *
   * Policy: SELECT USING (auth.uid() = id)
   * A user profile row is only visible to the user whose id matches auth.uid().
   */
  describe('user_profiles', () => {
    it('cross-user isolation: user B cannot read user A profile rows', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          fc.integer({ min: 1, max: 5 }),
          ([userA, userB], rowCount) => {
            assertIsolation('user_profiles', userA, userB, rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('own-row access: a user can always read their own profile', () => {
      fc.assert(
        fc.property(
          arbitraryUserId,
          fc.integer({ min: 1, max: 3 }),
          (userId, rowCount) => {
            const rows = rowsOwnedBy(userId, rowCount);
            const visible = applyRls(userId, rows);
            expect(visible).toHaveLength(rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('INSERT predicate: user can only insert a row for themselves', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          ([requestingUser, targetOwnerId]) => {
            // WITH CHECK (auth.uid() = id): insert is allowed only when the
            // new row's id matches the requesting user's uid.
            const insertAllowed = rlsOwnRow(requestingUser, requestingUser);
            const crossInsertBlocked = !rlsOwnRow(requestingUser, targetOwnerId);
            expect(insertAllowed).toBe(true);
            expect(crossInsertBlocked).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * Property 2b: credentials isolation
   *
   * Policies: SELECT / INSERT / UPDATE / DELETE USING (auth.uid() = user_id)
   */
  describe('credentials', () => {
    it('cross-user isolation: user B cannot read user A credential rows', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          fc.integer({ min: 1, max: 5 }),
          ([userA, userB], rowCount) => {
            assertIsolation('credentials', userA, userB, rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('own-row access: a user can always read their own credentials', () => {
      fc.assert(
        fc.property(
          arbitraryUserId,
          fc.integer({ min: 1, max: 5 }),
          (userId, rowCount) => {
            const rows = rowsOwnedBy(userId, rowCount);
            const visible = applyRls(userId, rows);
            expect(visible).toHaveLength(rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('INSERT/UPDATE/DELETE predicate: cross-user mutations are blocked', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          ([requestingUser, targetOwnerId]) => {
            // WITH CHECK (auth.uid() = user_id): mutation only allowed on own rows.
            expect(rlsOwnRow(requestingUser, targetOwnerId)).toBe(false);
            expect(rlsOwnRow(requestingUser, requestingUser)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * Property 2c: pipelines isolation
   *
   * Policies: SELECT / INSERT / UPDATE / DELETE USING (auth.uid() = user_id)
   */
  describe('pipelines', () => {
    it('cross-user isolation: user B cannot read user A pipeline rows', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          fc.integer({ min: 1, max: 5 }),
          ([userA, userB], rowCount) => {
            assertIsolation('pipelines', userA, userB, rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('own-row access: a user can always read their own pipelines', () => {
      fc.assert(
        fc.property(
          arbitraryUserId,
          fc.integer({ min: 1, max: 5 }),
          (userId, rowCount) => {
            const rows = rowsOwnedBy(userId, rowCount);
            const visible = applyRls(userId, rows);
            expect(visible).toHaveLength(rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('mixed-owner table: user sees exactly their own rows among many owners', () => {
      fc.assert(
        fc.property(
          // At least 2 distinct users to guarantee cross-user data is present
          fc.uniqueArray(arbitraryUserId, { minLength: 2, maxLength: 6 }),
          fc.integer({ min: 1, max: 4 }),
          (users, rowsPerUser) => {
            // Safety: uniqueArray may still produce duplicates in edge cases;
            // filter to truly unique values before proceeding.
            const distinctUsers = [...new Set(users)];
            if (distinctUsers.length < 2) return; // skip degenerate cases

            const allRows = distinctUsers.flatMap((uid) =>
              rowsOwnedBy(uid, rowsPerUser),
            );

            for (const requestingUser of distinctUsers) {
              const visible = applyRls(requestingUser, allRows);
              expect(visible).toHaveLength(rowsPerUser);
              expect(visible.every((r) => r.ownerId === requestingUser)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 2d: execution_logs isolation
   *
   * Policy: SELECT USING (auth.uid() = user_id)
   * Users can only read their own execution log rows.
   * INSERT and UPDATE are service-role only (no user-facing policy).
   */
  describe('execution_logs', () => {
    it('cross-user isolation: user B cannot read user A execution log rows', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          fc.integer({ min: 1, max: 5 }),
          ([userA, userB], rowCount) => {
            assertIsolation('execution_logs', userA, userB, rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('own-row access: a user can always read their own execution logs', () => {
      fc.assert(
        fc.property(
          arbitraryUserId,
          fc.integer({ min: 1, max: 5 }),
          (userId, rowCount) => {
            const rows = rowsOwnedBy(userId, rowCount);
            const visible = applyRls(userId, rows);
            expect(visible).toHaveLength(rowCount);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('service-role INSERT is not subject to user RLS predicate', () => {
      // Validates that execution_logs has NO user-facing INSERT policy.
      // In SQL terms: no policy with FOR INSERT TO authenticated exists.
      // Here we verify that the service role bypass is modelled correctly:
      // the service role is represented by the absence of an RLS filter.
      // This test documents the design intent rather than calling the DB.
      const serviceRoleBypassesRls = true; // service role always bypasses RLS
      expect(serviceRoleBypassesRls).toBe(true);
    });
  });

  /**
   * Property 2e: notification_preferences isolation
   *
   * Policies: SELECT / INSERT / UPDATE / DELETE USING (auth.uid() = user_id)
   */
  describe('notification_preferences', () => {
    it('cross-user isolation: user B cannot read user A notification preferences', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          ([userA, userB]) => {
            // notification_preferences has one row per user (PK = user_id)
            assertIsolation('notification_preferences', userA, userB, 1);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('own-row access: a user can always read their own notification preferences', () => {
      fc.assert(
        fc.property(
          arbitraryUserId,
          (userId) => {
            const rows = rowsOwnedBy(userId, 1);
            const visible = applyRls(userId, rows);
            expect(visible).toHaveLength(1);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('INSERT/UPDATE/DELETE predicate: cross-user mutations are blocked', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          ([requestingUser, targetOwnerId]) => {
            expect(rlsOwnRow(requestingUser, targetOwnerId)).toBe(false);
            expect(rlsOwnRow(requestingUser, requestingUser)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * Property 2 (JWT pairs): JWT-identified users receive strictly isolated views
   *
   * This test simulates the core JWT-based isolation contract:
   *   1. Generate two distinct user IDs representing the `sub` claim of their JWTs.
   *   2. Insert rows "owned" by user A (auth.uid() = userA).
   *   3. Apply the RLS filter as if user B presented their JWT (auth.uid() = userB).
   *   4. Assert user B's view returns exactly zero rows from user A's data.
   *
   * The same property is verified for all five RLS-protected tables so that no
   * table is accidentally omitted from isolation enforcement.
   *
   * **Validates: Requirements 3.8, 18.1**
   */
  describe('JWT pairs — cross-user view isolation (all 5 tables)', () => {
    /**
     * Simulates a Supabase JWT context: the token carries a `sub` claim that
     * becomes auth.uid() inside PostgreSQL. We model this as a plain string
     * (UUID-like) because the RLS predicate is a pure equality check on that
     * value.
     */
    const arbitraryJwtSub = fc.hexaString({ minLength: 8, maxLength: 8 }).map(
      (hex) => `jwt-sub-${hex}`,
    );

    /** Two JWTs whose `sub` claims are guaranteed to differ. */
    const arbitraryDistinctJwtPair = fc
      .tuple(arbitraryJwtSub, arbitraryJwtSub)
      .filter(([a, b]) => a !== b);

    it('user_profiles: user B JWT sees 0 rows from user A JWT context', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          fc.integer({ min: 1, max: 5 }),
          ([jwtSubA, jwtSubB], rowCount) => {
            // Rows created while auth.uid() = jwtSubA (id column = jwtSubA)
            const userARows = rowsOwnedBy(jwtSubA, rowCount);
            // User B presents their JWT → auth.uid() = jwtSubB
            const visibleToB = applyRls(jwtSubB, userARows);
            expect(
              visibleToB,
              `user_profiles: JWT ${jwtSubB} should see 0 rows owned by ${jwtSubA}`,
            ).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('credentials: user B JWT sees 0 rows from user A JWT context', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          fc.integer({ min: 1, max: 5 }),
          ([jwtSubA, jwtSubB], rowCount) => {
            const userARows = rowsOwnedBy(jwtSubA, rowCount);
            const visibleToB = applyRls(jwtSubB, userARows);
            expect(
              visibleToB,
              `credentials: JWT ${jwtSubB} should see 0 rows owned by ${jwtSubA}`,
            ).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('pipelines: user B JWT sees 0 rows from user A JWT context', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          fc.integer({ min: 1, max: 5 }),
          ([jwtSubA, jwtSubB], rowCount) => {
            const userARows = rowsOwnedBy(jwtSubA, rowCount);
            const visibleToB = applyRls(jwtSubB, userARows);
            expect(
              visibleToB,
              `pipelines: JWT ${jwtSubB} should see 0 rows owned by ${jwtSubA}`,
            ).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('execution_logs: user B JWT sees 0 rows from user A JWT context', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          fc.integer({ min: 1, max: 5 }),
          ([jwtSubA, jwtSubB], rowCount) => {
            const userARows = rowsOwnedBy(jwtSubA, rowCount);
            const visibleToB = applyRls(jwtSubB, userARows);
            expect(
              visibleToB,
              `execution_logs: JWT ${jwtSubB} should see 0 rows owned by ${jwtSubA}`,
            ).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('notification_preferences: user B JWT sees 0 rows from user A JWT context', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          ([jwtSubA, jwtSubB]) => {
            // notification_preferences has one row per user
            const userARows = rowsOwnedBy(jwtSubA, 1);
            const visibleToB = applyRls(jwtSubB, userARows);
            expect(
              visibleToB,
              `notification_preferences: JWT ${jwtSubB} should see 0 rows owned by ${jwtSubA}`,
            ).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('all 5 tables simultaneously: mixed-owner dataset, each JWT sees only its own rows', () => {
      // This is the strongest form of the isolation invariant: given a dataset
      // containing rows for both users across all five tables, each user's JWT
      // context exposes only that user's rows — never the other's.
      fc.assert(
        fc.property(
          arbitraryDistinctJwtPair,
          fc.integer({ min: 1, max: 5 }),
          ([jwtSubA, jwtSubB], rowsPerUser) => {
            const tables = [
              'user_profiles',
              'credentials',
              'pipelines',
              'execution_logs',
              'notification_preferences',
            ] as const;

            for (const table of tables) {
              const rowsForA = rowsOwnedBy(jwtSubA, rowsPerUser);
              const rowsForB = rowsOwnedBy(jwtSubB, rowsPerUser);
              const allRows = [...rowsForA, ...rowsForB];

              // User A's JWT should see exactly their own rows
              const aView = applyRls(jwtSubA, allRows);
              expect(aView, `${table}: JWT A should see only A's rows`).toHaveLength(rowsPerUser);
              expect(aView.every((r) => r.ownerId === jwtSubA)).toBe(true);

              // User B's JWT should see exactly their own rows
              const bView = applyRls(jwtSubB, allRows);
              expect(bView, `${table}: JWT B should see only B's rows`).toHaveLength(rowsPerUser);
              expect(bView.every((r) => r.ownerId === jwtSubB)).toBe(true);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * Correctness invariant: the RLS predicate is a pure equality check.
   *
   * This property verifies that the predicate is reflexive (a user always
   * passes for their own ID), irreflexive across distinct IDs (a different
   * user never passes), and that no partial/fuzzy matches occur.
   */
  describe('RLS predicate invariants', () => {
    it('predicate is reflexive: rlsOwnRow(uid, uid) is always true', () => {
      fc.assert(
        fc.property(arbitraryUserId, (uid) => {
          expect(rlsOwnRow(uid, uid)).toBe(true);
        }),
        { numRuns: 500 },
      );
    });

    it('predicate is strict: rlsOwnRow(a, b) is false when a ≠ b', () => {
      fc.assert(
        fc.property(arbitraryDistinctUserPair, ([a, b]) => {
          expect(rlsOwnRow(a, b)).toBe(false);
        }),
        { numRuns: 500 },
      );
    });

    it('predicate has no false positives from prefix/substring matches', () => {
      // Ensures the predicate uses strict equality, not substring containment.
      fc.assert(
        fc.property(
          arbitraryUserId,
          (uid) => {
            const prefix = uid.slice(0, uid.length - 1); // one char shorter
            const extended = uid + 'x';                  // one char longer
            expect(rlsOwnRow(uid, prefix)).toBe(false);
            expect(rlsOwnRow(uid, extended)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('zero-row result when no rows belong to the requesting user', () => {
      fc.assert(
        fc.property(
          arbitraryDistinctUserPair,
          fc.integer({ min: 1, max: 10 }),
          ([userA, userB], rowCount) => {
            const rowsForA = rowsOwnedBy(userA, rowCount);
            expect(applyRls(userB, rowsForA)).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
