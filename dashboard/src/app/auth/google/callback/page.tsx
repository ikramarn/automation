"use client";

/**
 * /auth/google/callback
 *
 * Handles the OAuth callback from Google via Supabase.
 * Supabase redirects here after Google login with the session tokens
 * in the URL hash fragment: #access_token=...&refresh_token=...&type=signup
 *
 * Exchanges the token, establishes the session, then redirects to /dashboard.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function GoogleCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const supabase = createClient();

      // Supabase SSR package automatically handles the hash exchange
      // when getSession is called — it reads the hash from the URL
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        setError(error.message);
        return;
      }

      if (session) {
        // Successfully authenticated — go to dashboard
        router.replace("/dashboard");
        return;
      }

      // No session yet — try exchanging the code/hash manually
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.replace("#", ""));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const errorCode = params.get("error_code");
        const errorDesc = params.get("error_description");

        if (errorCode) {
          setError(errorDesc?.replace(/\+/g, " ") ?? "Authentication failed");
          return;
        }

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            setError(sessionError.message);
            return;
          }

          router.replace("/dashboard");
          return;
        }
      }

      // Check search params for code-based flow
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        router.replace("/dashboard");
        return;
      }

      // No token found at all
      setError("No authentication token received. Please try signing in again.");
    }

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-4 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Sign in failed</h1>
          <p className="mb-6 text-sm text-gray-500">{error}</p>
          <a href="/login"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <svg className="mx-auto mb-4 h-10 w-10 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-sm text-gray-500">Completing sign in…</p>
      </div>
    </div>
  );
}
