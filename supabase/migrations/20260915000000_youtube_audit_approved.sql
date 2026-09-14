-- =============================================================================
-- Set audit_approved = true for the youtube row in platform_audit_status.
--
-- Context: Social_Publisher (n8n) routes publish requests through Ayrshare
-- when audit_approved = false, or through the platform's direct API when
-- true. The user has confirmed they are not using Ayrshare, only publish to
-- YouTube, and are fine with videos landing as private (Google's own API
-- forces private visibility on any video uploaded from a Google Cloud
-- project that has not passed YouTube's API compliance audit — this flag
-- does not affect or substitute for that separate Google-side audit).
--
-- Setting this row to true switches YouTube publishing to the direct
-- YouTube Data API v3 path instead of Ayrshare, matching the user's actual
-- setup (no Ayrshare account/API key configured).
--
-- tiktok / facebook / instagram are intentionally left at their seeded
-- default (false) — the user is not using those platforms.
-- =============================================================================

UPDATE public.platform_audit_status
SET audit_approved = TRUE,
    direct_api_enabled_at = NOW()
WHERE platform = 'youtube';
