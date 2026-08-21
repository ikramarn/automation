import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { deleteSecret } from '../../lib/vault.js';
import { VALID_CREDENTIAL_TYPES } from './upsert.js';

/**
 * DELETE /credentials/:type
 *
 * Deletes an API key / token credential for the authenticated user.
 *
 * Flow:
 *  1. Validate :type is a known credential type → 400 if unknown.
 *  2. Fetch the credential record for this user + type → 404 if not found.
 *  3. Delete the encrypted secret from Supabase Vault.
 *  4. Delete the `credentials` metadata row.
 *  5. Find any pipelines referencing this credential type and set status = 'paused'.
 *  6. Return 200 { message: "Credential deleted" }.
 *
 * Credentials are NEVER written to logs at any point (Req 3.6, 18.4).
 *
 * Requirements: 3.5, 3.6, 18.4
 */
export async function deleteCredentialRoute(app: FastifyInstance): Promise<void> {
  app.delete(
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
      const { type } = request.params as { type: string };
      const userId = request.user.id;

      // 1. Validate credential type — catch typos before hitting the DB
      if (!VALID_CREDENTIAL_TYPES.has(type)) {
        throw AppError.badRequest(
          `Invalid credential type "${type}". Must be one of: ${[...VALID_CREDENTIAL_TYPES].join(', ')}`,
          { valid_types: [...VALID_CREDENTIAL_TYPES] },
        );
      }

      const supabase = createSupabaseAdminClient();

      // 2. Fetch the credential record
      const { data: credential, error: fetchError } = await supabase
        .from('credentials')
        .select('id, vault_secret_id')
        .eq('user_id', userId)
        .eq('credential_type', type)
        .maybeSingle();

      if (fetchError) {
        request.log.error(
          { userId, credentialType: type, err: fetchError.message },
          'Failed to fetch credential for deletion',
        );
        throw AppError.internal('Failed to retrieve credential');
      }

      if (!credential) {
        throw AppError.notFound('Credential');
      }

      const { id: credentialId, vault_secret_id: vaultSecretId } = credential as {
        id: string;
        vault_secret_id: string;
      };

      // 3. Delete vault secret
      try {
        await deleteSecret(vaultSecretId);
      } catch (err) {
        request.log.error(
          { userId, credentialType: type, vaultSecretId, err: String(err) },
          'Failed to delete vault secret',
        );
        throw AppError.internal('Failed to delete credential secret');
      }

      // 4. Delete the credentials metadata row
      const { error: deleteError } = await supabase
        .from('credentials')
        .delete()
        .eq('id', credentialId)
        .eq('user_id', userId); // Belt-and-suspenders: enforce user ownership

      if (deleteError) {
        request.log.error(
          { userId, credentialType: type, credentialId, err: deleteError.message },
          'Failed to delete credential row after vault secret deletion',
        );
        throw AppError.internal('Failed to delete credential record');
      }

      // 5. Pause any active pipelines that reference this credential type.
      //
      // The `pipelines` table does not store a direct `credential_type` FK, but
      // certain credential types gate specific pipeline features:
      //   - heygen_api_key     → required for all pipelines (video generation)
      //   - openai_api_key     → pipelines using user-supplied OpenAI key
      //   - google_drive_*     → pipelines with Drive upload enabled
      //   - social platform *  → pipelines publishing to that platform
      //
      // For now we pause ALL active pipelines for this user when a required
      // credential is deleted, matching Req 3.6: "pause those Pipelines and
      // notify the User". Pipelines that do not actually depend on this
      // credential type will be paused conservatively.
      //
      // We only pause pipelines in 'active' or 'running' status — already-paused
      // or disabled pipelines are left unchanged.
      const { data: pausedPipelines, error: pauseError } = await supabase
        .from('pipelines')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('status', ['active', 'running'])
        .select('id, name');

      if (pauseError) {
        // Non-fatal: log the failure but do not roll back the credential deletion
        request.log.error(
          { userId, credentialType: type, err: pauseError.message },
          'Failed to pause pipelines after credential deletion',
        );
      } else if (pausedPipelines && pausedPipelines.length > 0) {
        request.log.info(
          { userId, credentialType: type, pausedCount: pausedPipelines.length },
          'Paused pipelines after credential deletion',
        );
      }

      request.log.info({ userId, credentialType: type }, 'Credential deleted successfully');

      return reply.status(200).send({ message: 'Credential deleted' });
    },
  );
}
