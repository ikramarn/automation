-- =============================================================================
-- Migration: 20240101000001_rls_policies.sql
-- Description: Granular per-operation RLS policies for all tables
-- Requirements: 3.8, 18.1
--
-- ACCESS PATTERN OVERVIEW
-- ============================================================
--
-- SERVICE ROLE vs. AUTHENTICATED USER ROLE
-- ─────────────────────────────────────────
-- The Supabase service role key bypasses RLS entirely. It is used exclusively
-- by the Backend API and n8n Pipeline Engine for privileged operations:
--   • Inserting user_profiles on new-user registration
--   • Writing execution_logs (INSERT + UPDATE) during pipeline runs
--   • Reading / writing platform_audit_status (operator-managed table)
--   • Writing login_attempts for account lockout enforcement
--
-- The authenticated role (JWT bearer) is used by the Dashboard (Next.js) and
-- is subject to all RLS policies below. It can only see and modify its own
-- rows; it can never touch service-role-only tables (platform_audit_status,
-- login_attempts) via the PostgREST / API layer.
--
-- TABLE-BY-TABLE SUMMARY
-- ─────────────────────────────────────────
--  user_profiles         SELECT, UPDATE own row (auth.uid() = id)
--                        INSERT by service role only (no user-facing policy)
--                        DELETE blocked for users (cascades from auth.users)
--
--  credentials           SELECT, INSERT, UPDATE, DELETE own rows
--                        (auth.uid() = user_id)
--
--  pipelines             SELECT, INSERT, UPDATE, DELETE own rows
--                        (auth.uid() = user_id)
--
--  execution_logs        SELECT own rows (auth.uid() = user_id)
--                        INSERT + UPDATE by service role only
--                        DELETE blocked for users (cascades from pipelines)
--
--  notification_prefs    SELECT, INSERT, UPDATE, DELETE own rows
--                        (auth.uid() = user_id)
--
--  platform_audit_status No RLS — publicly readable by all authenticated users
--                        Writes restricted to service role at the API layer
--
--  login_attempts        No RLS — write-only via service role
--                        Never read or written by authenticated users directly
-- =============================================================================


-- =============================================================================
-- user_profiles
-- Drop any existing combined/coarse policies from the initial migration and
-- replace with explicit per-operation policies.
-- =============================================================================

DROP POLICY IF EXISTS "user_profiles_select_own"  ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_own"  ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert_service" ON public.user_profiles;

-- SELECT: each user can read only their own profile row.
CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- UPDATE: each user can update only their own profile row.
-- WITH CHECK prevents users from changing the id to another uid.
CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- INSERT: no policy for the authenticated role — effectively blocked.
-- The service role key bypasses RLS and is used by the Backend API to insert
-- new rows on user registration (via a database trigger or server-side call).
-- No DELETE policy for authenticated role: row deletion cascades from
-- auth.users when a user account is deleted (handled by the ON DELETE CASCADE
-- foreign key constraint and service role operations).


-- =============================================================================
-- credentials
-- Drop any existing catch-all policy and replace with explicit per-operation
-- policies scoped to auth.uid() = user_id.
-- =============================================================================

DROP POLICY IF EXISTS "credentials_all_own" ON public.credentials;

-- SELECT: users can list and read their own credential metadata rows.
CREATE POLICY "credentials_select_own"
  ON public.credentials
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: users can add new credentials for themselves only.
CREATE POLICY "credentials_insert_own"
  ON public.credentials
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: users can update their own credential rows only.
CREATE POLICY "credentials_update_own"
  ON public.credentials
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: users can delete their own credential rows only.
CREATE POLICY "credentials_delete_own"
  ON public.credentials
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =============================================================================
-- pipelines
-- Drop any existing catch-all policy and replace with explicit per-operation
-- policies scoped to auth.uid() = user_id.
-- =============================================================================

DROP POLICY IF EXISTS "pipelines_all_own" ON public.pipelines;

-- SELECT: users can list and view their own pipeline rows.
CREATE POLICY "pipelines_select_own"
  ON public.pipelines
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: users can create new pipeline rows for themselves only.
CREATE POLICY "pipelines_insert_own"
  ON public.pipelines
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: users can update their own pipeline rows only.
CREATE POLICY "pipelines_update_own"
  ON public.pipelines
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: users can delete their own pipeline rows only.
CREATE POLICY "pipelines_delete_own"
  ON public.pipelines
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =============================================================================
-- execution_logs
-- Users may read their own log rows. Writes (INSERT + UPDATE) are service-role
-- only — n8n and the Backend API write execution records; users never insert or
-- update logs directly.
-- =============================================================================

DROP POLICY IF EXISTS "execution_logs_select_own"      ON public.execution_logs;
DROP POLICY IF EXISTS "execution_logs_insert_service"  ON public.execution_logs;
DROP POLICY IF EXISTS "execution_logs_update_service"  ON public.execution_logs;

