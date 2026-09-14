-- =============================================================================
-- Migration: 20260914000000_vault_delete_and_get_secret.sql
-- Description: Add missing public wrappers for vault secret delete and read.
--
-- Bug fixed: api/src/lib/vault.ts's deleteSecret() queried the `vault` schema
-- directly via the Supabase JS client (`.schema('vault').from('secrets')...`),
-- but PostgREST does not expose the `vault` schema by default — every call
-- failed with "Invalid schema: vault". This meant credential disconnection
-- (Google Drive, YouTube, TikTok, Facebook, Instagram) never actually deleted
-- the underlying vault secret; only the `credentials` metadata row got
-- removed (or, for Google Drive, the whole disconnect failed outright since
-- google-drive.ts treats a failed vault delete as a hard error).
--
-- get_vault_secret() is also backfilled here: it already exists on the live
-- database (created directly, without ever being committed as a migration)
-- and is called from vault.ts's getDecryptedSecret(). Included here with
-- CREATE OR REPLACE so this migration is safe to apply against the existing
-- database and reproducible for any future environment.
-- =============================================================================

-- Delete a vault secret by ID. SECURITY DEFINER so it can reach the `vault`
-- schema, which is not exposed via PostgREST/the API schema list.
CREATE OR REPLACE FUNCTION public.vault_delete_secret(
  secret_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = secret_id;
END;
$$;

-- Read the decrypted value of a vault secret by ID. Returns NULL if the
-- secret does not exist (matches getDecryptedSecret()'s null-on-missing
-- contract in api/src/lib/vault.ts).
CREATE OR REPLACE FUNCTION public.get_vault_secret(
  secret_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE id = secret_id;

  RETURN secret_value;
END;
$$;
