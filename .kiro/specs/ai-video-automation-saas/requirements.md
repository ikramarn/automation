# Requirements Document

## Introduction

This document specifies the requirements for an AI Video Automation SaaS platform. The platform provides users with a fully automated pipeline to discover niche content, generate 60-second AI avatar video scripts using GPT, produce videos via the user's own HeyGen account, store completed videos in Google Drive, and distribute them across connected social media platforms on a user-defined schedule.

The platform operates as "plumbing" between third-party services: users supply their own API credentials (HeyGen, OpenAI), pay those vendors directly, and pay the platform a flat monthly subscription (~$15–$29/month) for access to the automation pipeline. The backend automation engine is n8n (self-hosted), the database and auth layer is Supabase, file staging uses Cloudflare R2, and the frontend is a Next.js dashboard hosted on a Hetzner VPS.

---

## Glossary

- **Platform**: The AI Video Automation SaaS system described in this document.
- **User**: A registered subscriber of the Platform who has an active paid subscription.
- **Pipeline**: A user-configured automation unit that defines a content niche, schedule, avatar preferences, and publishing destinations.
- **Pipeline_Engine**: The n8n self-hosted automation engine that executes Pipelines.
- **Backend_API**: The Node.js (Express/Fastify) service that handles authentication, credential retrieval, pipeline orchestration, and business logic.
- **Dashboard**: The Next.js web frontend through which Users manage their account, credentials, and Pipelines.
- **Credential_Vault**: The Supabase Vault encrypted storage for User-supplied third-party API keys and OAuth tokens.
- **Content_Fetcher**: The component within the Pipeline_Engine that retrieves niche-relevant articles via RSS feeds and NewsAPI.
- **Script_Generator**: The component within the Pipeline_Engine that calls the OpenAI GPT API to produce a 60-second video script.
- **Video_Generator**: The component within the Pipeline_Engine that calls the HeyGen Video Agent API to produce an AI avatar video.
- **File_Stager**: The Cloudflare R2 bucket used for temporary storage of generated video files during the pipeline execution.
- **Drive_Uploader**: The component within the Pipeline_Engine that uploads completed videos to the User's Google Drive.
- **Social_Publisher**: The component within the Pipeline_Engine that distributes videos to connected social media platforms.
- **Scheduler**: The cron-based triggering mechanism in n8n that fires Pipelines at User-defined times.
- **Execution_Log**: A database record in Supabase capturing the result (success or failure per step) of a single Pipeline run.
- **Subscription**: The billing relationship between a User and the Platform, managed via Stripe.
- **HeyGen_API**: The third-party AI avatar video generation API, accessed using the User's own HeyGen API key.
- **OpenAI_API**: The third-party GPT API used for script generation, accessed using either the User's own key or a platform-provided key.
- **Ayrshare**: A third-party social media posting intermediary used during the platform audit period before direct API access is approved.
- **RLS**: Supabase Row Level Security — database policies that restrict each User to their own data rows.
- **Audit_Period**: The window of time between submission and approval of social platform app audits (YouTube, TikTok, Meta).
- **AI_Content_Label**: A disclosure flag required by TikTok (and recommended by other platforms) indicating that content was AI-generated.

---

## Requirements

---

### Requirement 1: User Registration and Authentication

**User Story:** As a visitor, I want to create an account and log in securely, so that I can access the Platform and manage my Pipelines.

#### Acceptance Criteria

1. THE Platform SHALL allow visitors to register using an email address and password, where the password is 8–64 characters in length and contains at least one uppercase letter, one lowercase letter, one digit, and one special character.
2. THE Platform SHALL allow visitors to register using Google OAuth as an alternative to email/password.
3. WHEN a new User registers with email and password, THE Platform SHALL send an email verification link that expires after 24 hours before activating the account.
4. WHEN a User submits valid credentials and their account is active and verified, THE Platform SHALL issue a session token with a lifetime of 24 hours and redirect the User to the Dashboard; IF a User submits valid credentials but their account is not active or not verified, THE Platform SHALL reject the login attempt.
5. IF a User submits invalid credentials three consecutive times within a 15-minute window, THEN THE Platform SHALL lock the account for 15 minutes and notify the User via email.
6. WHEN a User requests a password reset, THE Platform SHALL send a single-use password reset link that expires after 60 minutes.
7. THE Platform SHALL enforce HTTPS for all authentication endpoints.
8. IF a User attempts to log in before verifying their email address, THEN THE Platform SHALL reject the login attempt and display a message prompting the User to verify their email.

---

### Requirement 2: Subscription and Billing Management

**User Story:** As a registered User, I want to purchase and manage a subscription plan, so that I can unlock pipeline creation and execution.

#### Acceptance Criteria

