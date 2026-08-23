/**
 * Supabase middleware helper
 *
 * Refreshes the user's auth session on every request so that Server Components
 * always see a valid, non-expired session. Must be called from middleware.ts.
 *
 * This pattern is required by @supabase/ssr: the middleware client is the only
 * place where cookie writes are allowed in the request/response cycle before
 * the page renders.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Support both new (PUBLISHABLE_KEY) and old (ANON_KEY) env var names
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Updates the Supabase session cookie on every request.
 * Returns the modified NextResponse so the refreshed cookie is sent to the browser.
 *
 * @param request - The incoming NextRequest from middleware
 * @returns The response with refreshed session cookies applied
 */
export async function updateSession(request: NextRequest) {
  // Preview / no-backend mode: if Supabase URL is missing, a placeholder, or
  // not a real https URL, skip auth entirely so the UI can be browsed freely.
  const isConfigured =
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith("https://") &&
    supabaseUrl.includes(".supabase.co");

  if (!isConfigured) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh the session — this is critical so Server Components don't see
  // stale auth state. Do NOT remove this line.
  await supabase.auth.getUser();

  return supabaseResponse;
}
