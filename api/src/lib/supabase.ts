import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates an admin Supabase client using the service role key.
 *
 * The service role key bypasses RLS — only use this on the server side
 * for privileged operations (auth management, vault access).
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the client.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url) {
    throw new Error('SUPABASE_URL environment variable is required');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // Disable session persistence — this is a server-side admin client
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
