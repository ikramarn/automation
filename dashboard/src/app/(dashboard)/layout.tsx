import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Protected dashboard route group layout.
 * Redirects unauthenticated visitors to /login.
 */
export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Navigation — implemented in later tasks */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