1. THE Platform SHALL offer at least one paid subscription tier priced between $15 and $29 per month.
2. WHEN a User selects a subscription plan, THE Platform SHALL redirect the User to a Stripe-hosted checkout page.
3. WHEN a Stripe webhook confirms a successful payment, THE Platform SHALL activate the User's subscription within 60 seconds.
4. WHEN a Stripe webhook reports a payment failure, THE Platform SHALL suspend Pipeline execution and send the User an email notification within 15 minutes.
5. WHEN a subscription reaches its expiry date without renewal, THE Platform SHALL suspend Pipeline execution and send the User an email notification within 15 minutes.
6. WHILE a User's subscription is suspended, THE Platform SHALL allow the User to access the Dashboard in read-only mode, where read-only mode means the User can view pipelines, execution logs, and settings but cannot create, edit, execute, or delete any resource.
7. WHEN a User cancels a subscription, THE Platform SHALL maintain active access until the end of the current billing period.
8. THE Platform SHALL provide a billing portal link (Stripe Customer Portal) where Users can update their payment method, view invoices, and cancel their subscription.
9. IF a Stripe webhook delivery fails, THEN THE Backend_API SHALL retry processing the webhook up to 5 times with exponential backoff, using an initial delay of 5 seconds, doubling on each retry, up to a maximum delay of 320 seconds.
10. WHILE a User's Stripe checkout session is open (after redirect, before webhook confirmation), THE Platform SHALL display a "payment pending" status on the Dashboard and SHALL NOT activate the subscription until the webhook confirms successful payment.

---

### Requirement 3: Credential Management

**User Story:** As a User, I want to securely store my third-party API keys and OAuth tokens, so that the Platform can use them on my behalf during Pipeline execution.

#### Acceptance Criteria

1. THE Platform SHALL allow Users to store a HeyGen API key in the Credential_Vault.
2. THE Platform SHALL allow Users to store an OpenAI API key in the Credential_Vault.
3. THE Platform SHALL store all User-supplied API keys encrypted using Supabase Vault (AES-256 encryption at rest).
4. WHEN a User saves an API key, THE Dashboard SHALL display only the last 4 characters of the key prefixed with "••••" after saving.
5. THE Platform SHALL allow Users to delete any stored credential at any time.
6. WHEN a User deletes a credential that is referenced by an active Pipeline, THE Platform SHALL pause those Pipelines and notify the User; credentials SHALL NOT be written to application logs at any point.
7. THE Backend_API SHALL retrieve credentials from Supabase Vault only at Pipeline execution time and SHALL NOT persist them in memory beyond a single execution request.
8. THE Platform SHALL enforce RLS on all credential records so that each User can only read and modify their own credentials.
9. IF a credential retrieval from the Credential_Vault fails, THEN THE Pipeline_Engine SHALL abort the Pipeline execution and record the failure in the Execution_Log, including the error reason from the Credential_Vault (e.g., "decryption failed", "secret not found"); THE Pipeline_Engine SHALL only abort and log when credential retrieval actually fails, not when retrieval succeeds but other pipeline conditions indicate failure.

---

### Requirement 4: Google Drive OAuth Integration

**User Story:** As a User, I want to connect my Google Drive account, so that completed videos are automatically saved to my Drive.

#### Acceptance Criteria

1. WHEN a User clicks the "Connect Google Drive" button, THE Platform SHALL initiate a Google OAuth 2.0 authorization flow requesting only the `drive.file` scope.
2. WHEN Google returns a successful OAuth callback, THE Platform SHALL store the resulting refresh token in the Credential_Vault.
3. WHEN a Drive_Uploader needs to upload a video, THE Backend_API SHALL use the stored refresh token to obtain a new access token; IF the token exchange fails, THE Backend_API SHALL record the failure in the Execution_Log and abort the upload step.
4. WHEN a User clicks "Disconnect Google Drive", THE Platform SHALL delete the stored refresh token from the Credential_Vault; WHEN deletion is complete, THE Platform SHALL update the Drive connection status to "disconnected" on the Dashboard; the Drive connection status SHALL only be set to "disconnected" through explicit User-initiated disconnection, not through automatic token expiration or administrative actions.
5. IF the Google OAuth refresh token is revoked, expired, OR the token refresh request fails with a non-retryable error, THEN THE Pipeline_Engine SHALL abort the upload step and record the failure in the Execution_Log with the reason "Google Drive authorization expired".
6. WHEN the Drive_Uploader successfully uploads a video, THE Drive_Uploader SHALL record the Google Drive file ID and shareable link in the Execution_Log.
7. WHEN a User initiates the Google OAuth flow and Google returns an error or the User denies authorization, THE Platform SHALL display an error message on the Dashboard and retain any previously connected Drive status unchanged.
8. THE Dashboard SHALL display the Google Drive connection status (connected / disconnected / expired) on the credential settings page.

---

### Requirement 5: Social Media Account Connection

**User Story:** As a User, I want to connect my YouTube, TikTok, Facebook, and Instagram accounts, so that the Platform can publish videos on my behalf.

#### Acceptance Criteria

