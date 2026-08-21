# Implementation Plan: AI Video Automation SaaS

## Overview

This plan breaks down the AI Video Automation SaaS into incremental coding tasks, building from infrastructure and data models up through the pipeline engine, API layer, frontend, and finally wiring everything together. Each task references specific requirements for traceability. Property-based tests use **fast-check** (TypeScript) and are tagged with the property number they validate.

---

## Tasks

- [x] 1. Project scaffolding and infrastructure setup
  - Initialize the Docker Compose stack with services: `nginx`, `nextjs`, `api`, `n8n`, `redis`
  - Create `docker-compose.yml` and `docker-compose.prod.yml` with pinned image versions for all services
  - Configure Nginx reverse proxy for TLS termination, routing `/api/` to the Fastify service and `/` to Next.js
  - Set up internal Docker network (`internal`) for API ↔ n8n ↔ Redis, and `public` network for Nginx-exposed services
  - Create `.env.example` documenting all required environment variables (never commit `.env.prod`)
  - Set up GitHub Actions CI pipeline: lint → unit tests → property-based tests → Docker image build
  - _Requirements: 18.7, 19.1_

- [x] 2. Supabase database schema and RLS policies
  - [x] 2.1 Create all Supabase table migrations
    - Write migration SQL for: `user_profiles`, `credentials`, `pipelines`, `execution_logs`, `platform_audit_status`, `notification_preferences`, `login_attempts`
    - Apply all `CHECK` constraints, foreign keys, and indexes as specified in the data models
    - Add `pg_cron` job (or Supabase scheduled function) to delete `execution_logs` records older than 90 days
    - _Requirements: 13.7, 18.1_

  - [x] 2.2 Implement RLS policies on all tables
    - Enable RLS on `user_profiles`, `credentials`, `pipelines`, `execution_logs`, `notification_preferences`
    - Create per-user `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies tied to `auth.uid()`
    - Set `platform_audit_status` as read-only for authenticated users, write-only by service role
    - Set `login_attempts` as write-only by service role
    - _Requirements: 3.8, 18.1_

  - [x] 2.3 Write property test for RLS isolation (Property 2)
    - **Property 2: RLS Isolation — No Cross-User Data Leakage**
    - Generate pairs of user JWTs + random table queries; assert zero cross-user rows returned
    - **Validates: Requirements 3.8, 18.1**

- [x] 3. Backend API — Fastify project setup and middleware
  - [x] 3.1 Initialize Fastify API project with TypeScript
    - Bootstrap Fastify with TypeScript, set up `tsconfig.json`, eslint, and test runner (Vitest)
    - Add `@fastify/jwt`, `@fastify/cookie`, `@fastify/cors`, `@fastify/helmet` plugins
    - Create health check route `GET /health` returning `{ status: "ok" }`
    - Implement structured JSON error response format: `{ status, error_code, message, details }`
    - _Requirements: 15.7, 19.3_

  - [x] 3.2 Implement JWT authentication middleware
    - Extract `Authorization: Bearer <token>` or `HttpOnly` session cookie
    - Validate JWT signature against `SUPABASE_JWT_SECRET`
    - Verify token expiry (24-hour lifetime)
    - Attach `req.user = { id, email, subscription_status }` to request context
    - Return `HTTP 401 { error_code: "unauthorized" }` on any validation failure
    - _Requirements: 1.4, 18.2_

  - [x] 3.3 Write property test for JWT validity enforcement (Property 14)
    - **Property 14: JWT Validity Enforcement**
    - Generate random invalid/expired/malformed JWT strings; assert every authenticated endpoint returns 401
    - **Validates: Requirements 18.2**

  - [x] 3.4 Implement CSRF protection middleware
    - Implement double-submit cookie pattern: `GET /auth/csrf-token` issues a signed token
    - Middleware verifies `X-CSRF-Token` header matches signed session cookie on POST/PUT/PATCH/DELETE
    - Return `HTTP 403 { error_code: "csrf_token_invalid" }` on missing or mismatched token
    - Apply CSRF middleware to `/pipelines`, `/credentials`, `/settings` routes
    - _Requirements: 18.6_

  - [x] 3.5 Write property test for CSRF token enforcement (Property 15)
    - **Property 15: CSRF Token Enforcement**
    - Generate state-changing requests with missing/mismatched tokens; assert every such request returns 403
    - **Validates: Requirements 18.6**

  - [x] 3.6 Implement input sanitization middleware
    - Strip HTML tags and control characters from all user-supplied string inputs
    - Check for prompt injection patterns via regex: `ignore previous instructions`, `you are now`, `disregard`, `forget all`, `system prompt`
    - Return `HTTP 400 { error_code: "invalid_input" }` on match
    - Encode sanitized strings for JSON before passing downstream
    - _Requirements: 18.8_

  - [x] 3.7 Write property test for input sanitization (Property 9)
    - **Property 9: Input Sanitization — Injection Rejection and Benign Pass-Through**
    - Generate random strings including injection variants and benign strings; assert injections → 400, benign → accepted
    - **Validates: Requirements 18.8**

  - [x] 3.8 Implement subscription guard middleware
    - Check `req.user.subscription_status` before allowing mutation operations
    - If `"suspended"` or `"inactive"`: reject `POST/PUT/PATCH/DELETE` with `HTTP 403`; allow `GET` requests
    - _Requirements: 2.6_

  - [x] 3.9 Write property test for suspended subscription read-only enforcement (Property 18)
    - **Property 18: Suspended Subscription Read-Only Enforcement**
    - Generate suspended users + random mutation requests; assert all mutations rejected, reads permitted
    - **Validates: Requirements 2.6**

- [x] 4. Checkpoint — Ensure all middleware tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Authentication routes
  - [x] 5.1 Implement email/password registration and login routes
    - `POST /auth/register`: validate password constraints (8–64 chars, uppercase, lowercase, digit, special char), create Supabase Auth user, send email verification
    - `POST /auth/login`: authenticate with Supabase Auth, issue 24-hour JWT, set `HttpOnly; Secure; SameSite=Strict` session cookie; reject login if email unverified
    - `POST /auth/logout`: clear session cookie
    - `GET /auth/verify-email`: verify email token via Supabase Auth
    - `POST /auth/forgot-password`: send 60-minute single-use reset link
    - `POST /auth/reset-password`: apply new password via Supabase Auth
    - _Requirements: 1.1, 1.3, 1.4, 1.6, 1.7, 1.8, 18.7_

  - [x] 5.2 Write property test for password validation invariants (Property 13)
    - **Property 13: Password Validation Invariants**
    - Generate random strings with varying length and character class combinations; assert exactly the valid password space is accepted
    - **Validates: Requirements 1.1**

  - [x] 5.3 Implement account lockout logic
    - On failed login: insert record into `login_attempts`
    - Query `login_attempts` for 3+ failures within 15-minute window for the email
    - If threshold met: lock account for 15 minutes and send notification email
    - _Requirements: 1.5_

  - [x] 5.4 Implement Google OAuth routes
    - `GET /auth/google`: initiate Google OAuth via Supabase Auth provider
    - `GET /auth/google/callback`: handle callback, issue JWT, set session cookie
    - _Requirements: 1.2_

- [x] 6. Subscription and billing routes
  - [x] 6.1 Implement Stripe subscription routes
    - `POST /subscription/checkout`: create Stripe Checkout session for the subscription tier; respond with redirect URL
    - `GET /subscription/portal`: create Stripe Customer Portal session; respond with redirect URL
    - `GET /subscription/status`: return current subscription status from `user_profiles`
    - _Requirements: 2.1, 2.2, 2.8_

  - [x] 6.2 Implement Stripe webhook receiver
    - `POST /webhooks/stripe`: verify Stripe webhook signature using `STRIPE_WEBHOOK_SECRET`
    - Handle `checkout.session.completed`: activate subscription within 60 seconds, update `user_profiles.subscription_status` to `"active"`
    - Handle `invoice.payment_failed`: set `subscription_status` to `"suspended"`, send payment failure email within 15 minutes
    - Handle `customer.subscription.deleted` / expiry: suspend pipeline execution, send email
    - Implement exponential backoff retry: on webhook processing failure, retry up to 5 times with delays [5s, 10s, 20s, 40s, 80s]
    - _Requirements: 2.3, 2.4, 2.5, 2.9_

  - [x] 6.3 Write property test for Stripe webhook retry backoff sequence (Property 10)
    - **Property 10: Stripe Webhook Retry Backoff Sequence**
    - Simulate webhook failures (1–5); assert delay sequence = [5, 10, 20, 40, 80]s, ≤5 retries, no delay >320s
    - **Validates: Requirements 2.9**

- [x] 7. Credential management routes and vault integration
  - [x] 7.1 Implement credential CRUD routes
    - `GET /credentials`: return list of credential types with masked values (`••••[last4]`) and status
    - `PUT /credentials/:type`: encrypt and store API key in Supabase Vault; update `credentials` metadata table with masked value and `vault_secret_id`; never log raw key value
    - `DELETE /credentials/:type`: delete vault secret and metadata record; pause any pipelines referencing this credential and notify user
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 18.4_

  - [x] 7.2 Write property test for credential masking round-trip (Property 1)
    - **Property 1: Credential Masking Round-Trip**
    - Generate random API key strings (8–128 chars); assert masked output = `"••••" + key.slice(-4)` with no additional key characters
    - **Validates: Requirements 3.4, 18.4**

  - [x] 7.3 Implement Google Drive OAuth routes
    - `GET /credentials/google/connect`: initiate Google OAuth 2.0 flow requesting only `drive.file` scope
    - `GET /credentials/google/callback`: exchange code for refresh token, store in Vault, update Dashboard connection status
    - `DELETE /credentials/google`: delete refresh token from Vault, update status to `"disconnected"`
    - Handle user denial / OAuth error: display error, retain previous status unchanged
    - _Requirements: 4.1, 4.2, 4.4, 4.7, 4.8_

  - [x] 7.4 Implement social platform OAuth routes
    - `GET /credentials/social/:platform/connect`: initiate OAuth flow per platform (YouTube, TikTok, Facebook, Instagram) with correct scopes
    - `GET /credentials/social/:platform/callback`: store access + refresh tokens in Vault, update connection status
    - `DELETE /credentials/social/:platform`: pause pipelines targeting that platform, delete tokens from Vault
    - Handle OAuth errors / user denial: display error, retain previous status
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.11_

- [x] 8. Pipeline CRUD routes
  - [x] 8.1 Implement pipeline creation and limit enforcement
    - `POST /pipelines`: validate required fields (name 1–100 chars, niche keyword 1–200 chars, at least one platform, schedule), check HeyGen key present in Vault, enforce 5-pipeline limit for base tier
    - Return `"Pipeline limit reached. Upgrade your plan to create more pipelines."` when limit hit
    - Create corresponding n8n workflow instance via n8n REST API
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [x] 8.2 Write property test for pipeline creation limit enforcement (Property 12)
    - **Property 12: Pipeline Creation Limit Enforcement**
    - Generate users with pipeline count = 5; assert 6th creation rejected with correct message, count unchanged
    - **Validates: Requirements 6.1**

  - [x] 8.3 Implement pipeline read, update, delete routes
    - `GET /pipelines`: return all user's pipelines with current status, last execution result and timestamp
    - `GET /pipelines/:id`: return full pipeline detail
    - `PUT /pipelines/:id`: update configuration, recompute UTC cron expression, update n8n schedule trigger within 5s
    - `DELETE /pipelines/:id`: if execution in progress allow it to complete, then delete record and cancel n8n scheduled executions
    - `POST /pipelines/:id/enable` / `/disable`: toggle pipeline status; on disable cancel n8n triggers within 5 seconds
    - _Requirements: 6.4, 6.5, 6.7, 6.8, 6.9, 12.6_

  - [x] 8.4 Implement pipeline manual trigger route
    - `POST /pipelines/:id/trigger`: check pipeline is active (not paused/disabled), check no execution currently running, call n8n webhook to start execution
    - Return error if pipeline is paused
    - _Requirements: 12.5_

- [x] 9. Scheduling — cron expression computation
  - [x] 9.1 Implement UTC cron expression computation
    - Write `computeUtcCron(timehhmm: string, timezone: string, recurrence: "daily" | "weekdays" | "custom", daysOfWeek?: number[]): string`
    - Use `date-fns-tz` to convert HH:MM in user timezone to UTC equivalent
    - Generate cron expressions: `daily` → `MM HH * * *`, `weekdays` → `MM HH * * 1-5`, `custom` → `MM HH * * D,D,...`
    - Store computed UTC cron in `pipelines.schedule_cron_utc`
    - _Requirements: 12.1, 12.2_

- [x] 10. Execution log routes
  - [x] 10.1 Implement execution history and detail routes
    - `GET /pipelines/:id/executions`: return paginated execution history (10 per page), last 30 executions
    - `GET /executions/:id`: return full execution detail including per-step statuses, script text, video link, failure reasons in format `"[step name]: [human-readable error description]"`
    - _Requirements: 13.3, 13.4_

- [x] 11. Account and notification preference routes
  - [x] 11.1 Implement account settings routes
    - `GET /account`: return display name, email, subscription status
    - `PUT /account`: update display name (1–50 chars), initiate email change verification flow (send verification to new address, do not apply until verified)
    - `PUT /account/password`: verify current password, update to new password (min 8 chars)
    - `DELETE /account`: require user to type registered email, then trigger GDPR data deletion process (delete all user data within 30 days)
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 16.4_

  - [x] 11.2 Implement notification preference routes
    - `GET /account/notifications`: return current preferences for `notify_on_success`, `notify_on_failure`, `notify_on_pipeline_paused`
    - `PUT /account/notifications`: update preferences; default all to `true` for new users
    - _Requirements: 14.5, 21.6_

- [x] 12. Internal routes (service-token protected)
  - [x] 12.1 Implement internal trigger, notify, and pipeline-paused routes
    - `POST /internal/trigger-pipeline`: validate `N8N_SERVICE_TOKEN`, check pipeline active + subscription valid, fetch credentials from Vault using short-lived (15-min) service token, enqueue workflow in n8n
    - `POST /internal/notify`: validate service token, look up user notification preferences, send appropriate transactional email via Resend/SendGrid
    - `POST /internal/pipeline-paused`: validate service token, update `pipelines.status` to `"paused"`, send pipeline-paused email notification to user
    - _Requirements: 3.7, 12.8, 14.1, 14.2, 14.3, 14.4, 18.5_

- [x] 13. Checkpoint — Ensure all API route tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Notification system
  - [x] 14.1 Implement transactional email dispatch
    - Integrate Resend or SendGrid SDK; configure verified sender domain with DKIM/SPF/DMARC
    - Implement email templates for: `execution-success`, `execution-failure`, `pipeline-paused`, `token-expired`, `payment-failure`, `subscription-suspended`, `account-locked`, `email-verify`, `password-reset`, `email-change`
    - Each template includes required fields as specified in the notification triggers table
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6_

  - [x] 14.2 Implement notification preference enforcement
    - Before dispatching any pipeline-outcome email (success, failure, pause), query `notification_preferences` and skip dispatch if the relevant type is disabled
    - Auth-related emails (verification, password reset) are always sent regardless of preferences
    - _Requirements: 14.5_

  - [x] 14.3 Write property test for notification preference enforcement (Property 8)
    - **Property 8: Notification Preference Enforcement**
    - Generate random notification prefs + pipeline outcomes; assert disabled notification types produce no email dispatches
    - **Validates: Requirements 14.5**

- [x] 15. Public and legal routes
  - [x] 15.1 Implement public and compliance routes
    - `GET /privacy`: serve Privacy Policy page (publicly accessible, no auth required, HTTP 200) — disclose encrypted API key storage and use of OpenAI/HeyGen
    - `GET /terms`: serve Terms of Service page (publicly accessible, HTTP 200)
    - `POST /data-deletion`: accept email or user ID; initiate full data deletion; return HTTP 200 with confirmation or HTTP 404 if not found
    - `GET /robots.txt`: serve robots directives with at least one crawl directive
    - `GET /app-ads.txt`: serve authorized seller entries
    - _Requirements: 16.1, 16.2, 16.3, 16.9, 17.2, 17.6_

- [x] 16. n8n pipeline workflow implementation
  - [x] 16.1 Implement n8n workflow skeleton and credential injection
    - Create the `video-automation-pipeline` n8n workflow JSON with 9 nodes: Initialize, Content_Fetcher, Script_Generator, Video_Generator, File_Stager, Drive_Uploader, Social_Publisher, Cleanup, Notify
    - Implement credential injection: Backend API passes credentials as encrypted execution data to n8n via webhook payload; credentials are never written to n8n's persistent DB or logs
    - Each node wraps operation in try/catch; on error writes failure to `execution_logs` step record and branches to Cleanup + Notify nodes
    - _Requirements: 3.7, 18.5_

  - [x] 16.2 Implement Content_Fetcher node
    - Query RSS feeds and/or NewsAPI for articles matching `niche_keyword` within last 24 hours
    - If no results, extend window to 72 hours and retry once; if still no results, abort with `"no content found"`
    - Select single most relevant article by keyword relevance score; break ties by most recent publication timestamp
    - Extract article title, summary (preferred) or first 2,000 chars of body, and source URL
    - Sanitize: strip HTML tags, inline JavaScript, and analytics URL query parameters (`utm_*`, `fbclid`, `gclid`)
    - Abort with `"empty content after sanitization"` if sanitized content is empty
    - Log `content_fetch_status`, `content_fetch_article_url` in `execution_logs`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 16.3 Write property test for content sanitization completeness (Property 19)
    - **Property 19: Content Sanitization Completeness**
    - Generate random HTML strings with tags, scripts, and tracking params; assert output contains no HTML tags, no script content, no tracking query params
    - **Validates: Requirements 7.7, 7.8**

  - [x] 16.4 Implement Script_Generator node
    - Call OpenAI Chat Completions API with article content (capped at 5,000 chars, truncated at nearest sentence boundary), pipeline tone and duration parameters
    - Use user's `openai_api_key` if present in Vault; fall back to platform `PLATFORM_OPENAI_API_KEY`
    - Include system prompt: produce scripts free of copyrighted quotes, profanity, and misinformation
    - On API error or empty response: retry once after 10s; if retry also fails, abort with `"script generation failed"`
    - If generated script > 200 words: trim to nearest sentence boundary at or below 150 words
    - Store script text in `execution_logs.script_text`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 16.5 Write property test for script word count bounds (Property 6)
    - **Property 6: Script Word Count Bounds**
    - Generate random scripts of varying lengths; assert word count in [130, 200] after trimming; assert sentence boundary preserved on trim
    - **Validates: Requirements 8.2, 8.8**

  - [x] 16.6 Implement Video_Generator node
    - Call HeyGen Video Agent API with user's `heygen_api_key`, configured `avatar_id`, `video_language`, and script text
    - Store returned `video_id` in `execution_logs`
    - Poll HeyGen status endpoint every 30 seconds (max 30 minutes = 60 polls); abort with `"HeyGen generation timeout"` on timeout
    - On HeyGen 401/403: abort with `"HeyGen API key invalid or credits exhausted"`
    - On HeyGen `"failed"` status: abort with failure reason from payload or `"HeyGen reported failure with no reason provided"`
    - On `"completed"`: download video to Cloudflare R2; retry download once after 30s on failure; abort with `"HeyGen video download failed"` if retry fails
    - Record R2 object key and file size in bytes in `execution_logs`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 16.7 Implement Drive_Uploader node
    - Use stored Google Drive refresh token to obtain a new access token; on token exchange failure, record failure and abort upload step (continue to social publish)
    - Upload video from R2 to user's configured `gdrive_folder_id`; name file as `[PipelineName]_[YYYY-MM-DD]_[HH-MM].mp4`
    - On upload failure: retry once after 30 seconds; on retry failure: log error and continue to Social_Publisher (do NOT block social publishing)
    - On folder not found/inaccessible: record `"destination folder not found or inaccessible"`, continue to Social_Publisher
    - Record `gdrive_file_id` and `gdrive_link` in `execution_logs`
    - Trigger R2 object deletion within 60 minutes of upload attempt completion (success or failure)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 4.3, 4.5, 4.6_

  - [x] 16.8 Implement Social_Publisher node
    - Check Drive_Uploader result: if no video URL available, skip all platforms and record `"skipped: no video"` per platform
    - Query `platform_audit_status` table at runtime to determine routing per platform
    - During audit period (`audit_approved = false`): route through Ayrshare `/post` endpoint; record Ayrshare post ID in log
    - Post-audit (`audit_approved = true`): route through direct platform APIs (YouTube Data API v3, TikTok Content Posting API v2, Meta Graph API for Facebook/Instagram)
    - Apply platform-specific settings: YouTube visibility `"private"` during audit → user preference post-audit; TikTok `"SELF_ONLY"` during audit → user preference post-audit; include `ai_generated_content: true` for TikTok always
    - Generate AI-assisted caption per platform using GPT; enforce length limits: YouTube title ≤100 chars, TikTok/FB/IG captions ≤2,200 chars; include relevant hashtags (capped at 30) and source attribution
    - Per-platform failure: log failure reason and continue to remaining platforms
    - Record final per-platform status in `social_publish_results` JSONB; if all platforms fail, mark publish step as `"failed"`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 5.9, 5.10_

  - [x] 16.9 Write property test for social publisher per-platform independence (Property 4)
    - **Property 4: Social Publisher Per-Platform Independence**
    - Generate random subsets of platform failures; assert remaining platforms are still attempted and all have result entries
    - **Validates: Requirements 11.8, 15.2**

  - [x] 16.10 Write property test for drive upload non-blocking (Property 5)
    - **Property 5: Drive Upload Non-Blocking**
    - Generate random Drive failure types + platform configs; assert social publisher is still invoked after Drive failure; assert skip only when no video URL
    - **Validates: Requirements 10.5, 15.3**

  - [x] 16.11 Write property test for audit period routing invariant (Property 17)
    - **Property 17: Audit Period Routing Invariant**
    - Generate random platform + `audit_approved` state combinations; assert routing matches flag exclusively (Ayrshare when false, direct API when true, never both)
    - **Validates: Requirements 5.9, 5.10, 11.9**

  - [x] 16.12 Write property test for social platform caption length enforcement (Property 16)
    - **Property 16: Social Platform Caption Length Enforcement**
    - Generate random captions of varying lengths; assert YouTube title ≤100 chars, TikTok/FB/IG captions ≤2,200 chars enforced before submission
    - **Validates: Requirements 11.7**

  - [x] 16.13 Implement Cleanup and Notify nodes
    - Cleanup node: delete R2 staged video file (if not already deleted), finalize `execution_logs` record (`status`, `ended_at`, `duration_ms`)
    - Notify node: call `POST /internal/notify` with `execution_id`; send completion or failure email based on outcome
    - Ensure both nodes run even when an earlier node fails (error branch wiring)
    - _Requirements: 10.6, 14.1, 14.2, 15.5_

  - [x] 16.14 Write property test for execution log completeness (Property 3)
    - **Property 3: Pipeline Execution Logging Completeness**
    - Generate random execution outcomes with failure injected at each possible step; assert `execution_logs` record has non-null `started_at`, `ended_at`, `status`, and `{step}_status` for every entered step
    - **Validates: Requirements 15.5**

- [x] 17. Pipeline scheduling and consecutive failure logic
  - [x] 17.1 Implement skip-already-running logic in Backend API
    - Before triggering execution, query `execution_logs` for active (running) execution for same pipeline
    - If found: create `execution_logs` record with `status: "skipped"`, `failure_reason: "skipped: already running"` — do NOT count as failure
    - _Requirements: 12.4_

  - [x] 17.2 Write property test for skip trigger not counted as failure (Property 20)
    - **Property 20: Skip Trigger Not Counted as Failure**
    - Generate pipelines in `"running"` state receiving new triggers; assert `"skipped"` log entry created and `consecutive_failures` counter unchanged
    - **Validates: Requirements 12.4**

  - [x] 17.3 Implement consecutive failure counter and auto-pause
    - After each failed execution, increment `pipelines.consecutive_failures`
    - When `consecutive_failures` reaches `max_consecutive_failures` (1–5, default 3): set `pipelines.status = "paused"`, call `POST /internal/pipeline-paused`
    - On successful execution: reset `consecutive_failures` to 0
    - On user re-enabling paused pipeline: reset `consecutive_failures` to 0, resume scheduled executions
    - _Requirements: 12.7, 12.8, 12.9_

  - [x] 17.4 Write property test for consecutive failure counter monotonicity (Property 7)
    - **Property 7: Consecutive Failure Counter Monotonicity**
    - Generate random N in [1,5] + simulated failure sequences; assert status = `"paused"` after exactly N consecutive failures, counter = N
    - **Validates: Requirements 12.7**

- [x] 18. Token expiry detection and refresh
  - [x] 18.1 Implement social platform token expiry detection and Google Drive token validation
    - Implement token expiry check for social platforms: on 3 consecutive failed refresh attempts within 15 minutes, mark connection as `"token_expired"`, pause pipelines targeting that platform, send `token-expired` email within 15 minutes
    - Implement periodic background check (or on-execution check) for Google Drive refresh token validity; on non-retryable token refresh failure, record `"Google Drive authorization expired"` in execution log
    - _Requirements: 4.3, 4.5, 5.7_

- [x] 19. Checkpoint — Ensure all pipeline engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Next.js Dashboard — project setup and auth pages
  - [x] 20.1 Initialize Next.js 14+ project with App Router
    - Bootstrap Next.js with TypeScript, Tailwind CSS, `@supabase/supabase-js` client, SWR or React Query, and Zustand
    - Configure environment variables for Supabase URL, anon key, and Backend API base URL
    - Set up Supabase Realtime subscription hook for `execution_logs` table changes
    - _Requirements: 13.5_

  - [x] 20.2 Implement auth pages
    - `/login`: email/password form + Google OAuth button; redirect to `/dashboard` on success; show message if email unverified
    - `/register`: registration form with password strength validation matching backend rules
    - `/verify-email`: display verification status after email link click
    - `/forgot-password`, `/reset-password`: password reset request and apply forms
    - _Requirements: 1.1, 1.2, 1.3, 1.8_

- [x] 21. Dashboard pages — pipeline management
  - [x] 21.1 Implement onboarding checklist page (`/dashboard/onboarding`)
    - Render 5-step checklist: subscribe, connect Google Drive, add HeyGen key, connect social platform, create pipeline; enforce sequential completion
    - Mark each step complete via Supabase Realtime or SWR polling triggered by respective backend events
    - "Skip setup" button: hide checklist for session, make accessible from help menu
    - Add contextual help links to HeyGen API key docs and social platform OAuth setup guides
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 21.2 Implement pipeline list dashboard (`/dashboard`)
    - Display all pipelines with current status badge (active, paused, disabled, running), last execution result and timestamp
    - Show `"No executions yet. Your first execution will appear here after the pipeline runs."` when no executions exist
    - _Requirements: 13.1, 13.2, 13.8_

  - [x] 21.3 Implement pipeline creation wizard (`/pipelines/new`)
    - Multi-step form: name, niche keyword, schedule (recurrence + time + timezone), optional avatar/model/tone/duration config, platform selection (only connected platforms shown), Google Drive folder selection
    - Show `"HeyGen API key required. Add your key in Settings > Credentials."` if HeyGen key missing
    - On save: call `POST /pipelines`, redirect to pipeline detail on success
    - _Requirements: 6.2, 6.3, 6.4, 6.6_

  - [x] 21.4 Implement pipeline detail and execution history page (`/pipelines/:id`)
    - Display pipeline config summary, enable/disable toggle, manual trigger button
    - Paginated execution history (10 per page), last 30 executions
    - While execution in progress: auto-refresh status, current step, and elapsed duration every 10 seconds via SWR + Supabase Realtime
    - _Requirements: 13.3, 13.5_

  - [x] 21.5 Implement execution detail view (`/executions/:id`)
    - Display: start time, end time ("in progress" if running), total duration, per-step statuses, generated script text, video file link, failure reasons as `"[step name]: [human-readable error description]"`
    - _Requirements: 13.4_

- [x] 22. Settings pages
  - [x] 22.1 Implement credential settings page (`/settings/credentials`)
    - Display masked values (`••••[last4]`) for saved API keys — never display raw keys
    - Show connection status (connected / disconnected / expired) for Google Drive and each social platform
    - Buttons for connecting/disconnecting Google Drive and each social platform
    - Display connected platform permissions with scope identifiers and plain-language descriptions
    - _Requirements: 3.4, 4.8, 5.6, 13.6, 17.4_

  - [x] 22.2 Implement account settings page (`/settings/account`)
    - Display name edit (1–50 chars), email change (with verification flow), password change
    - Account deletion: require user to type registered email before confirming
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 22.3 Implement billing page (`/settings/billing`)
    - Display current subscription status and expiry date
    - Show "payment pending" status while Stripe checkout session is open
    - Link to Stripe Customer Portal for payment method update, invoices, and cancellation
    - _Requirements: 2.8, 2.10_

  - [x] 22.4 Implement notification preferences page (`/settings/notifications`)
    - Toggle controls for: success notifications, failure notifications, pipeline paused notifications
    - Persist changes via `PUT /account/notifications`
    - _Requirements: 14.5, 21.6_

- [x] 23. Public pages and compliance UI
  - [x] 23.1 Implement public-facing and compliance pages
    - `/privacy` page: publicly accessible, disclose encrypted API key storage and use of OpenAI/HeyGen
    - `/terms` page: publicly accessible Terms of Service
    - `/demo` page (no login required): demonstrate connecting social account, creating pipeline, triggering execution, viewing post
    - Add AI-generated content disclosure notice on Dashboard whenever a video is published to any platform
    - _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7, 17.1_

- [x] 24. Checkpoint — Ensure all frontend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Integration wiring and end-to-end verification
  - [x] 25.1 Wire Supabase Realtime to Dashboard execution status
    - Subscribe to `execution_logs` table changes (filtered by `user_id`) in Next.js; push live status updates to pipeline detail and execution views without polling
    - _Requirements: 13.5_

  - [x] 25.2 Wire n8n scheduling to pipeline enable/disable
    - On pipeline enable: create/update n8n Schedule Trigger cron expression via n8n REST API within 5 seconds
    - On pipeline disable: delete n8n Schedule Trigger within 5 seconds
    - On pipeline deletion: cancel all n8n scheduled executions; if execution in progress, wait for completion first
    - _Requirements: 12.6, 6.5, 6.8, 6.9_

  - [x] 25.3 Wire platform audit migration job
    - Implement background n8n job: when `platform_audit_status.audit_approved` is set to `true`, update all active pipeline configurations to use direct API path within 24 hours
    - _Requirements: 5.10, 17.7_

  - [x] 25.4 Write integration tests for Supabase Auth and RLS
    - Test registration, email verification, login, account lockout, and rate limiting against Supabase local dev instance
    - Test RLS policies: authenticated queries return only own rows across all tables
    - _Requirements: 1.1–1.8, 3.8, 18.1_

  - [x] 25.5 Write integration tests for Stripe webhook and subscription state
    - Simulate `checkout.session.completed`, `invoice.payment_failed`, subscription expiry events
    - Assert subscription status changes in `user_profiles` within expected time bounds
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 25.6 Write integration tests for n8n trigger and R2 lifecycle
    - Test Backend API webhook call → n8n workflow execution started
    - Test R2 object staged → deleted after execution (within 60 minutes)
    - _Requirements: 9.6, 10.6_

  - [x] 25.7 Write integration tests for OAuth flows
    - Test Google Drive OAuth: authorization code → refresh token stored in Vault
    - Test each social platform OAuth callback → tokens stored correctly
    - _Requirements: 4.1, 4.2, 5.1–5.5_

- [x] 26. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but are strongly recommended for production reliability
- Each task references specific requirements for full traceability
- Property-based tests use **fast-check** with a minimum of **100 iterations per property**; each test file includes the tag comment `// Feature: ai-video-automation-saas, Property N: <property text>`
- The n8n workflow JSON files should be version-controlled as exports in `/n8n/workflows/`
- Credentials are never stored in n8n's credential store — always injected via execution data from the Backend API
- All Docker images in `docker-compose.prod.yml` must use pinned versions, not `latest`
- The internal Docker network (`internal`) must never be exposed through Nginx

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1", "20.1"] },
    { "id": 1, "tasks": ["2.2", "3.2", "5.1", "9.1"] },
    { "id": 2, "tasks": ["2.3", "3.3", "3.4", "5.2", "5.3", "5.4", "20.2"] },
    { "id": 3, "tasks": ["3.5", "3.6", "6.1", "7.1", "8.1", "15.1", "16.1"] },
    { "id": 4, "tasks": ["3.7", "3.8", "6.2", "7.2", "7.3", "7.4", "8.2", "8.3", "8.4", "16.2"] },
    { "id": 5, "tasks": ["3.9", "6.3", "10.1", "11.1", "11.2", "14.1", "16.3", "16.4", "16.6", "16.7", "17.1"] },
    { "id": 6, "tasks": ["12.1", "14.2", "16.5", "16.8", "17.3", "21.1", "21.2", "21.3"] },
    { "id": 7, "tasks": ["14.3", "16.9", "16.10", "16.11", "16.12", "16.13", "17.2", "17.4", "21.4", "21.5"] },
    { "id": 8, "tasks": ["16.14", "18.1", "22.1", "22.2", "22.3", "22.4"] },
    { "id": 9, "tasks": ["23.1", "25.1", "25.2", "25.3"] },
    { "id": 10, "tasks": ["25.4", "25.5", "25.6", "25.7"] }
  ]
}
```
