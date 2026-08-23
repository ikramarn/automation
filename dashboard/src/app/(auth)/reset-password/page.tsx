"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Password rule helpers (mirrors register page — Requirement 1.1)
// ---------------------------------------------------------------------------

interface PasswordStrength {
  minLength: boolean;
  maxLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
}

function checkPassword(value: string): PasswordStrength {
  return {
    minLength: value.length >= 8,
    maxLength: value.length <= 64,
    hasUppercase: /[A-Z]/.test(value),
    hasLowercase: /[a-z]/.test(value),
    hasDigit: /[0-9]/.test(value),
    hasSpecial: /[^A-Za-z0-9]/.test(value),
  };
}

function isPasswordValid(s: PasswordStrength): boolean {
  return (
    s.minLength &&
    s.maxLength &&
    s.hasUppercase &&
    s.hasLowercase &&
    s.hasDigit &&
    s.hasSpecial
  );
}

function strengthScore(s: PasswordStrength): number {
  return [
    s.minLength,
    s.hasUppercase,
    s.hasLowercase,
    s.hasDigit,
    s.hasSpecial,
  ].filter(Boolean).length;
}

const RULES: { key: keyof PasswordStrength; label: string }[] = [
  { key: "minLength", label: "At least 8 characters" },
  { key: "maxLength", label: "No more than 64 characters" },
  { key: "hasUppercase", label: "At least one uppercase letter" },
  { key: "hasLowercase", label: "At least one lowercase letter" },
  { key: "hasDigit", label: "At least one number" },
  { key: "hasSpecial", label: "At least one special character (!@#$…)" },
];

const STRENGTH_LABELS = ["", "Weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = [
  "bg-gray-200",
  "bg-red-400",
  "bg-orange-400",
  "bg-yellow-400",
  "bg-lime-500",
  "bg-green-500",
];

interface ApiError {
  error_code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Inner component — uses useSearchParams (must be wrapped in Suspense)
// ---------------------------------------------------------------------------

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const strength = checkPassword(password);
  const score = strengthScore(strength);
  const valid = isPasswordValid(strength);

  // No token in URL — show an informative error
  if (!token) {
    return (
      <div className="text-center" role="alert">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">
          Invalid reset link
        </h1>
        <p className="mb-6 text-sm text-gray-600">
          This password reset link is missing a token. Please request a new
          reset link.
        </p>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          Request new link
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!valid) {
      setError("Please fix the password requirements listed below.");
      setPasswordTouched(true);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        router.push("/login?reset=success");
        return;
      }

      const data: ApiError = await res.json().catch(() => ({}));

      if (data.error_code === "token_expired" || data.error_code === "invalid_token") {
        setError(
          "This reset link has expired or is invalid. Please request a new one."
        );
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose a strong password for your account.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Set new password form">
        {/* New password */}
        <div className="mb-4">
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            New password
          </label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (!passwordTouched) setPasswordTouched(true);
            }}
            onBlur={() => setPasswordTouched(true)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            placeholder="••••••••"
            disabled={loading}
            aria-required="true"
            aria-describedby="password-strength password-rules"
          />

          {/* Strength bar */}
          {password.length > 0 && (
            <div className="mt-2" id="password-strength" aria-live="polite">
              <div
                className="flex gap-1"
                role="progressbar"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-label={`Password strength: ${STRENGTH_LABELS[score]}`}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      n <= score ? STRENGTH_COLORS[score] : "bg-gray-200"
                    }`}
                  />
                ))}
              </div>
              {STRENGTH_LABELS[score] && (
                <p className="mt-1 text-xs text-gray-500">
                  Strength: {STRENGTH_LABELS[score]}
                </p>
              )}
            </div>
          )}

          {/* Requirement checklist */}
          {passwordTouched && (
            <ul
              id="password-rules"
              className="mt-2 space-y-1"
              aria-label="Password requirements"
            >
              {RULES.map(({ key, label }) => {
                const met = strength[key];
                return (
                  <li
                    key={key}
                    className={`flex items-center gap-1.5 text-xs ${
                      met ? "text-green-600" : "text-gray-500"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 flex-shrink-0 ${
                        met ? "text-green-500" : "text-gray-300"
                      }`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      {met ? (
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      ) : (
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v4a1 1 0 002 0V7zm-1 8a1 1 0 100-2 1 1 0 000 2z"
                          clipRule="evenodd"
                        />
                      )}
                    </svg>
                    {label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Confirm password */}
        <div className="mb-6">
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            placeholder="••••••••"
            disabled={loading}
            aria-required="true"
          />
          {confirmPassword.length > 0 && confirmPassword !== password && (
            <p className="mt-1 text-xs text-red-600" role="alert">
              Passwords do not match.
            </p>
          )}
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
              Saving…
            </>
          ) : (
            "Set new password"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Remembered your password?{" "}
        <Link
          href="/login"
          className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps form in Suspense because useSearchParams requires it
// ---------------------------------------------------------------------------

export default function ResetPasswordPage() {
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
      <ResetPasswordForm />
    </Suspense>
  );
}
