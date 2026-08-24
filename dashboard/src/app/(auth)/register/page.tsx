"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Password rule helpers (must match backend: Requirement 1.1)
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

/** Strength score 0–5 (ignoring maxLength which is rarely the issue) */
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

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const strength = checkPassword(password);
  const score = strengthScore(strength);
  const valid = isPasswordValid(strength);

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
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        setSuccess(true);
        return;
      }

      const data: ApiError = await res.json().catch(() => ({}));

      if (data.error_code === "email_already_registered") {
        setError("An account with this email already exists.");
      } else if (data.error_code === "weak_password") {
        setError(data.message ?? "Password does not meet the requirements.");
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

  // Success state
  if (success) {
    return (
      <div role="status" aria-live="polite" className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-green-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </span>
        </div>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">
          Check your inbox
        </h1>
        <p className="text-sm text-gray-600">
          Verification email sent. Please check your inbox and click the link to
          activate your account.
        </p>
        <p className="mt-6 text-sm text-gray-500">
          Already verified?{" "}
          <Link
            href="/login"
            className="font-medium text-indigo-600 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">
        Create your account
      </h1>

      {/* Google OAuth */}
      <a
        href={`https://sqfechtihroodkmncxpc.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://automatesocials.tech/auth/google/callback`}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        aria-label="Continue with Google"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
          <path d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z" fill="#FF3D00"/>
          <path d="M24 46c5.5 0 10.4-1.9 14.3-5l-6.6-5.6C29.7 37 27 38 24 38c-6.1 0-11.2-4-13.1-9.6l-7 5.4C7.5 41.8 15.2 46 24 46z" fill="#4CAF50"/>
          <path d="M44.5 20H24v8.5h11.8c-.9 2.6-2.6 4.8-4.9 6.4l6.6 5.6C41.4 36.9 45 31 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
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

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Registration form">
        {/* Email */}
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

        {/* Password */}
        <div className="mb-4">
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

          {/* Strength bar — only shown once user starts typing */}
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
              <p className="mt-1 text-xs text-gray-500">
                {STRENGTH_LABELS[score] && (
                  <span>Strength: {STRENGTH_LABELS[score]}</span>
                )}
              </p>
            </div>
          )}

          {/* Requirement checklist — shown after first interaction */}
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
            Confirm password
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
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{" "}
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
