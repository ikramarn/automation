"use client";

/**
 * Account settings page — /settings/account
 *
 * Allows users to:
 *   - Update their display name
 *   - Initiate an email change (sends verification to new address)
 *   - Change their password (requires current password)
 *   - Delete their account (requires email confirmation)
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

import { useState, type FormEvent } from "react";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountProfile {
  display_name: string | null;
  email: string;
  subscription_status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchAccount(url: string): Promise<AccountProfile> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch account: ${res.status}`);
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

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center py-16" aria-label="Loading account">
      <svg aria-hidden="true" className="h-8 w-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
      {message}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

function SubmitButton({ loading, label, loadingLabel, danger = false }: {
  loading: boolean;
  label: string;
  loadingLabel: string;
  danger?: boolean;
}) {
  const base = "flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
  const color = danger
    ? "bg-red-600 hover:bg-red-500 focus:ring-red-500"
    : "bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-500";

  return (
    <button type="submit" disabled={loading} className={`${base} ${color}`} aria-busy={loading}>
      {loading ? (
        <>
          <svg aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {loadingLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Display name form
// ---------------------------------------------------------------------------

interface DisplayNameFormProps {
  currentName: string | null;
  onSaved: (newName: string) => void;
}

function DisplayNameForm({ currentName, onSaved }: DisplayNameFormProps) {
  const [name, setName] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/account`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ display_name: name.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to update display name");
      }

      setSuccess("Display name updated.");
      onSaved(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Display name form" noValidate>
      {success && <SuccessBanner message={success} />}
      {error && <ErrorBanner message={error} />}
      <div className="mb-4">
        <label htmlFor="display-name" className="mb-1 block text-sm font-medium text-gray-700">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          name="display_name"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          placeholder="Your name"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          aria-required="true"
        />
        <p className="mt-1 text-xs text-gray-400">{name.length}/50 characters</p>
      </div>
      <SubmitButton loading={saving} label="Save name" loadingLabel="Saving…" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Email change form
// ---------------------------------------------------------------------------

interface EmailChangeFormProps {
  currentEmail: string;
}

function EmailChangeForm({ currentEmail }: EmailChangeFormProps) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() || email.trim() === currentEmail) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/account`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to initiate email change");
      }

      setEmail("");
      setSuccess(`Verification email sent to ${email.trim()}. Check your inbox and click the link to confirm.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Email change form" noValidate>
      {success && <SuccessBanner message={success} />}
      {error && <ErrorBanner message={error} />}
      <p className="mb-3 text-sm text-gray-600">
        Current email: <span className="font-medium text-gray-800">{currentEmail}</span>
      </p>
      <div className="mb-4">
        <label htmlFor="new-email" className="mb-1 block text-sm font-medium text-gray-700">
          New email address
        </label>
        <input
          id="new-email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={saving}
          placeholder="new@example.com"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          aria-required="true"
        />
        <p className="mt-1 text-xs text-gray-400">A verification email will be sent to the new address.</p>
      </div>
      <SubmitButton loading={saving} label="Send verification" loadingLabel="Sending…" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password change form
// ---------------------------------------------------------------------------

function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/account/password`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to change password");
      }

      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Password changed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Password change form" noValidate>
      {success && <SuccessBanner message={success} />}
      {error && <ErrorBanner message={error} />}
      <div className="mb-4">
        <label htmlFor="current-password" className="mb-1 block text-sm font-medium text-gray-700">
          Current password
        </label>
        <input
          id="current-password"
          type="password"
          name="current_password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={saving}
          placeholder="••••••••"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          aria-required="true"
        />
      </div>
      <div className="mb-4">
        <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          name="new_password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={saving}
          placeholder="Minimum 8 characters"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          aria-required="true"
        />
        <p className="mt-1 text-xs text-gray-400">Must be at least 8 characters.</p>
      </div>
      <SubmitButton loading={saving} label="Change password" loadingLabel="Changing…" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Account deletion form
// ---------------------------------------------------------------------------

interface DeleteAccountFormProps {
  userEmail: string;
}

function DeleteAccountForm({ userEmail }: DeleteAccountFormProps) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleDelete(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmEmail !== userEmail) {
      setError("Email does not match your registered email address.");
      return;
    }

    setError(null);
    setDeleting(true);

    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/account`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ email: confirmEmail }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Account deletion failed");
      }

      // Redirect to login after successful deletion
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setDeleting(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-600">
        Permanently deletes your account and all associated data. This action cannot be undone.
      </p>

      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
        >
          Delete my account
        </button>
      ) : (
        <form onSubmit={handleDelete} aria-label="Account deletion confirmation form" noValidate>
          {error && <ErrorBanner message={error} />}

          <div className="mb-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>This cannot be undone.</strong> All pipelines, execution logs, and credentials will be permanently removed.
          </div>

          <div className="mb-4 mt-4">
            <label htmlFor="confirm-email" className="mb-1 block text-sm font-medium text-gray-700">
              Type your email address to confirm:{" "}
              <span className="font-mono text-gray-900">{userEmail}</span>
            </label>
            <input
              id="confirm-email"
              type="email"
              name="confirm_email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              disabled={deleting}
              placeholder={userEmail}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
              aria-required="true"
            />
          </div>

          <div className="flex gap-3">
            <SubmitButton
              loading={deleting}
              label="Permanently delete account"
              loadingLabel="Deleting…"
              danger
            />
            <button
              type="button"
              onClick={() => { setShowConfirm(false); setConfirmEmail(""); setError(null); }}
              disabled={deleting}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AccountPage() {
  const {
    data: account,
    error,
    isLoading,
    mutate,
  } = useSWR<AccountProfile>(`${API_BASE}/account`, fetchAccount, {
    revalidateOnFocus: false,
  });

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your profile, email, password, and account status.
        </p>
      </div>

      {isLoading && <Spinner />}

      {!isLoading && error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <p className="font-medium">Failed to load account details</p>
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

      {!isLoading && !error && account && (
        <div className="space-y-6">
          {/* Display name */}
          <SectionCard
            title="Display Name"
            description="This name is shown across the dashboard."
          >
            <DisplayNameForm
              currentName={account.display_name}
              onSaved={(newName) =>
                mutate({ ...account, display_name: newName }, { revalidate: false })
              }
            />
          </SectionCard>

          {/* Email */}
          <SectionCard
            title="Email Address"
            description="Changing your email requires verification of the new address."
          >
            <EmailChangeForm currentEmail={account.email} />
          </SectionCard>

          {/* Password */}
          <SectionCard
            title="Password"
            description="Choose a strong password with at least 8 characters."
          >
            <PasswordChangeForm />
          </SectionCard>

          {/* Danger zone */}
          <SectionCard
            title="Delete Account"
            description="Once deleted, your account and all data cannot be recovered."
          >
            <DeleteAccountForm userEmail={account.email} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
