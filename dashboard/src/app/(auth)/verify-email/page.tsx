import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Verify Email",
};

interface VerifyEmailPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * /verify-email
 *
 * This page is loaded after the user clicks the verification link in their
 * email.  The backend (or Supabase's redirect handler) appends a `status`
 * query-param indicating the outcome.
 *
 * Expected values:
 *   ?status=success          — email verified successfully
 *   ?status=expired          — link expired (>24 h)
 *   ?status=invalid          — token not found / already used
 *   (no param / unknown)     — generic error
 */
export default function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const rawStatus = searchParams?.status;
  const status = typeof rawStatus === "string" ? rawStatus : "";

  const isSuccess = status === "success";

  return (
    <div className="text-center">
      {isSuccess ? (
        <>
          {/* Success icon */}
          <div className="mb-4 flex justify-center">
            <span
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-100"
              aria-hidden="true"
            >
              <svg
                className="h-7 w-7 text-green-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </span>
          </div>

          <h1 className="mb-2 text-2xl font-semibold text-gray-900">
            Email verified!
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            Your email address has been confirmed. You can now sign in to your
            account.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Sign in
          </Link>
        </>
      ) : (
        <>
          {/* Error icon */}
          <div className="mb-4 flex justify-center">
            <span
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-100"
              aria-hidden="true"
            >
              <svg
                className="h-7 w-7 text-red-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </span>
          </div>

          <h1 className="mb-2 text-2xl font-semibold text-gray-900">
            {status === "expired"
              ? "Link expired"
              : status === "invalid"
                ? "Invalid link"
                : "Verification failed"}
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            {status === "expired" ? (
              <>
                Your verification link has expired. Verification links are valid
                for 24 hours. Please register again or request a new link.
              </>
            ) : status === "invalid" ? (
              <>
                This verification link is invalid or has already been used.
                Please try signing in or create a new account.
              </>
            ) : (
              <>
                Something went wrong while verifying your email. Please try
                again or contact support if the problem persists.
              </>
            )}
          </p>

          <Link
            href="/login"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}
