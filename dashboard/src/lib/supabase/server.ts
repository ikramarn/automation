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

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing required Supabase environment variables: " +
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set."
  );
}

/**
 * Creates a Supabase server client that uses the Next.js cookies store.
 * Must be called inside a Server Component, Route Handler, or Server Action
 * where cookies() is available.
 */
export async function createClient() {
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
