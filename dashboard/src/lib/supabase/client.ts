import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creates a Supabase browser client for use in Client Components.
 * Uses the publishable key (new format) with fallback to anon key (legacy).
 */
export function createClient() {
  if (!supabaseUrl || !supabaseKey) {
    // Preview mode — return a stub
    return {
      auth: {
        setSession: async () => ({ error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signOut: async () => ({ error: null }),
      },
    } as any;
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}
