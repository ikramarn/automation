import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { storeSecret, deleteSecret, maskValue } from '../../lib/vault.js';

/**
 * All credential types that can be managed through the API.
 * Sourced from the Credential Vault design (design.md § Credential Types).
 *
 * Requirements: 3.1, 3.2, 3.3
 */
export const VALID_CREDENTIAL_TYPES = new Set([
  'heygen_api_key',
  'openai_api_key',
  'google_drive_refresh_token',
  'youtube_access_token',
  'youtube_refresh_token',
  'tiktok_access_token',
  'tiktok_refresh_token',
  'facebook_access_token',
  'instagram_access_token',
]);

/**
 * PUT /credentials/:type
 *
 * Stores or updates an API key / token credential for the authenticated user.
 *
 * Flow:
 *  1. Validate :type is an allowed credential type → 400 if not.
 *  2. Validate body.value is 1–2048 chars.
 *  3. Check for an existing credential row (to clean up the old vault secret).
 *  4. Store the new raw value in Supabase Vault (encrypted at rest).
 *  5. Compute the masked value `"••••" + value.slice(-4)`.
 *  6. Upsert the `credentials` metadata row.
 *  7. If a previous vault secret existed, delete it now that the row points to the new one.
 *  8. Return { credential_type, masked_value, status } — raw value NEVER returned.
 *
 * The raw API key / token is NEVER logged at any point.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 18.4
 */
export async function upsertCredentialRoute(app: FastifyInstance): Promise<void> {
  app.put(
    '/:type',
    {
      schema: {
        params: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['value'],
          additionalProperties: false,
          properties: {
            value: { type: 'string', minLength: 1, maxLength: 2048 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              credential_type: { type: 'string' },
              masked_value: { type: 'string' },
              status: { type: 'string' },
            },
            required: ['credential_type', 'masked_value', 'status'],
          },
        },
      },
    },
    async (request, reply) => {
      const { type } = request.params as { type: string };
      const { value } = request.body as { value: string };
      const userId = request.user.id;

      // 1. Validate credential type
      if (!VALID_CREDENTIAL_TYPES.has(type)) {
        throw AppError.badRequest(
          `Invalid credential type "${type}". Must be one of: ${[...VALID_CREDENTIAL_TYPES].join(', ')}`,
          { valid_types: [...VALID_CREDENTIAL_TYPES] },
        );
      }

      const supabase = createSupabaseAdminClient();

      // 2. Check for an existing credential so we can clean up its vault secret
      const { data: existing } = await supabase
        .from('credentials')
        .select('vault_secret_id')
        .eq('user_id', userId)
        .eq('credential_type', type)
        .maybeSingle();

      const oldVaultSecretId = existing?.vault_secret_id as string | null | undefined;

      // 3. Store the new value in Vault — raw value is NOT logged
      request.log.info({ userId, credentialType: type }, 'Storing credential in vault');
      const newVaultSecretId = await storeSecret(userId, type, value);

      // 4. Compute masked value: "••••" + last 4 chars
      const maskedValue = maskValue(value);

      // 5. Upsert credentials metadata row (user_id + credential_type is the unique constraint)
      const { error: upsertError } = await supabase
        .from('credentials')
        .upsert(
          {
            user_id: userId,
            credential_type: type,
            masked_value: maskedValue,
            vault_secret_id: newVaultSecretId,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,credential_type' },
        );

      if (upsertError) {
        // Clean up the newly created vault secret on DB failure to avoid orphans
        try {
          await deleteSecret(newVaultSecretId);
        } catch {
          request.log.error(
            { vaultSecretId: newVaultSecretId },
            'Failed to clean up vault secret after DB upsert failure',
          );
        }
        throw AppError.internal('Failed to save credential metadata');
      }

      // 6. Delete old vault secret now that the metadata row points to the new one
      if (oldVaultSecretId) {
        try {
          await deleteSecret(oldVaultSecretId);
        } catch {
          // Non-fatal: orphaned secret is acceptable — do not fail the request
          request.log.warn(
            { oldVaultSecretId },
            'Failed to delete old vault secret after credential update',
          );
        }
      }

      request.log.info({ userId, credentialType: type }, 'Credential stored successfully');

      // 7. Return masked result — raw value is NEVER included in the response
      return reply.status(200).send({
        credential_type: type,
        masked_value: maskedValue,
        status: 'active',
      });
    },
  );
}
