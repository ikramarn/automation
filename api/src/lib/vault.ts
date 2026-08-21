import { createSupabaseAdminClient } from './supabase.js';

/**
 * Supabase Vault helpers.
 *
 * All vault operations use the service-role admin client — the vault schema
 * is not accessible to the anon/user role.
 *
 * Security notes:
 *  - Raw secret values are NEVER logged. Only the vault_secret_id (UUID) is
 *    persisted in the `credentials` metadata table.
 *  - Secrets are named `{userId}:{credentialType}` so they can be identified
 *    without reading the decrypted value.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 18.4
 */

/**
 * Stores a secret in Supabase Vault and returns the vault secret UUID.
 *
 * Uses `vault.create_secret(secret, name, description)` RPC which wraps the
 * pgsodium-backed `vault.secrets` insert and returns the new secret's UUID.
 *
 * @param userId         - Supabase user UUID (used in the secret name)
 * @param credentialType - e.g. `heygen_api_key`
 * @param secretValue    - Raw API key (NEVER logged)
 * @returns              Vault secret UUID (vault_secret_id)
 */
export async function storeSecret(
  userId: string,
  credentialType: string,
  secretValue: string,
): Promise<string> {
  const supabase = createSupabaseAdminClient();

  // Structured name lets operators identify secrets without decrypting them
  const secretName = `${userId}:${credentialType}`;

  const { data, error } = await supabase.rpc('vault_create_secret', {
    new_secret: secretValue,
    new_name: secretName,
    new_description: `API key for credential type: ${credentialType}`,
  });

  if (error || !data) {
    // Never include the raw secretValue in error messages or logs
    throw new Error(`Failed to store vault secret for credential type "${credentialType}": ${error?.message ?? 'no data returned'}`);
  }

  // data is the UUID of the newly created vault secret
  return data as string;
}

/**
 * Deletes a secret from Supabase Vault by its UUID.
 *
 * @param vaultSecretId - UUID of the vault.secrets row to delete
 */
export async function deleteSecret(vaultSecretId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .schema('vault')
    .from('secrets')
    .delete()
    .eq('id', vaultSecretId);

  if (error) {
    throw new Error(`Failed to delete vault secret ${vaultSecretId}: ${error.message}`);
  }
}

/**
 * Masks an API key for safe display in the UI.
 *
 * Returns `"••••" + key.slice(-4)` for keys with 4 or more characters.
 * Returns `"••••"` for shorter keys (rare but handled defensively).
 *
 * Requirement 3.4: Display as `••••[last4chars]` — e.g. `••••abcd`
 *
 * @param key - Raw API key string
 * @returns   Masked representation (never exposes raw key)
 */
export function maskApiKey(key: string): string {
  if (key.length >= 4) {
    return `\u2022\u2022\u2022\u2022${key.slice(-4)}`;
  }
  return '\u2022\u2022\u2022\u2022';
}

/**
 * Alias for `maskApiKey` — used in credential routes for consistency with task spec.
 *
 * @param key - Raw API key / token string
 * @returns   Masked representation `"••••" + key.slice(-4)`
 */
export const maskValue = maskApiKey;

/**
 * Retrieves a decrypted secret value from Supabase Vault by its UUID.
 *
 * Reads from the `vault.decrypted_secrets` view which Supabase Vault exposes
 * as a convenience layer over `vault.secrets` with pgsodium decryption applied.
 *
 * Security notes:
 *  - The raw decrypted value is returned to the caller and must NEVER be logged.
 *  - Only use this in server-side, service-role contexts (e.g., internal trigger routes).
 *
 * @param vaultSecretId - UUID of the vault secret to decrypt
 * @returns             Decrypted secret string, or null if not found
 *
 * Requirements: 3.7, 12.8
 */
export async function getDecryptedSecret(vaultSecretId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', vaultSecretId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to retrieve vault secret ${vaultSecretId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return (data as Record<string, unknown>)['decrypted_secret'] as string | null;
}
