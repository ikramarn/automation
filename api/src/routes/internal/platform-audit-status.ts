import type { FastifyInstance } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/** Supported social platforms — mirrors the CHECK constraint on the table. */
const SUPPORTED_PLATFORMS = ['youtube', 'tiktok', 'facebook', 'instagram'] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

/** Response shape returned to Social_Publisher (n8n). */
interface PlatformAuditStatusResponse {
  audit_approved: boolean;
  user_preferences: {
    youtube_visibility?: 'public' | 'unlisted' | 'private';
    tiktok_privacy?: 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR';
  };
}

/**
 * GET /internal/platform-audit-status/:platform
 *
 * Called by Social_Publisher (n8n) at publish time to decide routing:
 *   - audit_approved = false → publish via Ayrshare
 *   - audit_approved = true  → publish via the platform's direct API
 *
 * Reads the operator-managed `platform_audit_status` table (no RLS —
 * intentionally not user-scoped; this is a platform-wide routing flag,
 * not a per-user setting).
 *
 * Fails safe: any lookup error, missing row, or unknown platform falls back
 * to `audit_approved: false` (Ayrshare) rather than 500ing the pipeline —
 * Social_Publisher already treats a failed lookup the same way, so this
 * keeps both call sites' worst case identical. This endpoint's OWN failure
 * mode is the safe default, not an error the caller has to handle specially.
 *
 * Service-token protected (no user JWT) — this is platform-wide operator
 * config, not per-user data.
 */
export async function platformAuditStatusRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { platform: string } }>(
    '/platform-audit-status/:platform',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: {
            platform: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { platform } = request.params;
      const normalized = platform.toLowerCase();

      if (!isSupportedPlatform(normalized)) {
        // Unknown platform — fail safe to Ayrshare rather than erroring the
        // pipeline over a platform we don't have routing config for.
        request.log.warn(
          { platform },
          '[internal/platform-audit-status] Unknown platform — defaulting to audit_approved=false',
        );
        return reply.status(200).send(buildResponse(false));
      }

      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('platform_audit_status')
        .select('audit_approved')
        .eq('platform', normalized)
        .maybeSingle();

      if (error) {
        request.log.error(
          { platform: normalized, err: error.message },
          '[internal/platform-audit-status] Lookup failed — defaulting to audit_approved=false',
        );
        // Fail safe (Ayrshare), not a 500 — a transient DB error must not
        // block the entire publish step when a safe fallback exists.
        return reply.status(200).send(buildResponse(false));
      }

      const auditApproved = (data as Record<string, unknown> | null)?.['audit_approved'] === true;

      request.log.info(
        { platform: normalized, auditApproved },
        '[internal/platform-audit-status] Resolved routing decision',
      );

      return reply.status(200).send(buildResponse(auditApproved));
    },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isSupportedPlatform(value: string): value is SupportedPlatform {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Builds the response body. `user_preferences` is intentionally empty for
 * now — per-user visibility/privacy preferences (youtube_visibility,
 * tiktok_privacy) are not yet a stored user setting anywhere in the schema.
 * Social_Publisher already defaults sensibly when these are absent
 * ('public' for YouTube, 'PUBLIC_TO_EVERYONE' for TikTok), so omitting them
 * here does not break the direct-API path — it just means "no preference
 * override yet," not an error.
 */
function buildResponse(auditApproved: boolean): PlatformAuditStatusResponse {
  return {
    audit_approved: auditApproved,
    user_preferences: {},
  };
}
