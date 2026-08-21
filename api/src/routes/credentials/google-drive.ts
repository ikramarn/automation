import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { storeSecret, deleteSecret } from '../../lib/vault.js';

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

    if (!redirectTo) {
      throw new AppError(
        500,
        'configuration_error',
        'GOOGLE_DRIVE_REDIRECT_URL is not configured',
      );
    }

    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/drive.file',
        redirectTo,
        skipBrowserRedirect: true,
        // Request offline access so Google returns a refresh token
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error || !data?.url) {
      throw new AppError(
        502,
        'drive_oauth_initiation_failed',
        'Failed to initiate Google Drive OAuth',
      );
    }

    return reply.status(302).redirect(data.url);
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

      const supabase = createSupabaseAdminClient();

      // Exchange the authorization code for a session containing provider tokens
      const { data: sessionData, error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(query.code);

      if (exchangeError || !sessionData?.session) {
        request.log.warn(
          { err: exchangeError?.message },
          'Google Drive OAuth code exchange failed',
        );
        return reply.status(302).redirect(errorRedirect);
      }

      const { session, user } = sessionData;
      const userId = user?.id ?? session.user?.id;

      if (!userId) {
        request.log.warn('Google Drive OAuth callback: could not determine user id from session');
        return reply.status(302).redirect(errorRedirect);
      }

      // provider_refresh_token is the Google Drive refresh token (Req 4.2)
      const refreshToken = (session as unknown as Record<string, unknown>)[
        'provider_refresh_token'
      ] as string | null | undefined;

      if (!refreshToken) {
        request.log.warn(
          { userId },
          'Google Drive OAuth callback: no provider_refresh_token in session',
        );
        return reply.status(302).redirect(errorRedirect);
      }

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
