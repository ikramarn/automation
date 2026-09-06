-- ============================================================================
-- Migration: Add HeyGen v3 API fields to pipelines table
-- 
-- New fields support:
--   heygen_mode         — 'classic' (avatar+script) or 'agent' (prompt-to-video)
--   heygen_engine       — Avatar III / IV / V rendering engine
--   heygen_voice_id     — Optional HeyGen voice ID override
--   heygen_resolution   — Output resolution
--   heygen_aspect_ratio — Output aspect ratio
--   heygen_motion_prompt — Natural-language body motion hint (Avatar V / photo)
--   heygen_agent_prompt  — Full prompt for Video Agent mode
--   heygen_orientation   — Portrait / landscape (Video Agent only)
-- ============================================================================

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS heygen_mode          TEXT    NOT NULL DEFAULT 'classic'
    CHECK (heygen_mode IN ('classic', 'agent')),

  ADD COLUMN IF NOT EXISTS heygen_engine        TEXT    NOT NULL DEFAULT 'avatar_iv'
    CHECK (heygen_engine IN ('avatar_v', 'avatar_iv', 'avatar_iii')),

  ADD COLUMN IF NOT EXISTS heygen_voice_id      TEXT,

  ADD COLUMN IF NOT EXISTS heygen_resolution    TEXT    NOT NULL DEFAULT '1080p'
    CHECK (heygen_resolution IN ('1080p', '720p', '4k')),

  ADD COLUMN IF NOT EXISTS heygen_aspect_ratio  TEXT    NOT NULL DEFAULT '9:16'
    CHECK (heygen_aspect_ratio IN ('9:16', '16:9', '1:1', '4:5', '5:4', 'auto')),

  ADD COLUMN IF NOT EXISTS heygen_motion_prompt TEXT,

  ADD COLUMN IF NOT EXISTS heygen_agent_prompt  TEXT,

  ADD COLUMN IF NOT EXISTS heygen_orientation   TEXT    NOT NULL DEFAULT 'portrait'
    CHECK (heygen_orientation IN ('portrait', 'landscape'));

COMMENT ON COLUMN public.pipelines.heygen_mode          IS 'classic = avatar+script via POST /v3/videos; agent = prompt-to-video via POST /v3/video-agents';
COMMENT ON COLUMN public.pipelines.heygen_engine        IS 'Avatar rendering engine: avatar_v (highest quality), avatar_iv (default), avatar_iii (fast/cheap)';
COMMENT ON COLUMN public.pipelines.heygen_voice_id      IS 'Optional HeyGen voice ID; null = use avatar default voice';
COMMENT ON COLUMN public.pipelines.heygen_resolution    IS 'Output video resolution';
COMMENT ON COLUMN public.pipelines.heygen_aspect_ratio  IS 'Output aspect ratio; 9:16 default for social/portrait';
COMMENT ON COLUMN public.pipelines.heygen_motion_prompt IS 'Natural-language hint for avatar body motion and gestures (Avatar V and photo avatars)';
COMMENT ON COLUMN public.pipelines.heygen_agent_prompt  IS 'Full prompt for Video Agent mode; auto-built from niche/article if blank';
COMMENT ON COLUMN public.pipelines.heygen_orientation   IS 'portrait or landscape for Video Agent mode';
