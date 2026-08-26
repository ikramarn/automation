import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { storeSecret, deleteSecret } from '../../lib/vault.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Google Drive OAuth credential routes.
 *
 * Exports two separate route registrar functions so the parent credentials
 * plugin can register them in the correct auth scope:
 *
 *   googleDrivePublicRoutes  — GET /google/connect + GET /google/callback
 *                              PUBLIC — no JWT required (OAuth redirect flow)
 *
 *   googleDriveProtectedRoutes — DELETE /google
 *                              PROTECTED — inherits authenticate + csrfProtect
 *                              hooks from the parent credentialRoutes plugin
 *
 * Full paths (after the /credentials prefix):
 *   GET    /credentials/google/connect   — Initiate Google Drive OAuth (drive.file scope)
 *   GET    /credentials/google/callback  — Handle callback, store refresh token in Vault
 *   DELETE /credentials/google           — Disconnect Drive, delete vault secret + DB row
 *
 * Requirements: 4.1, 4.2, 4.4, 4.7, 4.8
 */

// ── Public routes (no auth) ──────────────────────────────────────────────────

/**
 * Registers the two public Google Drive OAuth routes.
 * Must be registered OUTSIDE the authenticated preHandler scope.
 *
 * Requirements: 4.1, 4.2, 4.7, 4.8
 */
