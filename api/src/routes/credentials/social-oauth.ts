import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { storeSecret, deleteSecret, maskValue } from '../../lib/vault.js';

/**
 * Supported social platforms and their OAuth configuration.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

type SocialPlatform = 'youtube' | 'tiktok' | 'facebook' | 'instagram';

const VALID_SOCIAL_PLATFORMS = new Set<SocialPlatform>([
  'youtube',
  'tiktok',
  'facebook',
  'instagram',
]);

/**
 * Supabase OAuth provider name per platform.
 *
 * TikTok uses its own provider slug in Supabase.
 * Facebook and Instagram both use Meta's OAuth — they share the same
 * `facebook` provider but request different scopes.
 */
const PLATFORM_PROVIDER: Record<SocialPlatform, string> = {
  youtube: 'google',
  tiktok: 'tiktok',
  facebook: 'facebook',
  instagram: 'facebook', // Instagram uses Meta (Facebook) OAuth
};

/**
 * OAuth scopes per platform.
 * Requirements: 5.1–5.4
 */
const PLATFORM_SCOPES: Record<SocialPlatform, string> = {
  youtube: 'https://www.googleapis.com/auth/youtube.upload',
  tiktok: 'user.info.basic,video.upload,video.publish',
  facebook: 'pages_manage_posts,pages_read_engagement',
  instagram: 'instagram_content_publish',
};

/**
 * Credential types to store per platform.
 * Some platforms supply both access + refresh tokens; others only access tokens.
 *
 * Requirements: 5.5
 */
interface PlatformCredentials {
  accessTokenType: string;
  refreshTokenType?: string;
}

const PLATFORM_CREDENTIALS: Record<SocialPlatform, PlatformCredentials> = {
  youtube: {
    accessTokenType: 'youtube_access_token',
    refreshTokenType: 'youtube_refresh_token',
  },
  tiktok: {
    accessTokenType: 'tiktok_access_token',
    refreshTokenType: 'tiktok_refresh_token',
  },
  facebook: {
    accessTokenType: 'facebook_access_token',
    // Facebook long-lived tokens don't use a separate refresh token
  },
  instagram: {
    accessTokenType: 'instagram_access_token',
    // Instagram tokens are long-lived; no separate refresh
  },
};

/**
 * Validates that the :platform param is one of the supported social platforms.
 * Throws a 400 AppError if invalid.
 */
function validatePlatform(platform: string): SocialPlatform {
  if (!VALID_SOCIAL_PLATFORMS.has(platform as SocialPlatform)) {
    throw AppError.badRequest(
      `Invalid platform "${platform}". Must be one of: ${[...VALID_SOCIAL_PLATFORMS].join(', ')}`,
      { valid_platforms: [...VALID_SOCIAL_PLATFORMS] },
    );
  }
  return platform as SocialPlatform;
}

/**
 * Social platform OAuth public routes (no auth required).
 *
 * These routes handle the OAuth browser redirect flow where no session cookie
 * or Authorization header is present. They must be registered OUTSIDE the
 * authenticated preHandler scope in the parent credentials plugin.
 *
 * Routes:
 *   GET /social/:platform/connect   — redirect to OAuth consent screen
 *   GET /social/:platform/callback  — exchange code, store tokens, redirect to dashboard
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.11
 */
