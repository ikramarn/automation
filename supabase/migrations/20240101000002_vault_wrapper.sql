-- =============================================================================
-- Migration: 20240101000002_vault_wrapper.sql
-- Description: Create public wrapper for vault.create_secret
-- The Supabase JS client's .rpc() calls public schema functions by default.
-- This wrapper allows vault operations from the API layer.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.vault_create_secret(
  new_secret text,
  new_name text,
  new_description text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN vault.create_secret(new_secret, new_name, new_description);
END;
$$;

-- Also create update wrapper for completeness
CREATE OR REPLACE FUNCTION public.vault_update_secret(
  secret_id uuid,
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM vault.update_secret(secret_id, new_secret, new_name, new_description);
END;
$$;
