/**
 * Supabase server client
 *
 * Use this client in Server Components, Route Handlers, and Server Actions.
 * It reads the auth session from the Next.js cookies() store, so the user's
 * JWT is forwarded automatically and RLS policies apply correctly.
 *
 * IMPORTANT: This file must only be imported from server-side code.
 * It will throw at runtime if called from a Client Component.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Returns true when Supabase is properly configured (real project URL present).
 * In preview/demo mode the env vars are absent or placeholder values.
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith("https://") &&
    supabaseUrl.includes(".supabase.co")
  );
}

/**
 * Creates a Supabase server client that uses the Next.js cookies store.
 * Must be called inside a Server Component, Route Handler, or Server Action
 * where cookies() is available.
 *
 * In preview mode (no real Supabase), returns a stub client whose auth methods
 * always return null so pages render without redirecting.
 */
export async function createClient() {
  // Preview / no-backend mode — return a stub so pages don't crash or redirect
  if (!isSupabaseConfigured()) {
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    } as any;
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll is called from a Server Component where cookies cannot be
          // mutated. The middleware handles session refresh in that case.
        }
      },
    },
  });
}
