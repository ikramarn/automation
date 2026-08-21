/**
 * Supabase helpers barrel export
 *
 * Usage:
 *   Client Component:  import { createClient } from "@/lib/supabase/client"
 *   Server Component:  import { createClient } from "@/lib/supabase/server"
 *   Middleware:        import { updateSession } from "@/lib/supabase/middleware"
 *
 * NOTE: Do NOT import the server client in a Client Component — it will error
 * at runtime because it depends on next/headers (server-only).
 */
export { createClient as createBrowserSupabaseClient } from "./client";
// Server client is intentionally NOT re-exported here to prevent accidental
// use in client-side bundles. Import it directly from "./server".