export async function socialOAuthPublicRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /social/:platform/connect ─────────────────────────────────────────
  //
  // Initiates the OAuth consent flow for the given social platform.
  // Redirects the user's browser to the platform's OAuth consent screen.
  //
  // Requirements: 5.1, 5.2, 5.3, 5.4
  app.get(
    '/social/:platform/connect',
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
      const { platform } = request.params as { platform: string };
      const socialPlatform = validatePlatform(platform);

      const redirectTo =
        process.env[`SOCIAL_OAUTH_REDIRECT_URL_${socialPlatform.toUpperCase()}`] ??
        process.env['SOCIAL_OAUTH_REDIRECT_URL'] ??
        `${process.env['API_BASE_URL'] ?? ''}/credentials/social/${socialPlatform}/callback`;

      if (!redirectTo) {
        throw new AppError(
          500,
          'configuration_error',
          `OAuth redirect URL for "${socialPlatform}" is not configured`,
        );
      }

      const supabase = createSupabaseAdminClient();
      const provider = PLATFORM_PROVIDER[socialPlatform];
      const scopes = PLATFORM_SCOPES[socialPlatform];

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider as Parameters<typeof supabase.auth.signInWithOAuth>[0]['provider'],
        options: {
          redirectTo,
          scopes,
          skipBrowserRedirect: true,
          queryParams: {
            // Force authorization code flow (PKCE) instead of implicit flow.
            // This ensures Google returns ?code= not #access_token= in the callback.
            access_type: 'offline',
            response_type: 'code',
            prompt: 'consent',
          },
        },
      });

      if (error || !data?.url) {
        request.log.error(
          { platform: socialPlatform, provider, err: error?.message },
          'Failed to initiate social OAuth flow',
        );
        throw new AppError(
          502,
          'oauth_initiation_failed',
          `Failed to initiate OAuth for "${socialPlatform}"`,
        );
      }

      return reply.status(302).redirect(data.url);
    },
  );

  // ── GET /social/:platform/callback ────────────────────────────────────────
  //
  // OAuth callback handler. Exchanges the authorization code for tokens,
  // stores them in Supabase Vault, and updates the credential metadata rows.
  //
  // On error or user denial: redirects to /settings/credentials with error query.
  // On success: redirects to /settings/credentials with social=connected query.
  //
  // Requirements: 5.5, 5.11
  app.get(
    '/social/:platform/callback',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: {
            platform: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { platform } = request.params as { platform: string };
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      const errorRedirectBase = '/settings/credentials';

      // Validate platform — on invalid platform redirect with error
      let socialPlatform: SocialPlatform;
      try {
        socialPlatform = validatePlatform(platform);
      } catch {
        return reply.status(302).redirect(
          `${errorRedirectBase}?error=social_oauth_failed&platform=${encodeURIComponent(platform)}`,
        );
      }

      const errorRedirect = `${errorRedirectBase}?error=social_oauth_failed&platform=${socialPlatform}`;

      // If OAuth provider returned an error or user denied access → redirect with error.
      // Previous connection status is retained unchanged (Req 5.11).
      if (query.error || !query.code) {
        request.log.info(
          { platform: socialPlatform, oauthError: query.error },
          'Social OAuth callback received error or missing code',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const supabase = createSupabaseAdminClient();

      // Exchange authorization code for session/tokens
      const { data: sessionData, error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(query.code);

      if (exchangeError || !sessionData?.session) {
        request.log.error(
          { platform: socialPlatform, err: exchangeError?.message },
          'Social OAuth code exchange failed',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const { session } = sessionData;
      const userId = session.user?.id ?? (sessionData as { user?: { id?: string } }).user?.id;

      if (!userId) {
        request.log.error(
          { platform: socialPlatform },
          'Could not determine user ID from OAuth session',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const accessToken = (session as unknown as Record<string, unknown>)['provider_token'] as string | null
        ?? session.access_token;
      const refreshToken = (session as unknown as Record<string, unknown>)['provider_refresh_token'] as string | null
        ?? null;

      const platformCredentials = PLATFORM_CREDENTIALS[socialPlatform];

      try {
        // Store access token in Vault
        await upsertVaultCredential(
          supabase,
          userId,
          platformCredentials.accessTokenType,
          accessToken,
        );

        // Store refresh token in Vault if this platform provides one
        if (platformCredentials.refreshTokenType && refreshToken) {
          await upsertVaultCredential(
            supabase,
            userId,
            platformCredentials.refreshTokenType,
            refreshToken,
          );
        }

        request.log.info(
          { platform: socialPlatform, userId },
          'Social platform tokens stored successfully',
        );
      } catch (err) {
        request.log.error(
          { platform: socialPlatform, userId, err: String(err) },
          'Failed to store social platform tokens in vault',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      // Redirect to settings page confirming successful connection (Req 5.11)
      return reply.status(302).redirect(
        `${errorRedirectBase}?social=connected&platform=${socialPlatform}`,
      );
    },
  );
}

/**
 * Social platform OAuth protected routes (JWT + CSRF required).
 *
 * These routes modify state and require authentication. They must be registered
 * INSIDE the authenticated preHandler scope in the parent credentials plugin.
 *
 * Routes:
 *   DELETE /social/:platform — disconnect platform, pause pipelines, delete tokens
 *
 * Requirements: 5.8
 */
export async function socialOAuthProtectedRoutes(app: FastifyInstance): Promise<void> {
  // ── DELETE /social/:platform ──────────────────────────────────────────────
  //
  // Disconnects a social platform:
  //  1. Validates platform
  //  2. Pauses all active pipelines targeting the platform
  //  3. Deletes Vault secrets + credentials rows for the platform's token types
  //
  // If token deletion fails after pipelines are already paused, disconnection
  // still completes (Req 5.8: "allow the disconnection to complete, leaving
  // the tokens in the vault").
  //
  // Requirements: 5.8
  app.delete(
    '/social/:platform',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: {
            platform: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      },
    },
    async (request, reply) => {
      const { platform } = request.params as { platform: string };
      const socialPlatform = validatePlatform(platform);
      const userId = request.user.id;

      const supabase = createSupabaseAdminClient();
      const platformCredentials = PLATFORM_CREDENTIALS[socialPlatform];

      // Collect credential types for this platform
      const credentialTypes = [platformCredentials.accessTokenType];
      if (platformCredentials.refreshTokenType) {
        credentialTypes.push(platformCredentials.refreshTokenType);
      }

      // Step 1: Pause active pipelines that target this social platform.
      //
      // Pipelines store their publishing destinations in `publishing_platforms`
      // (a text[] column). We pause any pipeline whose `publishing_platforms`
      // contains this platform AND is currently active or running.
      //
      // Requirements: 5.8
      const { data: pausedPipelines, error: pauseError } = await supabase
        .from('pipelines')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .contains('publishing_platforms', [socialPlatform])
        .in('status', ['active', 'running'])
        .select('id, name');

      if (pauseError) {
        // Log but do not abort — we still proceed with token deletion
        request.log.error(
          { platform: socialPlatform, userId, err: pauseError.message },
          'Failed to pause pipelines before platform disconnection',
        );
      } else if (pausedPipelines && pausedPipelines.length > 0) {
        request.log.info(
          { platform: socialPlatform, userId, pausedCount: pausedPipelines.length },
          'Paused pipelines targeting disconnected social platform',
        );
      }

      // Step 2: Delete Vault secrets and credential rows.
      // If deletion fails AFTER pipelines are already paused, we allow
      // disconnection to complete (Req 5.8).
      for (const credentialType of credentialTypes) {
        try {
          await deleteCredentialAndSecret(supabase, userId, credentialType, request.log);
        } catch (err) {
          // Non-fatal per Req 5.8: log but continue
          request.log.warn(
            { platform: socialPlatform, credentialType, userId, err: String(err) },
            'Failed to delete credential — disconnection continues',
          );
        }
      }

      request.log.info(
        { platform: socialPlatform, userId },
        'Social platform disconnected',
      );

      return reply.status(200).send({ message: 'Platform disconnected' });
    },
  );
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Upserts a credential in Vault + the `credentials` metadata table.
 *
 * Steps:
 *  1. Fetch any existing credential row to get the old vault_secret_id.
 *  2. Store the new token value in Vault (encrypted).
 *  3. Upsert the credentials row pointing to the new vault secret.
 *  4. Delete the old vault secret (if any) to avoid orphans.
 *
 * Raw token values are NEVER logged (Req 18.4).
 */
async function upsertVaultCredential(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  credentialType: string,
  tokenValue: string,
): Promise<void> {
  // Check for existing credential to clean up its old vault secret
  const { data: existing } = await supabase
    .from('credentials')
    .select('vault_secret_id')
    .eq('user_id', userId)
    .eq('credential_type', credentialType)
    .maybeSingle();

  const oldVaultSecretId = existing?.vault_secret_id as string | null | undefined;

  // Store new token in Vault
  const newVaultSecretId = await storeSecret(userId, credentialType, tokenValue);
  const maskedToken = maskValue(tokenValue);

  // Upsert credential metadata row
  const { error: upsertError } = await supabase
    .from('credentials')
    .upsert(
      {
        user_id: userId,
        credential_type: credentialType,
        masked_value: maskedToken,
        vault_secret_id: newVaultSecretId,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,credential_type' },
    );

  if (upsertError) {
    // Clean up orphaned vault secret
    try {
      await deleteSecret(newVaultSecretId);
    } catch {
      // Best-effort cleanup — not critical
    }
    throw new Error(
      `Failed to upsert credential row for "${credentialType}": ${upsertError.message}`,
    );
  }

  // Delete old vault secret now that the row points to the new one
  if (oldVaultSecretId) {
    try {
      await deleteSecret(oldVaultSecretId);
    } catch {
      // Orphaned secret is acceptable — do not fail the flow
    }
  }
}

/**
 * Deletes a credential's Vault secret and its `credentials` row.
 * Throws if the vault deletion fails; DB row deletion failure is logged but not thrown.
 */
async function deleteCredentialAndSecret(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  credentialType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<void> {
  const { data: credential, error: fetchError } = await supabase
    .from('credentials')
    .select('id, vault_secret_id')
    .eq('user_id', userId)
    .eq('credential_type', credentialType)
    .maybeSingle();

  if (fetchError) {
    logger.error(
      { userId, credentialType, err: fetchError.message },
      'Failed to fetch credential for deletion',
    );
    // Non-critical: credential might not exist for this platform
    return;
  }

  if (!credential) {
    // Credential doesn't exist — nothing to delete
    return;
  }

  const { id: credentialId, vault_secret_id: vaultSecretId } = credential as {
    id: string;
    vault_secret_id: string;
  };

  // Delete vault secret
  await deleteSecret(vaultSecretId);

  // Delete credentials metadata row
  const { error: deleteRowError } = await supabase
    .from('credentials')
    .delete()
    .eq('id', credentialId)
    .eq('user_id', userId);

  if (deleteRowError) {
    logger.error(
      { userId, credentialType, credentialId, err: deleteRowError.message },
      'Failed to delete credentials row after vault secret deletion',
    );
    // Not rethrown — partial deletion is acceptable for disconnection flow
  }
}
