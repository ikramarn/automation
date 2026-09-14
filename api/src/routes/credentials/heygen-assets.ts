import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { getDecryptedSecret } from '../../lib/vault.js';

/**
 * GET /credentials/heygen/avatars
 * GET /credentials/heygen/voices
 *
 * Proxies HeyGen's "list avatar looks" and "list voices" endpoints using the
 * authenticated user's own stored `heygen_api_key`. This lets the pipeline
 * creation wizard offer a real avatar/voice picker (with preview
 * image/video) instead of asking users to paste a raw HeyGen avatar_id /
 * voice_id they'd otherwise have to find manually in the HeyGen dashboard.
 *
 * The HeyGen API key is never returned to the browser — only the avatar/
 * voice metadata HeyGen returns (name, preview URLs, etc.) is proxied
 * through.
 *
 * HeyGen API reference:
 *   GET /v3/avatars/looks — https://developers.heygen.com/reference/list-avatar-looks
 *   GET /v3/voices        — https://developers.heygen.com/reference/list-voices
 *
 * Requirements: 6.1, 6.6 (HeyGen avatar/voice selection during pipeline creation)
 */
export async function heygenAssetsRoutes(app: FastifyInstance): Promise<void> {
  /** Fetch the current user's decrypted HeyGen API key, or throw a 400. */
  async function getUserHeyGenKey(userId: string): Promise<string> {
    const supabase = createSupabaseAdminClient();

    const { data: credential, error } = await supabase
      .from('credentials')
      .select('vault_secret_id')
      .eq('user_id', userId)
      .eq('credential_type', 'heygen_api_key')
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to look up HeyGen credential');
    }

    if (!credential) {
      throw AppError.badRequest(
        'No active HeyGen API key found. Add one in Settings → Credentials first.',
      );
    }

    const apiKey = await getDecryptedSecret(
      (credential as { vault_secret_id: string }).vault_secret_id,
    );

    if (!apiKey) {
      throw AppError.internal('Failed to decrypt HeyGen credential');
    }

    return apiKey;
  }

  // ── GET /heygen/avatars ───────────────────────────────────────────────────
  //
  // Lists avatar "looks" (the value to pass as avatar_id). Supports HeyGen's
  // own pagination via ?token=<next_token>. Returns both public (HeyGen
  // preset) and private (user-trained) avatars by default.
  app.get(
    '/heygen/avatars',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            group_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { token, group_id } = request.query as { token?: string; group_id?: string };

      const apiKey = await getUserHeyGenKey(userId);

      const url = new URL('https://api.heygen.com/v3/avatars/looks');
      url.searchParams.set('limit', '50');
      if (token) url.searchParams.set('token', token);
      if (group_id) url.searchParams.set('group_id', group_id);

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          headers: { 'x-api-key': apiKey },
        });
      } catch (err) {
        request.log.error({ userId, err }, '[heygen/avatars] Request to HeyGen failed');
        throw AppError.internal('Failed to reach HeyGen');
      }

      if (response.status === 401 || response.status === 403) {
        throw AppError.badRequest('HeyGen API key is invalid or credits exhausted');
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        request.log.error(
          { userId, status: response.status, body: bodyText },
          '[heygen/avatars] HeyGen returned an error',
        );
        throw AppError.internal('Failed to fetch avatars from HeyGen');
      }

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          avatar_type: string;
          group_id: string | null;
          gender: string | null;
          preview_image_url: string | null;
          preview_video_url: string | null;
          default_voice_id: string | null;
          supported_api_engines: string[];
        }>;
        has_more?: boolean;
        next_token?: string;
      };

      const avatars = (data.data ?? []).map((a) => ({
        avatar_id: a.id,
        name: a.name,
        avatar_type: a.avatar_type,
        group_id: a.group_id,
        gender: a.gender,
        preview_image_url: a.preview_image_url,
        preview_video_url: a.preview_video_url,
        default_voice_id: a.default_voice_id,
        supported_api_engines: a.supported_api_engines ?? [],
      }));

      return reply.status(200).send({
        avatars,
        has_more: data.has_more ?? false,
        next_token: data.next_token ?? null,
      });
    },
  );

  // ── GET /heygen/voices ────────────────────────────────────────────────────
  //
  // Lists available voices (the value to pass as voice_id). Optional
  // ?language= filter (e.g. "English") narrows results client-side, since
  // HeyGen's own language filter param names vary by API version.
  app.get(
    '/heygen/voices',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            language: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { token, language } = request.query as { token?: string; language?: string };

      const apiKey = await getUserHeyGenKey(userId);

      const url = new URL('https://api.heygen.com/v3/voices');
      url.searchParams.set('limit', '100');
      if (token) url.searchParams.set('token', token);

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          headers: { 'x-api-key': apiKey },
        });
      } catch (err) {
        request.log.error({ userId, err }, '[heygen/voices] Request to HeyGen failed');
        throw AppError.internal('Failed to reach HeyGen');
      }

      if (response.status === 401 || response.status === 403) {
        throw AppError.badRequest('HeyGen API key is invalid or credits exhausted');
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        request.log.error(
          { userId, status: response.status, body: bodyText },
          '[heygen/voices] HeyGen returned an error',
        );
        throw AppError.internal('Failed to fetch voices from HeyGen');
      }

      const data = (await response.json()) as {
        data?: Array<{
          voice_id: string;
          name: string;
          language: string | null;
          gender: string | null;
          type: string;
          preview_audio_url: string | null;
        }>;
        has_more?: boolean;
        next_token?: string;
      };

      let voices = (data.data ?? []).map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        language: v.language,
        gender: v.gender,
        type: v.type,
        preview_audio_url: v.preview_audio_url,
      }));

      if (language) {
        const needle = language.toLowerCase();
        voices = voices.filter((v) => (v.language ?? '').toLowerCase().includes(needle));
      }

      return reply.status(200).send({
        voices,
        has_more: data.has_more ?? false,
        next_token: data.next_token ?? null,
      });
    },
  );
}
