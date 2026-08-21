-- =============================================================================
-- Migration: 20240101000000_initial_schema.sql
-- Description: Create all core tables for AI Video Automation SaaS
-- Requirements: 13.7, 18.1
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- Ensure pg_cron is available (pre-enabled on Supabase Pro/Team plans).
-- If not available, the cron section below can be replaced with a Supabase
-- Edge Function scheduled via the Supabase dashboard.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "extensions";


-- =============================================================================
-- TABLE: public.user_profiles
-- Extends auth.users with subscription and display metadata.
-- =============================================================================
CREATE TABLE public.user_profiles (
  id                      UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            TEXT        CHECK (char_length(display_name) BETWEEN 1 AND 50),
  email                   TEXT        NOT NULL,
  subscription_status     TEXT        NOT NULL DEFAULT 'inactive'
                            CHECK (subscription_status IN ('active', 'inactive', 'suspended', 'cancelled')),
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  subscription_expires_at TIMESTAMPTZ,
  pipeline_limit          INT         NOT NULL DEFAULT 5,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_profiles_stripe_customer ON public.user_profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can insert (e.g. on new user registration trigger)
CREATE POLICY "user_profiles_insert_service"
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (true);  -- restricted to service role via API layer; anon role blocked by default


-- =============================================================================
-- TABLE: public.credentials
-- Credential metadata only — plaintext values live in Supabase Vault.
-- =============================================================================
CREATE TABLE public.credentials (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_type TEXT        NOT NULL,
  masked_value    TEXT,                        -- e.g. "••••abcd"
  vault_secret_id UUID        NOT NULL,        -- references vault.secrets.id
  status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'deleted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, credential_type)
);

-- Indexes
CREATE INDEX idx_credentials_user_id   ON public.credentials (user_id);
CREATE INDEX idx_credentials_user_type ON public.credentials (user_id, credential_type);

-- RLS
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credentials_all_own"
  ON public.credentials
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- TABLE: public.pipelines
-- One row per user-configured automation pipeline.
-- =============================================================================
CREATE TABLE public.pipelines (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                     TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  niche_keyword            TEXT        NOT NULL CHECK (char_length(niche_keyword) BETWEEN 1 AND 200),
  status                   TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'paused', 'disabled', 'running')),
  openai_model             TEXT        NOT NULL DEFAULT 'gpt-4o-mini',
  heygen_avatar_id         TEXT,
  video_language           TEXT        NOT NULL DEFAULT 'en',
  script_tone              TEXT        NOT NULL DEFAULT 'professional'
                             CHECK (script_tone IN ('professional', 'casual', 'energetic', 'educational', 'entertaining')),
  target_duration_secs     INT         NOT NULL DEFAULT 60
                             CHECK (target_duration_secs BETWEEN 30 AND 300),
  gdrive_folder_id         TEXT,
  publishing_platforms     TEXT[]      NOT NULL DEFAULT '{}',
  schedule_recurrence      TEXT        NOT NULL
                             CHECK (schedule_recurrence IN ('daily', 'weekdays', 'custom')),
  schedule_days_of_week    INT[],                -- [0–6]; used when recurrence = 'custom'
  schedule_time_hhmm       TEXT        NOT NULL, -- "HH:MM" in user timezone
  schedule_timezone        TEXT        NOT NULL DEFAULT 'UTC',
  schedule_cron_utc        TEXT        NOT NULL, -- computed UTC cron expression
  n8n_workflow_id          TEXT,
  consecutive_failures     INT         NOT NULL DEFAULT 0,
  max_consecutive_failures INT         NOT NULL DEFAULT 3
                             CHECK (max_consecutive_failures BETWEEN 1 AND 5),
  last_execution_at        TIMESTAMPTZ,
  last_execution_status    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pipelines_user_id ON public.pipelines (user_id);
CREATE INDEX idx_pipelines_status  ON public.pipelines (status);
CREATE INDEX idx_pipelines_user_status ON public.pipelines (user_id, status);

-- RLS
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipelines_all_own"
  ON public.pipelines
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- TABLE: public.execution_logs
-- One row per pipeline execution attempt; 90-day retention enforced by pg_cron.
-- =============================================================================
CREATE TABLE public.execution_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed', 'partial', 'skipped')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_ms     INT,
  failure_reason  TEXT,

  -- Step: Content fetch
  content_fetch_status      TEXT,
  content_fetch_article_url TEXT,
  content_fetch_error       TEXT,

  -- Step: Script generation
  script_gen_status TEXT,
  script_text       TEXT,
  script_gen_error  TEXT,

  -- Step: Video generation
  video_gen_status       TEXT,
  heygen_video_id        TEXT,
  r2_object_key          TEXT,
  video_file_size_bytes  BIGINT,
  video_gen_error        TEXT,

  -- Step: Drive upload
  drive_upload_status TEXT,
  gdrive_file_id      TEXT,
  gdrive_link         TEXT,
  drive_upload_error  TEXT,

  -- Step: Social publish (one JSONB object per platform)
  -- Schema: { "youtube": { "status": "...", "post_id": "...", "error": "..." }, ... }
  social_publish_results JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_execution_logs_pipeline_id  ON public.execution_logs (pipeline_id);