export async function googleDrivePublicRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /google/connect ──────────────────────────────────────────────────
  //
  // Initiates the Google OAuth 2.0 flow requesting only the `drive.file` scope.
  // Redirects the browser to Google's consent screen (302).
  //
  // Requirements: 4.1
  app.get('/google/connect', async (_request, reply) => {
    const redirectTo = process.env['GOOGLE_DRIVE_REDIRECT_URL'];
    const clientId = process.env['GOOGLE_CLIENT_ID'];

    if (!redirectTo) {
      throw new AppError(
        500,
        'configuration_error',
        'GOOGLE_DRIVE_REDIRECT_URL is not configured',
      );
    }

    if (!clientId) {
      throw new AppError(500, 'configuration_error', 'GOOGLE_CLIENT_ID is not configured');
    }

    // Build direct Google OAuth URL (same pattern as social-oauth.ts).
    // Supabase's signInWithOAuth returns an implicit flow (#access_token=) which
    // cannot be handled server-side. Direct OAuth returns ?code= for server exchange.
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectTo);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', `openid email profile ${DRIVE_SCOPE}`);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    return reply.status(302).redirect(authUrl.toString());
  });

  // ── GET /google/callback ─────────────────────────────────────────────────
  //
  // Called by Google after the user grants (or denies) authorization.
  //
  // On success:
  //  1. Exchange authorization code for a Supabase session (contains provider tokens).
  //  2. Extract provider_refresh_token (Google Drive refresh token).
  //  3. Store refresh token in Supabase Vault (encrypted at rest).
  //  4. Upsert `credentials` row: masked_value = '••••[connected]', status = 'active'.
  //  5. Redirect to /settings/credentials?drive=connected
  //
  // On any error (user denial, exchange failure, missing refresh token):
  //  - Redirect to /settings/credentials?error=drive_oauth_failed
  //  - Previously connected Drive status is NOT changed (Req 4.7).
  //
  // Requirements: 4.2, 4.7, 4.8
  app.get(
    '/google/callback',
    {
      schema: {
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
      const errorRedirect = '/settings/credentials?error=drive_oauth_failed';
      const successRedirect = '/settings/credentials?drive=connected';

      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      // If Google returned an error or the user denied authorization (Req 4.7)
      if (query.error || !query.code) {
        return reply.status(302).redirect(errorRedirect);
      }

      const redirectTo = process.env['GOOGLE_DRIVE_REDIRECT_URL'] ?? '';

      // Exchange authorization code directly with Google's token endpoint.
      // This reliably returns a refresh token unlike the Supabase-mediated flow.
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
          client_secret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
          redirect_uri: redirectTo,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const tokenErr = await tokenRes.text().catch(() => 'unknown error');
        request.log.error(
          { status: tokenRes.status, err: tokenErr },
          'Google Drive OAuth token exchange failed',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const tokenData = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };

      if (tokenData.error || !tokenData.access_token) {
        request.log.error(
          { err: tokenData.error },
          'Google Drive token exchange returned error',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const refreshToken = tokenData.refresh_token ?? null;

      if (!refreshToken) {
        request.log.warn('Google Drive OAuth callback: no refresh_token in token response');
        return reply.status(302).redirect(errorRedirect);
      }

      // Get user info from Google to identify the Supabase user
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userInfoRes.ok) {
        request.log.error('Google Drive OAuth: failed to get user info from Google');
        return reply.status(302).redirect(errorRedirect);
      }

      const googleUser = await userInfoRes.json() as { email?: string };

      // Match Google email to Supabase user
      const supabase = createSupabaseAdminClient();
      const { data: userList } = await supabase.auth.admin.listUsers();
      const matchedUser = userList?.users?.find((u) => u.email === googleUser.email);

      if (!matchedUser?.id) {
        request.log.error(
          { email: googleUser.email },
          'Google Drive OAuth: could not match Google user to Supabase user',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const userId = matchedUser.id;
      const credentialType = 'google_drive_refresh_token';

      try {
        // Check for existing credential to clean up old vault secret on reconnect
        const { data: existing } = await supabase
          .from('credentials')
          .select('vault_secret_id')
          .eq('user_id', userId)
          .eq('credential_type', credentialType)
          .maybeSingle();

        const oldVaultSecretId = (existing as { vault_secret_id?: string } | null)
          ?.vault_secret_id;

        // Store the refresh token in Vault — raw token NEVER logged (Req 3.6, 18.4)
        const vaultSecretId = await storeSecret(userId, credentialType, refreshToken);

        // Upsert the credentials metadata row (Req 4.2, 4.8)
        const { error: upsertError } = await supabase.from('credentials').upsert(
          {
            user_id: userId,
            credential_type: credentialType,
            masked_value: '••••[connected]',
            vault_secret_id: vaultSecretId,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,credential_type' },
        );

        if (upsertError) {
          // Clean up orphaned vault secret on DB failure
          try {
            await deleteSecret(vaultSecretId);
          } catch {
            request.log.error(
              { vaultSecretId },
              'Failed to clean up vault secret after DB upsert failure',
            );
          }
          request.log.error(
            { userId, err: upsertError.message },
            'Failed to upsert Google Drive credential row',
          );
          return reply.status(302).redirect(errorRedirect);
        }

        // Clean up old vault secret now that the row points to the new one
        if (oldVaultSecretId) {
          try {
            await deleteSecret(oldVaultSecretId);
          } catch {
            request.log.warn(
              { oldVaultSecretId },
              'Failed to delete old Google Drive vault secret after reconnect',
            );
          }
        }

        request.log.info({ userId }, 'Google Drive connected successfully');
        return reply.status(302).redirect(successRedirect);
      } catch (err) {
        request.log.error(
          { userId, err: String(err) },
          'Unexpected error in Google Drive OAuth callback',
        );
        return reply.status(302).redirect(errorRedirect);
      }
    },
  );
}

// ── Protected routes (auth required) ────────────────────────────────────────

/**
 * Registers the DELETE /google route.
 * Must be registered INSIDE the authenticated scope so it inherits the
 * `authenticate` + `csrfProtect` preHandler hooks from the parent plugin.
 *
 * Requirements: 4.4
 */
export async function googleDriveProtectedRoutes(app: FastifyInstance): Promise<void> {
  // ── DELETE /google ─────────────────────────────────────────────────────
  //
  // Disconnects Google Drive: deletes the refresh token from Vault and removes
  // the credentials row. The Drive connection status transitions to "disconnected"
  // only through this explicit user-initiated action — never automatically
  // (Req 4.4: "the Drive connection status SHALL only be set to 'disconnected'
  // through explicit User-initiated disconnection").
  //
  // Requirements: 4.4
  app.delete(
    '/google',
    {
      schema: {
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
      const userId = request.user.id;
      const credentialType = 'google_drive_refresh_token';

      const supabase = createSupabaseAdminClient();

      // Find the credential for this user
      const { data: credential, error: fetchError } = await supabase
        .from('credentials')
        .select('id, vault_secret_id')
        .eq('user_id', userId)
        .eq('credential_type', credentialType)
        .maybeSingle();

      if (fetchError) {
        request.log.error(
          { userId, err: fetchError.message },
          'Failed to fetch Google Drive credential for deletion',
        );
        throw AppError.internal('Failed to retrieve Google Drive credential');
      }

      if (!credential) {
        throw AppError.notFound('Google Drive credential');
      }

      const { id: credentialId, vault_secret_id: vaultSecretId } = credential as {
        id: string;
        vault_secret_id: string;
      };

      // Delete vault secret (Req 4.4)
      try {
        await deleteSecret(vaultSecretId);
      } catch (err) {
        request.log.error(
          { userId, vaultSecretId, err: String(err) },
          'Failed to delete Google Drive vault secret',
        );
        throw AppError.internal('Failed to delete Google Drive credential secret');
      }

      // Delete the credentials metadata row
      const { error: deleteError } = await supabase
        .from('credentials')
        .delete()
        .eq('id', credentialId)
        .eq('user_id', userId); // Belt-and-suspenders: enforce user ownership

      if (deleteError) {
        request.log.error(
          { userId, credentialId, err: deleteError.message },
          'Failed to delete Google Drive credential row after vault secret deletion',
        );
        throw AppError.internal('Failed to delete Google Drive credential record');
      }

      request.log.info({ userId }, 'Google Drive disconnected successfully');

      return reply.status(200).send({ message: 'Google Drive disconnected' });
    },
  );
}
