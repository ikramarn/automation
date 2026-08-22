import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Protected dashboard route group layout.
 * Redirects unauthenticated visitors to /login.
 * In preview mode (no Supabase), skips auth check entirely.
 */
export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  if (!isSupabaseConfigured()) {
    // Preview mode — render without auth check
    return (
      <div className="flex min-h-screen flex-col">
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">{children}</main>
    </div>
  );
}
