"use client";

/**
 * Billing page — /settings/billing
 *
 * Displays the user's current subscription status and provides:
 *   - Subscribe button → POST /subscription/checkout → redirects to Stripe Checkout
 *   - Manage subscription button → GET /subscription/portal → redirects to Stripe Portal
 *
 * Requirements: 2.1, 2.2, 2.8
 */

import { useState } from "react";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubscriptionStatus {
  subscription_status: "active" | "inactive" | "suspended" | "pending" | string;
  stripe_subscription_id: string | null;
  subscription_expires_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchSubscriptionStatus(url: string): Promise<SubscriptionStatus> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch subscription: ${res.status}`);
  }
  return res.json();
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf-token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");
  const data = await res.json();
  return (data.csrfToken ?? data.csrf_token ?? data.token ?? "") as string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { dateStyle: "long" });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-green-100 text-green-700 ring-green-200",
  },
  inactive: {
    label: "Inactive",
    className: "bg-gray-100 text-gray-500 ring-gray-200",
  },
  suspended: {
    label: "Suspended",
    className: "bg-red-100 text-red-600 ring-red-200",
  },
  pending: {
    label: "Payment pending",
    className: "bg-amber-100 text-amber-700 ring-amber-200",
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-500 ring-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${config.className}`}
      aria-label={`Subscription status: ${config.label}`}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center py-16" aria-label="Loading billing information">
      <svg aria-hidden="true" className="h-8 w-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscribe button
// ---------------------------------------------------------------------------

function SubscribeButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe() {
    setError(null);
    setLoading(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/subscription/checkout`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to create checkout session");
      }

      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={loading}
        className="flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={loading}
      >
        {loading ? (
          <>
            <svg aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Redirecting…
          </>
        ) : (
          "Subscribe"
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Billing portal button
// ---------------------------------------------------------------------------

function BillingPortalButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePortal() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/subscription/portal`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to open billing portal");
      }

      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handlePortal}
        disabled={loading}
        className="flex items-center justify-center rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={loading}
        aria-label="Open Stripe billing portal to manage payment methods and invoices"
      >
        {loading ? (
          <>
            <svg aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Opening portal…
          </>
        ) : (
          "Manage subscription"
        )}
      </button>
      <p className="mt-2 text-xs text-gray-400">
        Update payment method, view invoices, or cancel your subscription.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Billing content
// ---------------------------------------------------------------------------

function BillingContent({ data, mutate }: { data: SubscriptionStatus; mutate: () => void }) {
  const isActive = data.subscription_status === "active";
  const isPending = data.subscription_status === "pending";
  const hasSubscription = !!data.stripe_subscription_id;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {/* Status row */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Subscription</h2>
          {data.subscription_expires_at && (
            <p className="mt-1 text-sm text-gray-500">
              {isActive ? "Renews on" : "Expires on"}{" "}
              <span className="font-medium text-gray-700">
                {formatDate(data.subscription_expires_at)}
              </span>
            </p>
          )}
        </div>
        <StatusBadge status={data.subscription_status} />
      </div>

      {/* Pending notice */}
      {isPending && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status" aria-live="polite">
          Payment confirmation pending. Your subscription will activate once payment is confirmed.
          <button
            type="button"
            onClick={mutate}
            className="ml-2 underline hover:no-underline focus:outline-none"
          >
            Refresh status
          </button>
        </div>
      )}

      {/* Suspended notice */}
      {data.subscription_status === "suspended" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          Your subscription is suspended. Pipeline execution is paused. Subscribe to restore access.
        </div>
      )}

      {/* CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {!isActive && !isPending && <SubscribeButton />}
        {(isActive || hasSubscription) && <BillingPortalButton />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR<SubscriptionStatus>(
    `${API_BASE}/subscription/status`,
    fetchSubscriptionStatus,
    {
      revalidateOnFocus: true,
      // Poll every 30s to detect pending → active transitions
      refreshInterval: 30_000,
    }
  );

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your subscription and billing details.
        </p>
      </div>

      {isLoading && <Spinner />}

      {!isLoading && error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <p className="font-medium">Failed to load billing information</p>
          <p className="mt-1 text-red-600">{error.message}</p>
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && data && (
        <BillingContent data={data} mutate={() => mutate()} />
      )}
    </div>
  );
}
