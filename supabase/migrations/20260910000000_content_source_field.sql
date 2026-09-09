-- ============================================================================
-- Migration: Add content_source and heygen_custom_script to pipelines table
--
-- content_source controls what generates the script:
--   openai        — AutoFlow fetches news → OpenAI writes script → HeyGen renders
--   agent         — HeyGen Video Agent handles everything from a prompt
--   custom_script — User provides the script directly → HeyGen renders it
--   drive         — User's own video from Google Drive (no generation)
--
-- heygen_custom_script — the verbatim script text for the custom_script path
-- ============================================================================

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS content_source TEXT NOT NULL DEFAULT 'openai'
    CHECK (content_source IN ('openai', 'agent', 'custom_script', 'drive')),

  ADD COLUMN IF NOT EXISTS heygen_custom_script TEXT;

COMMENT ON COLUMN public.pipelines.content_source IS 'Where the script/content comes from: openai (news+AI), agent (HeyGen prompt), custom_script (user-written), drive (own video)';
COMMENT ON COLUMN public.pipelines.heygen_custom_script IS 'Verbatim script text used when content_source=custom_script';

-- Update heygen_mode enum to also allow custom_script path
-- (heygen_mode stays as classic/agent — content_source is the new primary discriminator)
