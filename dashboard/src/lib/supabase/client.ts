/**
 * Supabase browser client
 *
 * Use this client in Client Components ("use client") for:
 * - Reading data with RLS applied for the signed-in user
 * - Subscribing to Realtime channels
 * - Calling Supabase Auth from the browser
 *
 * The client is created once per browser session using @supabase/ssr's
 * createBrowserClient, which automatically reads/writes the auth cookie.
 */
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing required Supabase environment variables: " +
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set."
  );
}

/**
 * Creates a Supabase browser client.
 * Call this inside a Client Component — do NOT call at module scope in a
 * Server Component file, as it accesses browser-only cookie storage.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl!, supabaseAnonKey!);
}