1. THE Platform SHALL support OAuth-based connection for YouTube (Google OAuth, `youtube.upload` scope).
2. THE Platform SHALL support OAuth-based connection for TikTok (TikTok Content Posting API).
3. THE Platform SHALL support OAuth-based connection for Facebook Pages (Meta Graph API, `pages_manage_posts` and `pages_read_engagement` scopes).
4. THE Platform SHALL support OAuth-based connection for Instagram (Meta Graph API, `instagram_content_publish` scope).
5. WHEN a User completes an OAuth flow for any social platform, THE Platform SHALL store the resulting access and refresh tokens in the Credential_Vault.
6. THE Platform SHALL display the connection status (connected / disconnected / token_expired) for each social platform on the Dashboard.
7. WHEN a social platform token expires and cannot be refreshed after 3 consecutive failed refresh attempts over a period not exceeding 15 minutes, THE Platform SHALL mark the connection as "token_expired", pause any Pipelines targeting that platform, and send the User an email notification within 15 minutes of detection.
8. WHEN a User disconnects a social platform, THE Platform SHALL first pause all active Pipelines that target that platform, then delete the associated tokens from the Credential_Vault; IF token deletion fails after pipelines are already paused, THE Platform SHALL allow the disconnection to complete, leaving the tokens in the vault.
9. WHILE the Audit_Period is active for a given social platform, THE Social_Publisher SHALL route publish requests for that platform through the Ayrshare intermediary layer instead of the direct platform API.
10. WHEN a platform audit is approved and direct API access is enabled, THE Platform SHALL switch that platform's publish path from Ayrshare to the direct platform API without requiring User action.
11. WHEN a User initiates an OAuth flow for a social platform and the platform returns an error or the User denies authorization, THE Platform SHALL display an error message on the Dashboard and retain any previously connected status unchanged; WHEN a User completes an OAuth flow for a social platform successfully, THE Platform SHALL update the connection status to "connected" on the Dashboard.

---

### Requirement 6: Pipeline Creation and Configuration

**User Story:** As a User, I want to create and configure automated video Pipelines, so that the Platform generates and publishes videos on my defined schedule.

#### Acceptance Criteria

