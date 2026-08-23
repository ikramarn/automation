"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Shape of the backend error response */
interface ApiError {
  error_code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Inner component — uses useSearchParams (must be wrapped in Suspense)
// ---------------------------------------------------------------------------

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
        return;
      }

      const data: ApiError = await res.json().catch(() => ({}));

      if (data.error_code === "email_not_verified") {
        setUnverified(true);
      } else {
        setError(
          data.message ?? "An unexpected error occurred. Please try again."
        );
      }
    } catch {
      setError("Unable to reach the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">
        Sign in to your account
      </h1>

      {/* Password-reset success banner */}
      {resetSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          Your password has been reset. You can now sign in with your new
          password.
        </div>
      )}

      {/* Email-unverified banner */}
      {unverified && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 border border-amber-200"
        >
          Please verify your email. Check your inbox for the verification link.
        </div>
      )}

      {/* General error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200"
        >
          {error}
        </div>
      )}

      {/* Google OAuth */}
      <a
        href="/api/auth/google"
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        aria-label="Continue with Google"
      >
        {/* Google "G" icon */}
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"
            fill="#FFC107"
          />
          <path
            d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"
            fill="#FF3D00"
          />
          <path
            d="M24 46c5.5 0 10.4-1.9 14.3-5l-6.6-5.6C29.7 37 27 38 24 38c-6.1 0-11.2-4-13.1-9.6l-7 5.4C7.5 41.8 15.2 46 24 46z"
            fill="#4CAF50"
          />
          <path
            d="M44.5 20H24v8.5h11.8c-.9 2.6-2.6 4.8-4.9 6.4l6.6 5.6C41.4 36.9 45 31 45 24c0-1.3-.2-2.7-.5-4z"
            fill="#1976D2"
          />
        </svg>
        Continue with Google
      </a>

      {/* Divider */}
      <div className="relative mb-6" aria-hidden="true">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-gray-400">or</span>
        </div>
      </div>

      {/* Email / password form */}
      <form onSubmit={handleSubmit} noValidate aria-label="Sign in form">
        <div className="mb-4">
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            placeholder="you@example.com"
            disabled={loading}
            aria-required="true"
          />
        </div>

        <div className="mb-2">
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            placeholder="••••••••"
            disabled={loading}
            aria-required="true"
          />
        </div>

        {/* Forgot password link */}
        <div className="mb-6 text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-indigo-600 hover:text-indigo-500 hover:underline focus:outline-none focus:underline"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          aria-busy={loading}
        >
          {loading ? (
            <>
              <svg
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      {/* Register link */}
      <p className="mt-6 text-center text-sm text-gray-500">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
        >
          Create one
        </Link>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps form in Suspense because useSearchParams requires it
// ---------------------------------------------------------------------------

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-8" aria-label="Loading">
          <svg
            aria-hidden="true"
            className="h-6 w-6 animate-spin text-indigo-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
