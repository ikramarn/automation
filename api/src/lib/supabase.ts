import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates an admin Supabase client using the secret key.
 *
 * Supabase migrated from SUPABASE_SERVICE_ROLE_KEY (legacy HS256 JWT) to
 * SUPABASE_SECRET_KEY (new sb_secret_... format) in 2025.
 *
 * Resolution order:
 *   1. SUPABASE_SECRET_KEY      — new format (sb_secret_...)
 *   2. SUPABASE_SERVICE_ROLE_KEY — legacy format (fallback)
 *
 * The secret key bypasses RLS — only use this on the server side
 * for privileged operations (auth management, vault access).
 * Never expose this key to the client.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL'];
  const secretKey =
    process.env['SUPABASE_SECRET_KEY'] ??
    process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url) {
    throw new Error('SUPABASE_URL environment variable is required');
  }
  if (!secretKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) environment variable is required',
    );
  }

  return createClient(url, secretKey, {
    auth: {
      // Disable session persistence — this is a server-side admin client
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
