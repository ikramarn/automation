"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * /verify-email
 *
 * Handles Supabase email verification. Supabase sends the token as a URL
 * hash fragment: /verify-email#access_token=...&type=signup
 *
 * This page reads the hash, exchanges the token with Supabase, then
 * redirects to /dashboard on success or shows an error.
 */
export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleVerification() {
      const hash = window.location.hash;

      // No hash — might be a direct visit or ?status= style redirect
      if (!hash) {
        const params = new URLSearchParams(window.location.search);
        const s = params.get("status");
        if (s === "success") {
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMsg("No verification token found. Please check your email link.");
        }
        return;
      }

      // Parse hash fragment
      const params = new URLSearchParams(hash.replace("#", ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type");
      const errorCode = params.get("error_code");
      const errorDesc = params.get("error_description");

      // Handle error in hash
      if (errorCode) {
        setStatus("error");
        setErrorMsg(errorDesc?.replace(/\+/g, " ") ?? "Verification failed.");
        return;
      }

      if (!accessToken) {
        setStatus("error");
        setErrorMsg("Invalid verification link. Please try registering again.");
        return;
      }

      try {
        const supabase = createClient();

        if (type === "signup" || type === "email_change") {
          // Exchange the token to create a session
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken ?? "",
          });

          if (error) {
            setStatus("error");
            setErrorMsg(error.message);
            return;
          }
        } else if (type === "recovery") {
          // Password recovery — redirect to reset password page
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken ?? "",
          });
          if (!error) {
            router.push("/reset-password");
            return;
          }
        }

        setStatus("success");
        // Redirect to dashboard after 2 seconds
        setTimeout(() => router.push("/dashboard"), 2000);
      } catch {
        setStatus("error");
        setErrorMsg("An unexpected error occurred. Please try again.");
      }
    }

    handleVerification();
  }, [router]);

  return (
    <div className="text-center">
      {status === "loading" && (
        <>
          <div className="mb-4 flex justify-center">
            <svg
              className="h-10 w-10 animate-spin text-indigo-600"
              fill="none"
              viewBox="0 0 24 24"
              aria-label="Verifying..."
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Verifying your email…</h1>
          <p className="text-sm text-gray-500">Please wait a moment.</p>
        </>
      )}

      {status === "success" && (
        <>
          <div className="mb-4 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Email verified!</h1>
          <p className="mb-6 text-sm text-gray-600">
            Your email has been confirmed. Redirecting to your dashboard…
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Go to Dashboard
          </Link>
        </>
      )}

      {status === "error" && (
        <>
          <div className="mb-4 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Verification failed</h1>
          <p className="mb-6 text-sm text-gray-600">
            {errorMsg || "Something went wrong. Please try again or contact support."}
          </p>
          <Link
            href="/login"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}
