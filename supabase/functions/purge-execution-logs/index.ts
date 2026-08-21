/**
 * Supabase Edge Function: purge-execution-logs
 *
 * Fallback retention job for Supabase Starter plans where pg_cron is unavailable.
 * Deletes execution_logs rows older than 90 days (Req 13.7).
 *
 * Deployment:
 *   supabase functions deploy purge-execution-logs
 *
 * Scheduling (Supabase Dashboard):
 *   Project Settings → Edge Functions → Schedules → Add schedule
 *   Cron: "0 3 * * *"  (daily at 03:00 UTC)
 *
 * Environment variables required:
 *   SUPABASE_URL            — set automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — set automatically by Supabase runtime
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing required environment variables" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { error, count } = await supabase
    .from("execution_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff.toISOString());

  if (error) {
    console.error("purge-execution-logs failed:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`purge-execution-logs: deleted ${count ?? 0} rows older than 90 days`);
  return new Response(
    JSON.stringify({ deleted: count ?? 0 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