-- SELECT: users can read only their own execution log rows.
CREATE POLICY "execution_logs_select_own"
  ON public.execution_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: no policy for the authenticated role — blocked.
-- The service role (Backend API / n8n) bypasses RLS to insert new log rows.

-- UPDATE: no policy for the authenticated role — blocked.
-- The service role (n8n) updates log rows to record step results and final status.

-- DELETE: blocked for both authenticated and service role via normal operations.
-- Row deletion is handled solely by the pg_cron retention job (90-day purge)
-- which runs as the service role.


-- =============================================================================
-- notification_preferences
-- Drop any existing catch-all policy and replace with explicit per-operation
-- policies scoped to auth.uid() = user_id.
-- =============================================================================

DROP POLICY IF EXISTS "notification_preferences_all_own" ON public.notification_preferences;

-- SELECT: users can read their own notification preferences.
CREATE POLICY "notification_preferences_select_own"
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: users can create their own preferences row (upsert pattern).
CREATE POLICY "notification_preferences_insert_own"
  ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: users can update their own preferences.
CREATE POLICY "notification_preferences_update_own"
  ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: users can delete their own preferences row.
-- (Normally cascades from auth.users; also allowed explicitly.)
CREATE POLICY "notification_preferences_delete_own"
  ON public.notification_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =============================================================================
-- platform_audit_status  (NO RLS)
-- This table holds four static rows (one per platform) managed by operators.
-- It is intentionally left without RLS:
--   • All authenticated users (and n8n) can SELECT to determine routing.
--   • INSERT / UPDATE / DELETE are restricted to the service role via the API
--     layer (PostgREST table grants) — not via RLS policies.
-- The initial migration already omits ENABLE ROW LEVEL SECURITY for this table.
-- No changes required here.
-- =============================================================================


-- =============================================================================
-- login_attempts  (NO RLS)
-- Written exclusively by the Backend API using the service role key.
-- This table must never be readable or writable by authenticated users.
-- The initial migration already omits ENABLE ROW LEVEL SECURITY for this table,
-- ensuring PostgREST / anon / authenticated roles cannot access it at all
-- unless explicitly granted — and no such grants are made.
-- No changes required here.
-- =============================================================================


-- =============================================================================
-- COMMENTS: document policy intent for Supabase Studio / pg catalog
-- =============================================================================

COMMENT ON POLICY "user_profiles_select_own" ON public.user_profiles IS
  'Authenticated users can only SELECT their own profile row (auth.uid() = id).';

COMMENT ON POLICY "user_profiles_update_own" ON public.user_profiles IS
  'Authenticated users can only UPDATE their own profile row (auth.uid() = id). INSERT handled by service role only.';

COMMENT ON POLICY "credentials_select_own"  ON public.credentials IS
  'Authenticated users can SELECT credential metadata rows where user_id = auth.uid().';

COMMENT ON POLICY "credentials_insert_own"  ON public.credentials IS
  'Authenticated users can INSERT credential rows for themselves only (user_id = auth.uid()).';

COMMENT ON POLICY "credentials_update_own"  ON public.credentials IS
  'Authenticated users can UPDATE their own credential rows only.';

COMMENT ON POLICY "credentials_delete_own"  ON public.credentials IS
  'Authenticated users can DELETE their own credential rows only.';

COMMENT ON POLICY "pipelines_select_own"    ON public.pipelines IS
  'Authenticated users can SELECT pipeline rows where user_id = auth.uid().';

COMMENT ON POLICY "pipelines_insert_own"    ON public.pipelines IS
  'Authenticated users can INSERT pipeline rows for themselves only.';

COMMENT ON POLICY "pipelines_update_own"    ON public.pipelines IS
  'Authenticated users can UPDATE their own pipeline rows only.';

COMMENT ON POLICY "pipelines_delete_own"    ON public.pipelines IS
  'Authenticated users can DELETE their own pipeline rows only.';

COMMENT ON POLICY "execution_logs_select_own" ON public.execution_logs IS
  'Authenticated users can SELECT execution log rows where user_id = auth.uid(). INSERT and UPDATE are service-role only.';

COMMENT ON POLICY "notification_preferences_select_own" ON public.notification_preferences IS
  'Authenticated users can SELECT their own notification_preferences row.';

COMMENT ON POLICY "notification_preferences_insert_own" ON public.notification_preferences IS
  'Authenticated users can INSERT their own notification_preferences row.';

COMMENT ON POLICY "notification_preferences_update_own" ON public.notification_preferences IS
  'Authenticated users can UPDATE their own notification_preferences row.';

COMMENT ON POLICY "notification_preferences_delete_own" ON public.notification_preferences IS
  'Authenticated users can DELETE their own notification_preferences row.';
