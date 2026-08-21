"use client";

/**
 * Notification preferences page — /settings/notifications
 *
 * Allows users to control when they receive email / in-app notifications:
 *   - notify_on_success        : pipeline execution completed successfully
 *   - notify_on_failure        : pipeline execution failed
 *   - notify_on_pipeline_paused: pipeline was automatically paused
 *
 * Defaults: all three are ON when no row exists in the backend.
 *
 * Requirements: 14.5, 21.6
 */

import { useState, useEffect } from "react";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPreferences {
  notify_on_success: boolean;
  notify_on_failure: boolean;
  notify_on_pipeline_paused: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  notify_on_success: true,
  notify_on_failure: true,
  notify_on_pipeline_paused: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchPreferences(url: string): Promise<NotificationPreferences> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  // 404 means no row yet → return defaults
  if (res.status === 404) return { ...DEFAULT_PREFS };

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string })?.message ??
        `Failed to fetch notification preferences: ${res.status}`
    );
  }

  const data = (await res.json()) as Partial<NotificationPreferences>;
  // Merge with defaults so missing keys stay true
  return {
    notify_on_success: data.notify_on_success ?? true,
    notify_on_failure: data.notify_on_failure ?? true,
    notify_on_pipeline_paused: data.notify_on_pipeline_paused ?? true,
  };
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf-token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");
  const data = (await res.json()) as Record<string, string>;
  return (data.csrfToken ?? data.csrf_token ?? data.token ?? "") as string;
}

async function savePreferences(
  prefs: NotificationPreferences
): Promise<void> {
  const csrfToken = await fetchCsrfToken();
  const res = await fetch(`${API_BASE}/account/notifications`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(prefs),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string })?.message ?? "Failed to save notification preferences"
    );
  }
}

// ---------------------------------------------------------------------------
// Toggle switch component
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

function ToggleSwitch({
  id,
  checked,
  disabled = false,
  onChange,
  label,
  description,
}: ToggleSwitchProps) {
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;

  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      {/* Text side */}
      <div className="min-w-0 flex-1">
        <label
          id={labelId}
          htmlFor={id}
          className="block cursor-pointer text-sm font-medium text-gray-900 select-none"
        >
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-sm text-gray-500">
            {description}
          </p>
        )}
      </div>

      {/* Toggle switch */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Visible status text */}
        <span
          aria-hidden="true"
          className={[
            "text-xs font-semibold",
            checked ? "text-indigo-600" : "text-gray-400",
          ].join(" ")}
        >
          {checked ? "On" : "Off"}
        </span>

        {/* The actual checkbox — visually hidden but focusable */}
        <button
          type="button"
          id={id}
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => !disabled && onChange(!checked)}
          className={[
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
            "transition-colors duration-200 ease-in-out",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            checked ? "bg-indigo-600" : "bg-gray-200",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className={[
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0",
              "transition duration-200 ease-in-out",
              checked ? "translate-x-5" : "translate-x-0",
            ].join(" ")}
          />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center py-16" aria-label="Loading notification preferences">
      <svg
        aria-hidden="true"
        className="h-8 w-8 animate-spin text-indigo-600"
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
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotificationsPage() {
  const {
    data: fetchedPrefs,
    error,
    isLoading,
    mutate,
  } = useSWR<NotificationPreferences>(
    `${API_BASE}/account/notifications`,
    fetchPreferences,
    { revalidateOnFocus: false }
  );

  // Local copy so the UI updates instantly (optimistic)
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [saving, setSaving] = useState<string | null>(null); // key currently being saved
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);

  // Sync local state whenever SWR data arrives
  useEffect(() => {
    if (fetchedPrefs) setPrefs(fetchedPrefs);
  }, [fetchedPrefs]);

  async function handleToggle(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic update
    setSaveError(null);
    setSuccessKey(null);
    setSaving(key);

    try {
      await savePreferences(next);
      // Update SWR cache
      await mutate(next, { revalidate: false });
      setSuccessKey(key);
      // Clear success indicator after 2.5 s
      setTimeout(() => setSuccessKey((k) => (k === key ? null : k)), 2500);
    } catch (err) {
      // Rollback on error
      setPrefs(prefs);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save preference."
      );
    } finally {
      setSaving(null);
    }
  }

  const TOGGLES: {
    key: keyof NotificationPreferences;
    label: string;
    description: string;
  }[] = [
    {
      key: "notify_on_success",
      label: "Execution succeeded",
      description:
        "Receive a notification when a pipeline execution completes successfully.",
    },
    {
      key: "notify_on_failure",
      label: "Execution failed",
      description:
        "Receive a notification when a pipeline execution fails or errors out.",
    },
    {
      key: "notify_on_pipeline_paused",
      label: "Pipeline auto-paused",
      description:
        "Receive a notification when a pipeline is automatically paused (e.g. due to repeated failures or a billing issue).",
    },
  ];

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose which events trigger a notification.
        </p>
      </div>

      {isLoading && <Spinner />}

      {!isLoading && error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
        >
          <p className="font-medium">Failed to load notification preferences</p>
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

      {!isLoading && !error && (
        <section
          aria-label="Notification preferences"
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {/* Save error banner */}
          {saveError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}

          <div
            role="list"
            aria-label="Notification toggles"
            className="divide-y divide-gray-100"
          >
            {TOGGLES.map(({ key, label, description }) => (
              <div key={key} role="listitem" className="relative">
                <ToggleSwitch
                  id={`toggle-${key}`}
                  checked={prefs[key]}
                  disabled={saving !== null}
                  onChange={(val) => handleToggle(key, val)}
                  label={label}
                  description={description}
                />

                {/* Per-row inline feedback */}
                <div
                  aria-live="polite"
                  aria-atomic="true"
                  className="absolute right-0 -top-0 flex items-center gap-1"
                >
                  {saving === key && (
                    <span className="text-xs text-gray-400" role="status">
                      Saving…
                    </span>
                  )}
                  {successKey === key && saving === null && (
                    <span className="text-xs font-medium text-green-600" role="status">
                      Saved
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-xs text-gray-400">
            Changes are saved immediately when you toggle a switch.
          </p>
        </section>
      )}
    </>
  );
}
