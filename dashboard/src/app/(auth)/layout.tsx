import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface AuthLayoutProps {
  children: React.ReactNode;
}

/**
 * Auth route group layout.
 *
 * - Redirects already-authenticated users straight to the dashboard.
 * - Wraps all auth pages in a centred card design.
 */
export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12" style={{color: 'inherit'}}>
      {/* Brand mark */}
      <div className="mb-8 text-center">
        <span className="text-2xl font-bold tracking-tight text-gray-900">
          AI Video Automation
        </span>
      </div>

      {/* Card — explicitly white background with dark text to override global dark theme */}
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-gray-900">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-gray-400">
        &copy; {new Date().getFullYear()} AI Video Automation. All rights
        reserved.
      </p>
    </div>
  );
}
