import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import DashboardNav from "@/components/DashboardNav";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Protected dashboard route group layout.
 * Adds the top navigation bar with sign out + page links.
 * Redirects unauthenticated visitors to /login.
 */
export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardNav />
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
    <div className="min-h-screen bg-gray-50">
      <DashboardNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
