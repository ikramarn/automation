import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { storeSecret, deleteSecret, maskValue } from '../../lib/vault.js';

/**
 * Social platform OAuth routes.
 *
 * Supports YouTube (Google), TikTok, Facebook, and Instagram with correct
 * platform-specific OAuth 2.0 flows.
 *
 * Architecture:
 *   - Each platform has its own OAuth authorization URL and token endpoint.
 *   - User identity is established by encoding the Supabase user ID in the
 *     OAuth `state` parameter (signed with HMAC-SHA256 using COOKIE_SECRET)
 *     so the callback can identify who to store credentials for, without
 *     relying on the provider's identity (which only works for Google).
 *   - The connect link includes a short-lived JWT (?token=) from the frontend
 *     so the connect endpoint can verify the caller and encode their user ID.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.11
 */

// ── Platform types and config ────────────────────────────────────────────────

type SocialPlatform = 'youtube' | 'tiktok' | 'facebook' | 'instagram';

const VALID_SOCIAL_PLATFORMS = new Set<SocialPlatform>([
  'youtube',
  'tiktok',
  'facebook',
  'instagram',
]);

/** OAuth scopes requested per platform. */
const PLATFORM_SCOPES: Record<SocialPlatform, string> = {
  youtube: 'https://www.googleapis.com/auth/youtube.upload',
  tiktok: 'user.info.basic,video.upload,video.publish',
  facebook: 'pages_manage_posts,pages_read_engagement,pages_show_list',
  instagram: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
};

/** Credential types stored per platform. */
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
  },
  instagram: {
    accessTokenType: 'instagram_access_token',
  },
};

// ── State token helpers ──────────────────────────────────────────────────────

/**
 * Signs a state payload as `<payload>.<hmac>` using COOKIE_SECRET.
 * This prevents CSRF and allows the callback to trust the embedded user ID.
 */
function signState(payload: string): string {
  const secret = process.env['COOKIE_SECRET'] ?? 'fallback-secret';
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

/**
 * Verifies and extracts the payload from a signed state token.
 * Returns null if the signature is invalid or state is malformed.
 */
function verifyState(state: string): string | null {
  const lastDot = state.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = state.substring(0, lastDot);
  const expectedSig = crypto
    .createHmac('sha256', process.env['COOKIE_SECRET'] ?? 'fallback-secret')
    .update(payload)
    .digest('hex');
  const actualSig = state.substring(lastDot + 1);
  if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(actualSig, 'hex'))) {
    return null;
  }
  return payload;
}

/**
 * Encodes `{ userId, platform }` into a signed state string.
 */
function encodeState(userId: string, platform: SocialPlatform): string {
  const payload = `${userId}:${platform}`;
  return signState(payload);
}

/**
 * Decodes and verifies a state string, returning `{ userId, platform }` or null.
 */
function decodeState(state: string): { userId: string; platform: SocialPlatform } | null {
  const payload = verifyState(state);
  if (!payload) return null;
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) return null;
  const userId = payload.substring(0, colonIdx);
  const platform = payload.substring(colonIdx + 1) as SocialPlatform;
  if (!VALID_SOCIAL_PLATFORMS.has(platform)) return null;
  return { userId, platform };
}

// ── Platform-specific OAuth builders ────────────────────────────────────────