1. THE Platform SHALL allow Users with an active subscription to create up to 5 Pipelines per account on the base tier; IF a User attempts to create a Pipeline when the 5-Pipeline limit is reached, THEN THE Platform SHALL reject the request and display the message "Pipeline limit reached. Upgrade your plan to create more pipelines."
2. WHEN a User creates a Pipeline, THE Platform SHALL require the User to provide: a pipeline name (1–100 characters), a content niche keyword or phrase (1–200 characters), at least one publishing destination, and a schedule defined as a recurrence type (daily, weekdays, or custom day-of-week selection) plus a time-of-day (HH:MM in the User's configured timezone).
3. THE Platform SHALL allow Users to configure the following per Pipeline: OpenAI model preference (defaulting to GPT-4o-mini), HeyGen avatar ID, video language, script tone (one of: "professional", "casual", "energetic", "educational", or "entertaining"), target video duration (minimum 30 seconds, maximum 300 seconds, default 60 seconds), and Google Drive destination folder.
4. THE Platform SHALL allow Users to select which social platforms to publish to per Pipeline, restricted to platforms the User has connected.
5. THE Platform SHALL allow Users to enable or disable a Pipeline without deleting it; IF a Pipeline is disabled while an execution is in progress, THEN THE Platform SHALL allow the current execution to complete before transitioning the Pipeline to disabled state.
6. WHEN a User saves a Pipeline configuration AND a HeyGen API key is present in the Credential_Vault, THE Platform SHALL save the configuration; IF no HeyGen API key is stored, THEN THE Platform SHALL block the save and display the message "HeyGen API key required. Add your key in Settings > Credentials."
7. THE Platform SHALL allow Users to edit any Pipeline configuration at any time; changes SHALL take effect on the next scheduled execution.
8. THE Platform SHALL allow Users to delete a Pipeline, which SHALL cancel all future scheduled executions for that Pipeline; IF a User deletes a Pipeline while an execution is in progress, THE Platform SHALL keep the Pipeline record until the in-progress execution completes before removing the record and cancelling future executions.

---

### Requirement 7: Content Fetching

**User Story:** As a User, I want the Platform to automatically find the latest news and articles relevant to my chosen niche, so that my videos are based on current, relevant content.

#### Acceptance Criteria

1. WHEN a Pipeline execution begins, THE Content_Fetcher SHALL query at least one RSS feed or the NewsAPI for articles matching the Pipeline's configured niche keyword.
2. WHEN the Content_Fetcher begins a fetch operation, THE Content_Fetcher SHALL query only for articles with a publication timestamp within the 24-hour window preceding the execution trigger time.
3. WHEN multiple articles are retrieved, THE Content_Fetcher SHALL select the single most relevant article based on keyword relevance scoring; WHEN multiple articles share equal relevance scores, THE Content_Fetcher SHALL select the article with the most recent publication timestamp.
4. WHEN an article is selected, THE Content_Fetcher SHALL extract the article title, the summary field if present (preferred over body text), or the first 2,000 characters of the body text if no summary is available, and the source URL.
5. IF no articles matching the niche keyword are found within the 24-hour window, THEN THE Content_Fetcher SHALL extend the search window to 72 hours and retry once.
6. IF no articles are found after the extended search, THEN THE Pipeline_Engine SHALL abort the execution and record the failure in the Execution_Log with the reason "no content found".
7. WHEN extracted text is passed to the Script_Generator, THE Content_Fetcher SHALL have removed all HTML tags, inline JavaScript, and URL query parameters used for analytics tracking.
8. IF the sanitized article content is empty after HTML and JavaScript removal, THEN THE Pipeline_Engine SHALL abort the execution and record the failure as "empty content after sanitization".

---

### Requirement 8: Script Generation

**User Story:** As a User, I want GPT to automatically write a 60-second video script from the fetched article, so that I don't have to write content manually.

#### Acceptance Criteria

1. WHEN the Content_Fetcher delivers article content, THE Script_Generator SHALL call the OpenAI Chat Completions API with the article content (capped at 5,000 characters, truncated at the nearest sentence boundary) and the Pipeline's configured tone and duration parameters.
2. THE Script_Generator SHALL generate a script of 130–150 words targeted at a spoken duration of 60 seconds.
3. THE Script_Generator SHALL use the User's stored OpenAI API key if present; otherwise THE Script_Generator SHALL use the platform-provided OpenAI API key.
4. THE Script_Generator SHALL include a system prompt instructing GPT to produce scripts free of copyrighted quotes, profanity, and misinformation.
5. WHEN the OpenAI API returns a successful response (a response containing a non-empty string in the script field), THE Script_Generator SHALL store the generated script text in the Execution_Log.
6. IF the OpenAI API returns an error or rate-limit response, THEN THE Script_Generator SHALL retry the request once after a 10-second delay; IF the OpenAI API returns an empty or malformed response, THE Script_Generator SHALL also retry the request once after a 10-second delay; THE Script_Generator SHALL NOT retry when the OpenAI API returns a successful response that fails content validation (e.g., content filtering) — such failures SHALL be accepted without retry.
7. IF the retry also fails, THEN THE Pipeline_Engine SHALL abort the execution and record the failure in the Execution_Log with the reason "script generation failed".
8. IF the generated script exceeds 200 words, THEN THE Script_Generator SHALL trim it to the nearest sentence boundary at or below 150 words.

---

### Requirement 9: AI Avatar Video Generation

**User Story:** As a User, I want HeyGen to automatically generate an AI avatar video from my script, so that I receive a polished video without recording myself.

#### Acceptance Criteria

1. WHEN the Script_Generator delivers a script, THE Video_Generator SHALL call the HeyGen Video Agent API using the User's stored HeyGen API key, including the Pipeline's configured avatar ID, video language, and the full script text as required request payload fields.
2. WHEN HeyGen returns a `video_id` in response to the generation request, THE Video_Generator SHALL store the `video_id` in the Execution_Log.
3. THE Video_Generator SHALL poll the HeyGen status endpoint continuously every 30 seconds until the video status is "completed" or "failed".
4. THE Video_Generator SHALL poll for a maximum of 30 minutes; IF the video is not completed within 30 minutes, THEN THE Pipeline_Engine SHALL abort and record the failure as "HeyGen generation timeout".
5. IF the HeyGen API returns an authentication error (HTTP 401 or 403), THEN THE Pipeline_Engine SHALL abort and record the failure as "HeyGen API key invalid or credits exhausted".
6. WHEN the HeyGen status endpoint returns "completed", THE Video_Generator SHALL download the video file to the File_Stager (Cloudflare R2); IF the video file download from HeyGen fails, THEN THE Pipeline_Engine SHALL retry the download once after 30 seconds; IF the retry also fails, THE Pipeline_Engine SHALL abort and record the failure as "HeyGen video download failed".
7. IF HeyGen returns a "failed" status, THEN THE Pipeline_Engine SHALL abort and record the failure reason from the HeyGen response payload; IF the HeyGen response payload contains no failure reason, THE Pipeline_Engine SHALL record the failure reason as "HeyGen reported failure with no reason provided".
8. WHEN the video file is successfully staged in the File_Stager, THE Video_Generator SHALL record the R2 object key and file size in bytes in the Execution_Log.
9. IF the User's HeyGen API key is missing from the Credential_Vault at execution time, THEN THE Pipeline_Engine SHALL abort and record the failure as "HeyGen API key not configured".

---

### Requirement 10: Google Drive Video Upload

**User Story:** As a User, I want completed videos saved to my Google Drive automatically, so that I have a permanent copy outside the Platform.

#### Acceptance Criteria

1. WHEN the video file is available in the File_Stager, THE Drive_Uploader SHALL upload the video to the User's configured Google Drive destination folder.
2. THE Drive_Uploader SHALL name the uploaded file using the format: `[PipelineName]_[YYYY-MM-DD]_[HH-MM].mp4`.
3. WHEN the Drive upload is complete, THE Drive_Uploader SHALL record the Google Drive file ID and link in the Execution_Log.
4. IF the Drive upload fails due to any upload error including network failures, quota exceeded, authentication timeout, server errors, and permission errors, THEN THE Drive_Uploader SHALL retry once after a 30-second delay.
5. IF the retry also fails, THEN THE Pipeline_Engine SHALL record the error reason and timestamp of the failure in the Execution_Log and continue to the Social_Publisher step (Drive upload failure SHALL NOT block social publishing).
6. WHEN the Drive upload succeeds or fails, THE File_Stager SHALL delete the temporary video file from Cloudflare R2 within 60 minutes of the upload attempt completion.
7. IF the User's configured Google Drive destination folder is not accessible or does not exist at upload time, THEN THE Drive_Uploader SHALL abort the upload, record the failure as "destination folder not found or inaccessible", and continue to the Social_Publisher step.

---

### Requirement 11: Social Media Video Publishing

**User Story:** As a User, I want my completed videos automatically published to my connected social media accounts, so that I don't have to post manually.

#### Acceptance Criteria

1. WHEN the Drive_Uploader step completes successfully and a video file URL is available, THE Social_Publisher SHALL attempt to publish the video to each social platform configured in the Pipeline; IF the Drive_Uploader step failed and no video file URL is available, THE Social_Publisher SHALL skip all platform publishing and record each platform status as "skipped: no video".
2. WHILE the Audit_Period is active for YouTube, THE Social_Publisher SHALL set video visibility to "private"; WHEN YouTube audit is approved, THE Social_Publisher SHALL set visibility per User preference, defaulting to "public".
3. WHILE the Audit_Period is active for TikTok, THE Social_Publisher SHALL set video privacy to "SELF_ONLY"; WHEN TikTok audit is approved, THE Social_Publisher SHALL set privacy per User preference, defaulting to "PUBLIC_TO_EVERYONE".
4. WHEN publishing to TikTok, THE Social_Publisher SHALL include the AI-generated content disclosure label (`ai_generated_content: true`) in the upload request as required by TikTok policy.
5. WHEN publishing to Facebook, THE Social_Publisher SHALL post the video as a Reel to the User's connected Facebook Page.
6. WHEN publishing to Instagram, THE Social_Publisher SHALL post the video as a Reel using the Meta Graph API container/publish workflow.
7. THE Social_Publisher SHALL generate an AI-assisted caption for each platform using GPT, incorporating relevant hashtags (capped at 30 per platform) and a source attribution to the original article URL; YouTube titles SHALL NOT exceed 100 characters; TikTok captions SHALL NOT exceed 2,200 characters; Facebook and Instagram captions SHALL NOT exceed 2,200 characters; IF caption generation fails, THE Social_Publisher SHALL allow publishing to proceed without blocking, using an empty caption as fallback.
8. IF a publish attempt to a platform fails, THEN THE Social_Publisher SHALL record the failure reason in the Execution_Log for that platform and continue publishing to the remaining configured platforms; IF recording the failure reason itself fails, THE Social_Publisher SHALL continue publishing to remaining platforms regardless.
9. WHILE the Audit_Period is active for a platform, THE Social_Publisher SHALL route the publish request through Ayrshare and record the Ayrshare post ID in the Execution_Log; IF the Ayrshare API returns an error during the Audit_Period, THE Social_Publisher SHALL record the failure as "Ayrshare publish failed: [error message]" in the Execution_Log.
10. WHEN all platform publish attempts are complete, THE Social_Publisher SHALL record the final per-platform status (success / failed / skipped) in the Execution_Log; WHEN all configured platforms fail, THE Social_Publisher SHALL mark the overall publishing step status as "failed" in the Execution_Log.

---

### Requirement 12: Pipeline Scheduling

**User Story:** As a User, I want my Pipelines to run automatically on a schedule I define, so that content is published consistently without manual intervention.

#### Acceptance Criteria

1. THE Platform SHALL allow Users to configure a Pipeline schedule using at minimum: a specific time of day (HH:MM hour and minute resolution) and a recurrence (daily, weekdays only, or custom day-of-week selection).
2. THE Platform SHALL display and store all schedule times in UTC, with a User-selectable timezone for display.
3. WHEN a scheduled trigger fires, THE Scheduler SHALL initiate the corresponding Pipeline execution within 60 seconds of the configured time.
4. IF a scheduled trigger fires for a Pipeline that is already executing, THEN THE Scheduler SHALL skip that trigger, record "skipped: already running" in the Execution_Log, and SHALL NOT count the skip as a failure toward the consecutive failure threshold.
5. THE Platform SHALL allow Users to trigger a Pipeline execution manually from the Dashboard outside of the schedule; IF a Pipeline is in paused state, THE Platform SHALL NOT allow manual triggering until the Pipeline is re-enabled by the User.
6. WHEN a User disables a Pipeline, THE Scheduler SHALL cancel all future scheduled executions for that Pipeline within 5 seconds of the User saving the disabled state.
7. THE Platform SHALL allow Users to configure a Pipeline to pause after N consecutive failures (configurable 1–5, default 3), where a "failure" is defined as an execution that terminates due to an error or timeout at any pipeline step, and "paused" means the schedule is retained in the database but no further triggers are fired; WHEN a Pipeline transitions to paused state due to consecutive failures, THE Platform SHALL set the pipeline state to PAUSED and set a flag indicating it was paused due to consecutive failures.
8. WHEN a Pipeline transitions to paused state due to consecutive failures, THE Platform SHALL send the User an email notification containing the pipeline name, the number of consecutive failures, and the last failure reason.
9. WHEN a User re-enables a paused Pipeline, THE Platform SHALL reset the consecutive failure counter to zero and resume scheduled executions from the next scheduled trigger time.

---

### Requirement 13: Execution Monitoring and Dashboard

**User Story:** As a User, I want to see the status and history of my Pipeline executions in the Dashboard, so that I can monitor performance and diagnose failures.

#### Acceptance Criteria

1. WHEN a User navigates to the Dashboard home page, THE Dashboard SHALL display a list of all their Pipelines with their current status (active, paused, disabled, running).
2. THE Dashboard SHALL display the last execution result (success / failed / partial) and timestamp for each Pipeline.
3. WHEN a User selects a Pipeline, THE Dashboard SHALL display a paginated execution history (10 executions per page) showing the last 30 executions.
4. WHEN a User views an execution record, THE Dashboard SHALL display: execution start time, end time (displaying "in progress" for in-progress executions), total duration, per-step status (content fetch, script generation, video generation, drive upload, per-platform publish), generated script text, video file link (if available), and failure reason for any failed steps in the format "[step name]: [human-readable error description]"; these execution details SHALL only be displayed when the User explicitly views an individual execution record, not in list views or summary contexts.
5. WHILE a Pipeline execution is in progress, THE Dashboard SHALL automatically refresh the execution status, current step name, and elapsed duration every 10 seconds.
6. WHEN a User navigates to the Credentials settings page, THE Dashboard SHALL display connection status for each service as one of: connected, disconnected, or expired.
7. THE Platform SHALL retain Execution_Log records for a minimum of 90 days; Execution_Log records older than 90 days SHALL be deleted from the database.
8. WHEN a User navigates to a Pipeline's execution history page and no executions exist yet, THE Dashboard SHALL display the message "No executions yet. Your first execution will appear here after the pipeline runs."

---

### Requirement 14: Notifications

**User Story:** As a User, I want to receive email notifications about Pipeline outcomes, so that I'm informed of successes and failures without checking the Dashboard.

#### Acceptance Criteria

1. WHEN a Pipeline execution completes successfully, THE Platform SHALL send the User an email notification containing: pipeline name, execution timestamp, video title, Google Drive link (if available), and per-platform publish status.
2. WHEN a Pipeline execution fails at any step, THE Platform SHALL send the User an email notification containing: pipeline name, execution timestamp, the step at which the failure occurred, and the failure reason.
3. WHEN a Pipeline is automatically paused due to consecutive failures, THE Platform SHALL send the User an email notification containing: pipeline name, execution timestamp, consecutive failure count, and last failure reason.
4. WHEN a social platform token expires and cannot be refreshed, THE Platform SHALL send the User an email notification containing a direct link to the platform's connection settings page (/settings/connections).
5. THE Platform SHALL allow Users to configure notification preferences per event type (success notifications, failure notifications, pause notifications) from the Dashboard settings; the default state for all notification types is enabled; WHEN a notification type is disabled, THE Platform SHALL NOT send that notification type regardless of pipeline outcome.
6. THE Platform SHALL send transactional emails following best practices (verified sender domain, correct formatting, proper authentication headers such as SPF, DKIM, and DMARC) to minimize the risk of spam classification by major email providers; THE Platform does not guarantee delivery classification as the Platform cannot control recipient provider decisions.

---

### Requirement 15: Error Handling and Graceful Degradation

**User Story:** As a User, I want the Platform to handle errors gracefully, so that failures in one step or one platform don't cause unnecessary data loss or silent failures.

#### Acceptance Criteria

1. WHEN the HeyGen API returns a credit exhaustion error, THE Pipeline_Engine SHALL abort the video generation step and update the Execution_Log status with a message identifying "HeyGen credit exhaustion" as the cause; this status SHALL be visible in the Dashboard execution detail view.
2. WHEN a single social platform publish fails, THE Social_Publisher SHALL continue publishing to all remaining configured platforms; WHEN all configured platforms fail, THE Social_Publisher SHALL mark the overall publishing step status as "failed" in the Execution_Log.
3. WHEN the Google Drive upload fails, THE Pipeline_Engine SHALL record the Drive upload failure reason and timestamp in the Execution_Log before continuing to the social publishing step.
4. IF the File_Stager (Cloudflare R2) upload fails, THEN THE Pipeline_Engine SHALL abort the execution and record the failure before proceeding to any downstream steps that depend on the video file.
5. THE Pipeline_Engine SHALL record the start time, end time, and outcome of every step in the Execution_Log regardless of success or failure.
6. WHEN an unhandled exception occurs in any Pipeline step, THE Pipeline_Engine SHALL catch the exception, record the exception type, exception message, and originating step name in the Execution_Log, and abort without retrying automatically.
7. THE Backend_API SHALL return structured JSON error responses with an HTTP status code, error code, and a human-readable message describing the failure cause for all 4xx and 5xx HTTP error conditions; THE Backend_API SHALL also return structured JSON responses for successful (2xx) operations.

---

### Requirement 16: Legal Pages and Compliance

**User Story:** As the Platform operator, I want the Platform to include required legal pages and compliance mechanisms, so that social media platform app audits pass and regulatory obligations are met.

#### Acceptance Criteria

1. THE Platform SHALL serve a Privacy Policy page at a publicly accessible URL (e.g., `/privacy`), where "publicly accessible" means no authentication is required and the page returns HTTP 200 with page content.
2. THE Platform SHALL serve a Terms of Service page at a publicly accessible URL (e.g., `/terms`), where "publicly accessible" means no authentication is required and the page returns HTTP 200 with page content.
3. WHEN a request is received at the `/data-deletion` endpoint containing a registered email address or user account ID, THE Platform SHALL initiate deletion of all associated User data and return HTTP 200 with a confirmation message; IF the request contains an identifier where any part is unrecognized (including cases where only one identifier type is registered and the other does not exist), THE Platform SHALL return HTTP 404 with the message "No account found for the provided identifier".
4. WHEN a User account is deleted, THE Platform SHALL delete all associated personal data, credentials, pipeline configurations, and execution logs within 30 days.
5. THE Privacy Policy page SHALL disclose that the Platform stores third-party API keys encrypted on behalf of Users.
6. THE Privacy Policy page SHALL disclose that the Platform uses AI services (OpenAI, HeyGen) to process User content.
7. WHEN a User publishes a video to any destination platform supported by the Platform, THE Dashboard SHALL display an AI-generated content disclosure notice containing at minimum: the statement that the video was AI-generated and the user's responsibility to comply with platform labeling policies.
8. WHEN the Social_Publisher publishes a video to TikTok, THE Social_Publisher SHALL include `ai_generated_content: true` in the upload request.
9. IF the `/data-deletion` endpoint receives a request with an unrecognized email address or user ID, THE Platform SHALL return HTTP 404 with the message "No account found for the provided identifier".

---

### Requirement 17: Platform App Audit Readiness

**User Story:** As the Platform operator, I want the Platform to be structured to pass social media platform app audits, so that direct API publishing is eventually unlocked for all Users.

#### Acceptance Criteria

1. THE Platform SHALL maintain a publicly accessible demo environment (no login required) that demonstrates: connecting a social account, creating a Pipeline, triggering a manual execution, and viewing the resulting post on the connected platform.
2. THE Platform SHALL implement a `/data-deletion` callback URL conforming to Meta's Data Deletion Callback specification.
3. THE Platform SHALL request only the OAuth scopes listed in the Platform's published permissions policy page; the implemented scopes SHALL NOT exceed those declared in the policy.
4. THE Platform SHALL display its connected social platform permissions to Users in account settings, including the scope identifier and a plain-language description of each scope's purpose for each connected platform.
5. WHEN submitting for TikTok audit, THE Platform SHALL demonstrate the AI-generated content label (`ai_generated_content`) being applied to all uploads.
6. THE Platform SHALL include a `robots.txt` and an `app-ads.txt` at the root domain as required by platform policy; `robots.txt` SHALL contain at least one crawl directive; `app-ads.txt` SHALL reference the Platform's authorized seller entries.
7. WHEN direct platform API access is approved for a platform, THE Platform SHALL migrate all active Pipelines from the Ayrshare routing path to the direct API path within 24 hours of receiving platform audit approval confirmation.

---

### Requirement 18: Security

**User Story:** As a User, I want the Platform to protect my credentials and data, so that my API keys and social accounts are not compromised.

#### Acceptance Criteria

1. THE Platform SHALL enforce RLS on all Supabase tables so that each User can only access rows belonging to their own account.
2. THE Backend_API SHALL validate all incoming requests with a valid session JWT before executing any authenticated operation; IF a request contains an invalid or expired JWT, THE Backend_API SHALL return HTTP 401 with the error code "unauthorized".
3. THE Credential_Vault SHALL store all API keys and OAuth tokens using Supabase Vault (AES-256 encryption at rest).
4. THE Platform SHALL never log, display, or transmit raw API key values after initial storage.
5. THE Pipeline_Engine SHALL retrieve User credentials from the Backend_API over HTTPS using an internal service token with a maximum lifetime of 15 minutes, regenerated per request.
6. THE Platform SHALL implement CSRF protection on all state-changing Dashboard form submissions; IF a CSRF token is missing or invalid on a state-changing request, THE Backend_API SHALL return HTTP 403 with the error code "csrf_token_invalid"; THE Platform SHALL NOT validate CSRF tokens on read-only requests such as viewing dashboards or fetching data; WHEN both JWT and CSRF validation fail simultaneously on a state-changing request, THE Backend_API SHALL return whichever error is detected first, allowing either HTTP 401 with error code "unauthorized" or HTTP 403 with error code "csrf_token_invalid" depending on validation order.
7. THE Platform SHALL set `Secure`, `HttpOnly`, and `SameSite=Strict` flags on all session cookies.
8. THE Backend_API SHALL sanitize all User-supplied inputs (niche keywords, pipeline names, script tone) before passing them to downstream APIs to prevent prompt injection and API abuse; IF a User-supplied input contains characters or patterns that match known prompt injection signatures (e.g., "ignore previous instructions"), THE Backend_API SHALL reject the request with HTTP 400 and error code "invalid_input".

---

### Requirement 19: Performance and Scalability

**User Story:** As a User, I want the Platform to be responsive and reliable, so that my Pipelines execute on time and the Dashboard is usable.

#### Acceptance Criteria

1. THE Dashboard SHALL load the main pipeline list view within 3 seconds on a standard broadband connection, where "standard broadband" means a connection of 10 Mbps or higher download speed.
2. THE Scheduler SHALL initiate Pipeline executions within 60 seconds of the configured trigger time.
3. THE Backend_API SHALL respond to authenticated Dashboard API requests within 500 milliseconds for 95% of requests under a load of up to 100 concurrent authenticated users.
4. WHILE a Pipeline execution is in progress, THE Platform SHALL NOT block other Users' Pipeline executions.
5. THE Platform SHALL support a minimum of 100 concurrent active Users with Dashboard API p95 response time remaining at or below 500ms.
6. WHEN the Pipeline_Engine receives a new execution request and 10 executions are already running concurrently, THE Pipeline_Engine SHALL queue the new request; THE queue SHALL hold a maximum of 50 pending execution requests.
7. IF the queue reaches its 50-request limit, THE Pipeline_Engine SHALL reject new execution requests with an error recorded in the Execution_Log as "execution queue full".

---

### Requirement 20: User Onboarding

**User Story:** As a new User, I want a clear onboarding flow that guides me through connecting my accounts and creating my first Pipeline, so that I can start using the Platform quickly.

#### Acceptance Criteria

1. THE Dashboard SHALL display a step-by-step onboarding checklist to new Users covering the following steps in order: (1) subscribe to a plan, (2) connect Google Drive, (3) add HeyGen API key, (4) connect at least one social platform, (5) create a Pipeline; steps MUST be completed in this sequence; IF a User has already completed a step before first accessing the Dashboard (e.g., subscribed prior to first login), THE Dashboard SHALL mark that step as complete based on the detected event (e.g., Stripe webhook).
2. THE Dashboard SHALL mark each onboarding step as complete once the corresponding action is detected: step 1 upon Stripe webhook confirming payment; step 2 upon Google OAuth callback success; step 3 upon HeyGen key saved to the Credential_Vault; step 4 upon any social platform OAuth callback success; step 5 upon first Pipeline saved; THE Platform SHALL only mark steps complete when the specified detection methods confirm the actions — completion through other means SHALL NOT mark a step as complete.
3. WHEN all onboarding steps are complete, THE Dashboard SHALL dismiss the checklist and display the main Pipeline management view; IF the main view fails to load due to a technical error, THE Dashboard SHALL keep attempting to display the main view and show an error message if it fails — the checklist SHALL NOT be restored.
4. THE Dashboard SHALL provide contextual help links to HeyGen API key documentation and social platform OAuth setup guides for each credential configuration step.
5. WHEN a User clicks "Skip setup", THE Platform SHALL hide the checklist for the remainder of the session and SHALL make it accessible again from the Dashboard help menu; the Platform SHALL continue tracking onboarding progress in the background even after the checklist is dismissed.

---

### Requirement 21: Account Management

**User Story:** As a User, I want to manage my account settings, so that I can update my information and preferences.

#### Acceptance Criteria

1. THE Platform SHALL allow Users to update their display name (1–50 characters) and email address from the account settings page.
2. WHEN a User updates their email address, THE Platform SHALL send a verification email to the new address; the email verification link SHALL expire after 24 hours; the email change SHALL NOT be applied until the new address is verified; THE Platform SHALL allow a pending email verification status to exist even when no email update is currently in progress.
3. THE Platform SHALL allow Users to change their password from the account settings page, requiring the current password for confirmation; the new password SHALL be at least 8 characters.
4. THE Platform SHALL allow Users to permanently delete their account, which SHALL trigger the data deletion process defined in Requirement 16, Acceptance Criterion 4; IF the data deletion process is temporarily unavailable or fails, THE Platform SHALL block account deletion until data deletion succeeds.
5. WHEN a User requests account deletion, THE Platform SHALL require the User to type their registered email address exactly before initiating deletion.
6. THE Platform SHALL allow Users to configure their notification preferences (as defined in Requirement 14, Acceptance Criterion 5) from the account settings page.
