"use client";

/**
 * Credentials settings page — /settings/credentials
 *
 * Lets users manage their third-party API keys and OAuth connections:
 *   - HeyGen API key (masked after save)
 *   - OpenAI API key (masked after save)
 *   - Google Drive OAuth (connect / disconnect)
 *   - Social platforms: YouTube, TikTok, Facebook, Instagram (connect / disconnect)
 *
 * Requirements: 3.4, 3.5, 4.8, 5.6
 */

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Credential {
  credential_type: string;
  masked_value: string;
  status: string;
  updated_at: string;
}

type SocialPlatform = "youtube" | "tiktok" | "facebook" | "instagram";

const SOCIAL_PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchCredentials(url: string): Promise<Credential[]> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { credentials: "include", headers });
  if (res.status === 401) return [];
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch credentials: ${res.status}`);
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

function getCredential(
  credentials: Credential[] | undefined,
  type: string
): Credential | undefined {
  return credentials?.find((c) => c.credential_type === type);
}

function isConnected(credentials: Credential[] | undefined, type: string): boolean {
  const cred = getCredential(credentials, type);
  return !!cred && cred.status === "active";
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <svg
        aria-hidden="true"
        className="h-5 w-5 animate-spin text-indigo-600"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API key form (HeyGen / OpenAI)
// ---------------------------------------------------------------------------

interface ApiKeyFormProps {
  label: string;
  credentialType: string;
  credential: Credential | undefined;
  onSaved: () => void;
}

function ApiKeyForm({ label, credentialType, credential, onSaved }: ApiKeyFormProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const maskedDisplay = credential?.masked_value ?? null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!value.trim()) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const csrfToken = await fetchCsrfToken();

      const res = await fetch(`${API_BASE}/credentials/${credentialType}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ value: value.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to save ${label} key`);
      }

      setValue("");
      setSuccess(`${label} key saved successfully.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  const inputId = `api-key-${credentialType}`;

  return (
    <div>
      {/* Current masked value */}
      {maskedDisplay && (
        <p className="mb-2 text-sm text-gray-600">
          Current key:{" "}
          <span className="font-mono font-medium text-gray-800" aria-label={`Current ${label} key, masked`}>
            {maskedDisplay}
          </span>
        </p>
      )}

      {/* Success banner */}
      {success && (
        <div role="status" aria-live="polite" className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} aria-label={`${label} API key form`} noValidate>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
          {maskedDisplay ? `Replace ${label} API key` : `Add ${label} API key`}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="password"
            name="api-key"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            placeholder="Paste your API key here"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            aria-required="true"
          />
          <button
            type="submit"
            disabled={saving || !value.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-busy={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Connection status badge
// ---------------------------------------------------------------------------

function ConnectionBadge({ connected, expired }: { connected: boolean; expired?: boolean }) {
  if (expired) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
        Token expired
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
      Disconnected
    </span>
  );
}

// ---------------------------------------------------------------------------
// Google Drive section
// ---------------------------------------------------------------------------

interface GoogleDriveSectionProps {
  credentials: Credential[] | undefined;
  onDisconnected: () => void;
}

function GoogleDriveSection({ credentials, onDisconnected }: GoogleDriveSectionProps) {
  const cred = getCredential(credentials, "google_drive_refresh_token");
  const connected = isConnected(credentials, "google_drive_refresh_token");
  const expired = cred?.status === "token_expired";

  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/credentials/google`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to disconnect Google Drive");
      }
      onDisconnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {/* Google Drive icon */}
        <svg aria-hidden="true" className="h-8 w-8 shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
        </svg>
        <div>
          <p className="text-sm font-medium text-gray-900">Google Drive</p>
          <ConnectionBadge connected={connected} expired={expired} />
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        {error && (
          <p role="alert" className="text-xs text-red-600">{error}</p>
        )}
        {connected || expired ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 disabled:opacity-50"
            aria-busy={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <a
            href={`${API_BASE}/credentials/google/connect`}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            aria-label="Connect Google Drive"
          >
            Connect
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Social platform row
// ---------------------------------------------------------------------------

interface SocialPlatformRowProps {
  platform: SocialPlatform;
  label: string;
  credentials: Credential[] | undefined;
  onDisconnected: () => void;
}

const SOCIAL_ACCESS_TOKEN_TYPE: Record<SocialPlatform, string> = {
  youtube: "youtube_access_token",
  tiktok: "tiktok_access_token",
  facebook: "facebook_access_token",
  instagram: "instagram_access_token",
};

function SocialPlatformRow({ platform, label, credentials, onDisconnected }: SocialPlatformRowProps) {
  const credType = SOCIAL_ACCESS_TOKEN_TYPE[platform];
  const cred = getCredential(credentials, credType);
  const connected = isConnected(credentials, credType);
  const expired = cred?.status === "token_expired";

  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/credentials/social/${platform}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to disconnect ${label}`);
      }
      onDisconnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      // Get the current session JWT to pass to the connect endpoint so it can
      // identify the user and embed their ID in the OAuth state parameter.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Not authenticated. Please refresh the page and try again.");
      }
      const connectUrl = `${API_BASE}/credentials/social/${platform}/connect?token=${encodeURIComponent(session.access_token)}`;
      window.location.href = connectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setConnecting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-gray-100">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600" aria-hidden="true">
          {label[0]}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <ConnectionBadge connected={connected} expired={expired} />
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        {error && (
          <p role="alert" className="text-xs text-red-600">{error}</p>
        )}
        {connected || expired ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 disabled:opacity-50"
            aria-busy={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            aria-label={`Connect ${label}`}
            aria-busy={connecting}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner page (uses useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------

function CredentialsPageInner() {
  const searchParams = useSearchParams();
  const driveConnected = searchParams.get("drive") === "connected";
  const socialConnected = searchParams.get("social") === "connected";
  const oauthError = searchParams.get("error");

  const {
    data: credentials,
    error,
    isLoading,
    mutate,
  } = useSWR<Credential[]>(`${API_BASE}/credentials`, fetchCredentials, {
    revalidateOnFocus: true,
  });

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Credentials</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage the API keys and account connections used by your pipelines.
        </p>
      </div>

      {/* OAuth success banners */}
      {driveConnected && (
        <div role="status" aria-live="polite" className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Google Drive connected successfully.
        </div>
      )}
      {socialConnected && (
        <div role="status" aria-live="polite" className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Social platform connected successfully.
        </div>
      )}
      {oauthError && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Connection failed. Please try again, or check that you granted the required permissions.
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner label="Loading credentials…" />
        </div>
      )}

      {/* Fetch error */}
      {!isLoading && error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <p className="font-medium">Failed to load credentials</p>
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

      {/* Content */}
      {!isLoading && !error && (
        <div className="space-y-6">
          {/* HeyGen API key */}
          <SectionCard
            title="HeyGen API Key"
            description="Required for AI avatar video generation. Get your key from the HeyGen dashboard."
          >
            <ApiKeyForm
              label="HeyGen"
              credentialType="heygen_api_key"
              credential={getCredential(credentials, "heygen_api_key")}
              onSaved={() => mutate()}
            />
          </SectionCard>

          {/* OpenAI API key */}
          <SectionCard
            title="OpenAI API Key"
            description="Used for script generation. If not provided, the platform key is used as a fallback."
          >
            <ApiKeyForm
              label="OpenAI"
              credentialType="openai_api_key"
              credential={getCredential(credentials, "openai_api_key")}
              onSaved={() => mutate()}
            />
          </SectionCard>

          {/* Google Drive */}
          <SectionCard
            title="Google Drive"
            description="Connect your Google Drive so completed videos are automatically saved."
          >
            <GoogleDriveSection
              credentials={credentials}
              onDisconnected={() => mutate()}
            />
          </SectionCard>

          {/* Social platforms */}
          <SectionCard
            title="Social Platforms"
            description="Connect accounts to enable automatic publishing from your pipelines."
          >
            <div>
              {SOCIAL_PLATFORMS.map(({ id, label }) => (
                <SocialPlatformRow
                  key={id}
                  platform={id}
                  label={label}
                  credentials={credentials}
                  onDisconnected={() => mutate()}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function CredentialsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16" aria-label="Loading credentials">
          <svg aria-hidden="true" className="h-8 w-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
      }
    >
      <CredentialsPageInner />
    </Suspense>
  );
}