/** Builds the Google (YouTube) authorization URL. */
function buildGoogleAuthUrl(redirectTo: string, scopes: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env['GOOGLE_CLIENT_ID'] ?? '');
  url.searchParams.set('redirect_uri', redirectTo);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email profile ${scopes}`);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Builds the TikTok v2 authorization URL. */
function buildTikTokAuthUrl(redirectTo: string, scopes: string, state: string): string {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', process.env['TIKTOK_CLIENT_KEY'] ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', redirectTo);
  url.searchParams.set('state', state);
  return url.toString();
}

/** Builds the Meta (Facebook/Instagram) authorization URL. */
function buildMetaAuthUrl(redirectTo: string, scopes: string, state: string): string {
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', process.env['FACEBOOK_APP_ID'] ?? '');
  url.searchParams.set('redirect_uri', redirectTo);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);
  return url.toString();
}

// ── Platform-specific token exchange ────────────────────────────────────────

interface TokenResult {
  accessToken: string;
  refreshToken: string | null;
}

/** Exchanges a Google authorization code for tokens. */
async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResult> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
      client_secret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`Google token exchange failed: ${res.status} ${err}`);
  }
  const data = await res.json() as { access_token?: string; refresh_token?: string; error?: string };
  if (data.error || !data.access_token) {
    throw new Error(`Google token exchange error: ${data.error ?? 'missing access_token'}`);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
}

/** Exchanges a TikTok authorization code for tokens. */
async function exchangeTikTokCode(code: string, redirectUri: string): Promise<TokenResult> {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env['TIKTOK_CLIENT_KEY'] ?? '',
      client_secret: process.env['TIKTOK_CLIENT_SECRET'] ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`TikTok token exchange failed: ${res.status} ${err}`);
  }
  const data = await res.json() as {
    data?: { access_token?: string; refresh_token?: string };
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  // TikTok v2 wraps response in data{}
  const accessToken = data?.data?.access_token ?? data?.access_token;
  const refreshToken = data?.data?.refresh_token ?? data?.refresh_token ?? null;
  if (!accessToken) {
    throw new Error(`TikTok token exchange error: ${data.error ?? 'missing access_token'}`);
  }
  return { accessToken, refreshToken };
}

/** Exchanges a Meta (Facebook/Instagram) authorization code for tokens. */
async function exchangeMetaCode(code: string, redirectUri: string): Promise<TokenResult> {
  const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env['FACEBOOK_APP_ID'] ?? '',
      client_secret: process.env['FACEBOOK_APP_SECRET'] ?? '',
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`Meta token exchange failed: ${res.status} ${err}`);
  }
  const data = await res.json() as {
    access_token?: string;
    error?: { message?: string };
  };
  if (data.error || !data.access_token) {
    throw new Error(`Meta token exchange error: ${data.error?.message ?? 'missing access_token'}`);
  }

  // Exchange short-lived token for a long-lived token (60 days)
  const llRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env['FACEBOOK_APP_ID'] ?? '',
      client_secret: process.env['FACEBOOK_APP_SECRET'] ?? '',
      fb_exchange_token: data.access_token,
    }).toString(),
  );
  if (llRes.ok) {
    const llData = await llRes.json() as { access_token?: string };
    if (llData.access_token) {
      return { accessToken: llData.access_token, refreshToken: null };
    }
  }

  // Fall back to short-lived token if exchange fails
  return { accessToken: data.access_token, refreshToken: null };
}

// ── Validators ───────────────────────────────────────────────────────────────

function validatePlatform(platform: string): SocialPlatform {
  if (!VALID_SOCIAL_PLATFORMS.has(platform as SocialPlatform)) {
    throw AppError.badRequest(
      `Invalid platform "${platform}". Must be one of: ${[...VALID_SOCIAL_PLATFORMS].join(', ')}`,
      { valid_platforms: [...VALID_SOCIAL_PLATFORMS] },
    );
  }
  return platform as SocialPlatform;
}

// ── Public routes ────────────────────────────────────────────────────────────

/**
 * Social platform OAuth public routes (no auth required on these routes,
 * because the browser arrives via OAuth redirect with no session).
 *
 * Routes:
 *   GET /social/:platform/connect   — redirect to platform OAuth consent screen
 *   GET /social/:platform/callback  — exchange code, store tokens, redirect to dashboard
 *
 * The connect endpoint requires a ?token= query param (the user's Supabase JWT)
 * so it can identify the user and encode their ID in the OAuth state.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.11
 */
export async function socialOAuthPublicRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /social/:platform/connect ─────────────────────────────────────────
  app.get(
    '/social/:platform/connect',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: { platform: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          properties: { token: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { platform } = request.params as { platform: string };
      const { token } = request.query as { token?: string };

      const socialPlatform = validatePlatform(platform);

      // Verify the JWT and extract user ID so we can embed it in state
      if (!token) {
        throw new AppError(401, 'unauthorized', 'Missing token query parameter');
      }

      let userId: string;
      try {
        const decoded = app.jwt.verify<{ sub: string }>(token);
        userId = decoded.sub;
      } catch {
        throw new AppError(401, 'unauthorized', 'Invalid or expired token');
      }

      const redirectTo =
        process.env[`SOCIAL_OAUTH_REDIRECT_URL_${socialPlatform.toUpperCase()}`] ??
        `${process.env['API_URL'] ?? ''}/credentials/social/${socialPlatform}/callback`;

      if (!redirectTo) {
        throw new AppError(500, 'configuration_error', `OAuth redirect URL for "${socialPlatform}" is not configured`);
      }

      // Encode user ID + platform into a signed state parameter
      const state = encodeState(userId, socialPlatform);
      const scopes = PLATFORM_SCOPES[socialPlatform];

      let authUrl: string;
      switch (socialPlatform) {
        case 'youtube':
          if (!process.env['GOOGLE_CLIENT_ID']) {
            throw new AppError(500, 'configuration_error', 'GOOGLE_CLIENT_ID is not configured');
          }
          authUrl = buildGoogleAuthUrl(redirectTo, scopes, state);
          break;

        case 'tiktok':
          if (!process.env['TIKTOK_CLIENT_KEY']) {
            throw new AppError(500, 'configuration_error', 'TIKTOK_CLIENT_KEY is not configured');
          }
          authUrl = buildTikTokAuthUrl(redirectTo, scopes, state);
          break;

        case 'facebook':
        case 'instagram':
          if (!process.env['FACEBOOK_APP_ID']) {
            throw new AppError(500, 'configuration_error', 'FACEBOOK_APP_ID is not configured');
          }
          authUrl = buildMetaAuthUrl(redirectTo, scopes, state);
          break;
      }

      return reply.status(302).redirect(authUrl);
    },
  );

  // ── GET /social/:platform/callback ────────────────────────────────────────
  app.get(
    '/social/:platform/callback',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: { platform: { type: 'string' } },
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

      let socialPlatform: SocialPlatform;
      try {
        socialPlatform = validatePlatform(platform);
      } catch {
        return reply.status(302).redirect(
          `${errorRedirectBase}?error=social_oauth_failed&platform=${encodeURIComponent(platform)}`,
        );
      }

      const errorRedirect = `${errorRedirectBase}?error=social_oauth_failed&platform=${socialPlatform}`;

      // OAuth provider returned an error or user denied access
      if (query.error || !query.code) {
        request.log.info(
          { platform: socialPlatform, oauthError: query.error },
          'Social OAuth callback received error or missing code',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      // Verify and decode the signed state to get the user ID
      if (!query.state) {
        request.log.warn({ platform: socialPlatform }, 'Social OAuth callback: missing state');
        return reply.status(302).redirect(errorRedirect);
      }

      const stateData = decodeState(query.state);
      if (!stateData) {
        request.log.warn({ platform: socialPlatform }, 'Social OAuth callback: invalid state signature');
        return reply.status(302).redirect(errorRedirect);
      }

      const { userId } = stateData;

      const redirectUri =
        process.env[`SOCIAL_OAUTH_REDIRECT_URL_${socialPlatform.toUpperCase()}`] ??
        `${process.env['API_URL'] ?? ''}/credentials/social/${socialPlatform}/callback`;

      // Exchange the authorization code for tokens using the platform-specific endpoint
      let tokens: TokenResult;
      try {
        switch (socialPlatform) {
          case 'youtube':
            tokens = await exchangeGoogleCode(query.code, redirectUri);
            break;
          case 'tiktok':
            tokens = await exchangeTikTokCode(query.code, redirectUri);
            break;
          case 'facebook':
          case 'instagram':
            tokens = await exchangeMetaCode(query.code, redirectUri);
            break;
        }
      } catch (err) {
        request.log.error(
          { platform: socialPlatform, userId, err: String(err) },
          'Social OAuth token exchange failed',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const platformCredentials = PLATFORM_CREDENTIALS[socialPlatform];
      const supabase = createSupabaseAdminClient();

      try {
        // Store access token
        await upsertVaultCredential(
          supabase,
          userId,
          platformCredentials.accessTokenType,
          tokens.accessToken,
        );

        // Store refresh token if platform provides one
        if (platformCredentials.refreshTokenType && tokens.refreshToken) {
          await upsertVaultCredential(
            supabase,
            userId,
            platformCredentials.refreshTokenType,
            tokens.refreshToken,
          );
        }

        request.log.info({ platform: socialPlatform, userId }, 'Social platform tokens stored successfully');
      } catch (err) {
        request.log.error(
          { platform: socialPlatform, userId, err: String(err) },
          'Failed to store social platform tokens in vault',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      return reply.status(302).redirect(
        `${errorRedirectBase}?social=connected&platform=${socialPlatform}`,
      );
    },
  );
}

// ── Protected routes ─────────────────────────────────────────────────────────

/**
 * Social platform OAuth protected routes (JWT + CSRF required).
 *
 * Routes:
 *   DELETE /social/:platform — disconnect platform, pause pipelines, delete tokens
 *
 * Requirements: 5.8
 */
export async function socialOAuthProtectedRoutes(app: FastifyInstance): Promise<void> {
  app.delete(
    '/social/:platform',
    {
      schema: {
        params: {
          type: 'object',
          required: ['platform'],
          properties: { platform: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
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

      const credentialTypes = [platformCredentials.accessTokenType];
      if (platformCredentials.refreshTokenType) {
        credentialTypes.push(platformCredentials.refreshTokenType);
      }

      // Pause active pipelines targeting this platform (Req 5.8)
      const { data: pausedPipelines, error: pauseError } = await supabase
        .from('pipelines')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .contains('publishing_platforms', [socialPlatform])
        .in('status', ['active', 'running'])
        .select('id, name');

      if (pauseError) {
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

      // Delete vault secrets and credential rows
      for (const credentialType of credentialTypes) {
        try {
          await deleteCredentialAndSecret(supabase, userId, credentialType, request.log);
        } catch (err) {
          // Non-fatal per Req 5.8
          request.log.warn(
            { platform: socialPlatform, credentialType, userId, err: String(err) },
            'Failed to delete credential — disconnection continues',
          );
        }
      }

      request.log.info({ platform: socialPlatform, userId }, 'Social platform disconnected');

      return reply.status(200).send({ message: 'Platform disconnected' });
    },
  );
}

// ── Private helpers ──────────────────────────────────────────────────────────

async function upsertVaultCredential(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  credentialType: string,
  tokenValue: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('credentials')
    .select('vault_secret_id')
    .eq('user_id', userId)
    .eq('credential_type', credentialType)
    .maybeSingle();

  const oldVaultSecretId = existing?.vault_secret_id as string | null | undefined;

  const newVaultSecretId = await storeSecret(userId, credentialType, tokenValue);
  const maskedToken = maskValue(tokenValue);

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
    try {
      await deleteSecret(newVaultSecretId);
    } catch { /* best-effort */ }
    throw new Error(`Failed to upsert credential row for "${credentialType}": ${upsertError.message}`);
  }

  if (oldVaultSecretId) {
    try {
      await deleteSecret(oldVaultSecretId);
    } catch { /* orphaned secret is acceptable */ }
  }
}

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
    logger.error({ userId, credentialType, err: fetchError.message }, 'Failed to fetch credential for deletion');
    return;
  }

  if (!credential) return;

  const { id: credentialId, vault_secret_id: vaultSecretId } = credential as {
    id: string;
    vault_secret_id: string;
  };

  await deleteSecret(vaultSecretId);

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
  }
}