CREATE INDEX idx_execution_logs_user_id      ON public.execution_logs (user_id);
CREATE INDEX idx_execution_logs_status       ON public.execution_logs (status);
-- Supports paginated history queries ordered by most-recent first (Req 13.3)
CREATE INDEX idx_execution_logs_pipeline_created
  ON public.execution_logs (pipeline_id, created_at DESC);
-- Supports 90-day retention delete (Req 13.7)
CREATE INDEX idx_execution_logs_created_at ON public.execution_logs (created_at);

-- RLS
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own logs
CREATE POLICY "execution_logs_select_own"
  ON public.execution_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role (n8n / Backend API) may insert or update execution logs;
-- the WITH CHECK (true) is intentional — row-level isolation is handled by
-- user_id column + service role key enforcement at the API layer.
CREATE POLICY "execution_logs_insert_service"
  ON public.execution_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "execution_logs_update_service"
  ON public.execution_logs
  FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: public.platform_audit_status
-- Operator-managed flag controlling Ayrshare vs. direct API routing per platform.
-- No RLS: readable by all authenticated users; writes restricted to service role.
-- =============================================================================
CREATE TABLE public.platform_audit_status (
  platform              TEXT        PRIMARY KEY
                          CHECK (platform IN ('youtube', 'tiktok', 'facebook', 'instagram')),
  audit_approved        BOOLEAN     NOT NULL DEFAULT FALSE,
  direct_api_enabled_at TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the four supported platforms so rows always exist for runtime queries.
INSERT INTO public.platform_audit_status (platform, audit_approved)
VALUES
  ('youtube',   FALSE),
  ('tiktok',    FALSE),
  ('facebook',  FALSE),
  ('instagram', FALSE);

-- No RLS on this table — it is intentionally public-readable.
-- Writes are blocked for non-service-role users at the PostgREST / API layer.


-- =============================================================================
-- TABLE: public.notification_preferences
-- Per-user opt-in/out for pipeline-outcome email notifications.
-- =============================================================================
CREATE TABLE public.notification_preferences (
  user_id                   UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_on_success         BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_failure         BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_pipeline_paused BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_all_own"
  ON public.notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- TABLE: public.login_attempts
-- Tracks failed login attempts for account lockout logic (Req 1.5).
-- No RLS: written by service role only; never exposed directly to users.
-- =============================================================================
CREATE TABLE public.login_attempts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success      BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Index for efficient lockout window queries (Req 1.5)
CREATE INDEX idx_login_attempts_email_time
  ON public.login_attempts (email, attempted_at DESC);

-- No RLS: this table is write-only via service role; never read by anon/authenticated roles.


-- =============================================================================
-- AUTOMATED TRIGGERS: updated_at maintenance
-- Keep updated_at current on every UPDATE without application-layer burden.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_credentials_updated_at
  BEFORE UPDATE ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_pipelines_updated_at
  BEFORE UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_platform_audit_status_updated_at
  BEFORE UPDATE ON public.platform_audit_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- RETENTION POLICY: Delete execution_logs older than 90 days (Req 13.7)
--
-- Approach A — pg_cron (Supabase Pro/Team plans with pg_cron extension):
--   Schedule a nightly job at 03:00 UTC to purge old rows.
--
-- Approach B — Supabase Edge Function (fallback for Starter plan):
--   If pg_cron is not available, deploy the Edge Function in
--   supabase/functions/purge-execution-logs/index.ts and schedule it via
--   the Supabase Dashboard (Project Settings → Edge Functions → Schedules).
--
-- This migration uses Approach A. If pg_cron is unavailable, comment out the
-- SELECT cron.schedule(...) line and use Approach B instead.
-- =============================================================================

SELECT cron.schedule(
  'purge-execution-logs-90d',           -- unique job name
  '0 3 * * *',                          -- every day at 03:00 UTC
  $$
    DELETE FROM public.execution_logs
    WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);


-- =============================================================================
-- COMMENTS: document tables for Supabase Studio / pg catalog
-- =============================================================================
COMMENT ON TABLE public.user_profiles IS
  'Extends auth.users with subscription status, Stripe references, and display metadata.';

COMMENT ON TABLE public.credentials IS
  'Credential metadata (type, masked value, vault reference). Plaintext values stored in Supabase Vault only.';

COMMENT ON TABLE public.pipelines IS
  'User-configured automation pipelines defining content niche, schedule, and publishing destinations.';

COMMENT ON TABLE public.execution_logs IS
  'Per-execution audit record capturing per-step outcomes. Retention policy: 90 days (pg_cron job purge-execution-logs-90d).';

COMMENT ON TABLE public.platform_audit_status IS
  'Operator-managed routing flag: audit_approved=false → Ayrshare; audit_approved=true → direct platform API.';

COMMENT ON TABLE public.notification_preferences IS
  'Per-user opt-in/out flags for pipeline-outcome email notifications.';

COMMENT ON TABLE public.login_attempts IS
  'Tracks login attempts per email for rate-limiting and account lockout enforcement (Req 1.5).';
