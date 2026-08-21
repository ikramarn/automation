"use client";

/**
 * Pipeline creation wizard — /pipelines/new
 *
 * Multi-step form (3 steps) for creating a new pipeline:
 *   Step 1: Basic info — name and niche keyword
 *   Step 2: Schedule — recurrence, time, timezone
 *   Step 3: Publishing — platform selection (only connected platforms)
 *
 * On success, redirects to /dashboard. Shows an upgrade message when the
 * pipeline limit is reached (Req 6.1).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, useEffect } from "react";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Recurrence = "daily" | "weekdays" | "custom";

type Platform = "youtube" | "tiktok" | "facebook" | "instagram";

interface ConnectedPlatform {
  platform: Platform;
  connected: boolean;
  display_name: string;
}

interface FormState {
  // Step 1 — Basic info
  name: string;
  niche_keyword: string;
  // Step 2 — Schedule
  recurrence: Recurrence;
  time: string; // HH:MM
  timezone: string;
  custom_days: number[]; // 0=Sun … 6=Sat (for "custom" recurrence)
  // Step 3 — Publishing
  selected_platforms: Platform[];
}

interface ApiError {
  error_code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 3;

const PLATFORM_DISPLAY: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
};

const PLATFORM_ICONS: Record<Platform, string> = {
  youtube: "📺",
  tiktok: "🎵",
  facebook: "📘",
  instagram: "📷",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Common IANA timezones — representative subset
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "Pacific/Auckland",
];

// Deduplicate and sort timezones
const TIMEZONE_OPTIONS = [...new Set(COMMON_TIMEZONES)].sort();

// ---------------------------------------------------------------------------
// SWR — fetch connected platforms
// ---------------------------------------------------------------------------

async function fetchCredentials(url: string): Promise<ConnectedPlatform[]> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) return [];

  const data: Array<{ credential_type: string; status: string }> =
    await res.json().catch(() => []);

  // Map credential list to connected platforms
  const platforms: Platform[] = ["youtube", "tiktok", "facebook", "instagram"];
  return platforms.map((p) => {
    const entry = data.find((c) => c.credential_type === `social_${p}`);
    return {
      platform: p,
      display_name: PLATFORM_DISPLAY[p],
      connected: entry?.status === "connected",
    };
  });
}

// ---------------------------------------------------------------------------
// CSRF token helper
// ---------------------------------------------------------------------------

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf-token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");
  const data = await res.json();
  return data.csrf_token ?? data.token ?? "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`animate-spin ${className}`}
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
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Progress indicator
// ---------------------------------------------------------------------------

function StepIndicator({
  current,
  total,
  stepLabels,
}: {
  current: number;
  total: number;
  stepLabels: string[];
}) {
  return (
    <nav aria-label="Pipeline creation steps" className="mb-8">
      <ol className="flex items-center gap-0">
        {stepLabels.map((label, index) => {
          const step = index + 1;
          const isDone = step < current;
          const isActive = step === current;

          return (
            <li
              key={label}
              className={`flex items-center ${index < total - 1 ? "flex-1" : ""}`}
            >
              {/* Step circle */}
              <div className="flex flex-col items-center shrink-0">
                <span
                  aria-current={isActive ? "step" : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isDone
                      ? "bg-indigo-600 text-white"
                      : isActive
                      ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                      : "bg-gray-200 text-gray-500"
                  }`}
                  aria-label={`Step ${step}: ${label}${isDone ? " (complete)" : isActive ? " (current)" : ""}`}
                >
                  {isDone ? (
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    step
                  )}
                </span>
                <span
                  className={`mt-1 hidden text-xs font-medium sm:block ${
                    isActive ? "text-indigo-600" : "text-gray-400"
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connector line */}
              {index < total - 1 && (
                <div
                  aria-hidden="true"
                  className={`mx-2 h-0.5 flex-1 ${
                    isDone ? "bg-indigo-600" : "bg-gray-200"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Basic Info
// ---------------------------------------------------------------------------

interface Step1Errors extends Record<string, string | undefined> {
  name?: string;
  niche_keyword?: string;
}

function Step1BasicInfo({
  form,
  errors,
  onChange,
}: {
  form: FormState;
  errors: Step1Errors;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Basic pipeline information</legend>

      {/* Pipeline name */}
      <div className="mb-5">
        <label
          htmlFor="pipeline-name"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Pipeline name
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="pipeline-name"
          type="text"
          name="name"
          value={form.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange("name", e.target.value)
          }
          maxLength={100}
          required
          aria-required="true"
          aria-describedby="pipeline-name-hint pipeline-name-error"
          aria-invalid={!!errors.name}
          placeholder="e.g. Tech News Daily"
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.name
              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <p id="pipeline-name-hint" className="mt-1 text-xs text-gray-400">
          1–100 characters
        </p>
        <FieldError message={errors.name} />
      </div>

      {/* Niche keyword */}
      <div className="mb-5">
        <label
          htmlFor="niche-keyword"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Niche keyword
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="niche-keyword"
          type="text"
          name="niche_keyword"
          value={form.niche_keyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange("niche_keyword", e.target.value)
          }
          maxLength={200}
          required
          aria-required="true"
          aria-describedby="niche-keyword-hint niche-keyword-error"
          aria-invalid={!!errors.niche_keyword}
          placeholder="e.g. artificial intelligence, fintech, crypto"
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.niche_keyword
              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <p id="niche-keyword-hint" className="mt-1 text-xs text-gray-400">
          1–200 characters. Used to find relevant articles for your videos.
        </p>
        <FieldError message={errors.niche_keyword} />
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Schedule
// ---------------------------------------------------------------------------

interface Step2Errors extends Record<string, string | undefined> {
  time?: string;
  timezone?: string;
  custom_days?: string;
}

function Step2Schedule({
  form,
  errors,
  onChange,
}: {
  form: FormState;
  errors: Step2Errors;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  function toggleCustomDay(day: number) {
    const current = form.custom_days;
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    onChange("custom_days", next);
  }

  return (
    <fieldset>
      <legend className="sr-only">Pipeline schedule</legend>

      {/* Recurrence */}
      <div className="mb-5">
        <span
          id="recurrence-label"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          Recurrence
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </span>
        <div
          role="radiogroup"
          aria-labelledby="recurrence-label"
          className="flex flex-wrap gap-3"
        >
          {(["daily", "weekdays", "custom"] as Recurrence[]).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                form.recurrence === option
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="recurrence"
                value={option}
                checked={form.recurrence === option}
                onChange={() => onChange("recurrence", option)}
                className="sr-only"
                aria-label={
                  option === "daily"
                    ? "Every day"
                    : option === "weekdays"
                    ? "Weekdays (Mon–Fri)"
                    : "Custom days"
                }
              />
              {option === "daily"
                ? "Every day"
                : option === "weekdays"
                ? "Weekdays (Mon–Fri)"
                : "Custom days"}
            </label>
          ))}
        </div>
      </div>

      {/* Custom day picker */}
      {form.recurrence === "custom" && (
        <div className="mb-5">
          <span
            id="custom-days-label"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            Select days
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          </span>
          <div
            role="group"
            aria-labelledby="custom-days-label"
            className="flex flex-wrap gap-2"
          >
            {DAY_LABELS.map((day, index) => {
              const selected = form.custom_days.includes(index);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleCustomDay(index)}
                  aria-pressed={selected}
                  aria-label={`${selected ? "Deselect" : "Select"} ${day}`}
                  className={`h-10 w-12 rounded-lg border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
                    selected
                      ? "border-indigo-500 bg-indigo-600 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <FieldError message={errors.custom_days} />
        </div>
      )}

      {/* Time */}
      <div className="mb-5">
        <label
          htmlFor="schedule-time"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Time
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="schedule-time"
          type="time"
          name="time"
          value={form.time}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange("time", e.target.value)
          }
          required
          aria-required="true"
          aria-describedby="schedule-time-hint schedule-time-error"
          aria-invalid={!!errors.time}
          className={`block w-40 rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.time
              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <p id="schedule-time-hint" className="mt-1 text-xs text-gray-400">
          24-hour format (HH:MM) in the selected timezone.
        </p>
        <FieldError message={errors.time} />
      </div>

      {/* Timezone */}
      <div className="mb-5">
        <label
          htmlFor="schedule-timezone"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Timezone
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <select
          id="schedule-timezone"
          name="timezone"
          value={form.timezone}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange("timezone", e.target.value)
          }
          required
          aria-required="true"
          aria-describedby="schedule-timezone-error"
          aria-invalid={!!errors.timezone}
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.timezone
              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        >
          <option value="" disabled>
            Select a timezone…
          </option>
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <FieldError message={errors.timezone} />
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Publishing (platform selection)
// ---------------------------------------------------------------------------

interface Step3Errors extends Record<string, string | undefined> {
  selected_platforms?: string;
}

function Step3Publishing({
  form,
  errors,
  platforms,
  platformsLoading,
  onChange,
}: {
  form: FormState;
  errors: Step3Errors;
  platforms: ConnectedPlatform[];
  platformsLoading: boolean;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  function togglePlatform(platform: Platform) {
    const current = form.selected_platforms;
    const next = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    onChange("selected_platforms", next);
  }

  const connectedPlatforms = platforms.filter((p) => p.connected);

  return (
    <fieldset>
      <legend className="sr-only">Select publishing platforms</legend>

      <div className="mb-3">
        <span
          id="platforms-label"
          className="block text-sm font-medium text-gray-700"
        >
          Publishing platforms
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </span>
        <p className="mt-1 text-xs text-gray-400">
          Select at least one connected platform to publish your videos to.
          Only connected platforms are available.
        </p>
      </div>

      {platformsLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
          <Spinner className="h-4 w-4" />
          Loading connected platforms…
        </div>
      )}

      {!platformsLoading && connectedPlatforms.length === 0 && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700"
        >
          <p className="font-medium">No platforms connected</p>
          <p className="mt-1 text-amber-600">
            Connect at least one social platform in{" "}
            <a
              href="/settings/integrations#social"
              className="font-medium underline hover:text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              Settings → Integrations
            </a>{" "}
            before creating a pipeline.
          </p>
        </div>
      )}

      {!platformsLoading && connectedPlatforms.length > 0 && (
        <div
          role="group"
          aria-labelledby="platforms-label"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {connectedPlatforms.map(({ platform, display_name }) => {
            const selected = form.selected_platforms.includes(platform);
            return (
              <label
                key={platform}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
                  selected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <input
                  type="checkbox"
                  name="selected_platforms"
                  value={platform}
                  checked={selected}
                  onChange={() => togglePlatform(platform)}
                  aria-label={`Publish to ${display_name}`}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-lg" aria-hidden="true">
                  {PLATFORM_ICONS[platform]}
                </span>
                <span
                  className={`text-sm font-medium ${
                    selected ? "text-indigo-700" : "text-gray-700"
                  }`}
                >
                  {display_name}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <FieldError message={errors.selected_platforms} />

      {/* Show disconnected platforms as disabled */}
      {!platformsLoading && platforms.some((p) => !p.connected) && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
            Not connected
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {platforms
              .filter((p) => !p.connected)
              .map(({ platform, display_name }) => (
                <div
                  key={platform}
                  aria-disabled="true"
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 opacity-50"
                >
                  <span className="text-lg" aria-hidden="true">
                    {PLATFORM_ICONS[platform]}
                  </span>
                  <span className="text-sm font-medium text-gray-400">
                    {display_name}
                  </span>
                  <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                    Not connected
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateStep1(form: FormState): Step1Errors {
  const errors: Step1Errors = {};
  if (!form.name.trim()) {
    errors.name = "Pipeline name is required.";
  } else if (form.name.trim().length > 100) {
    errors.name = "Pipeline name must be 100 characters or fewer.";
  }
  if (!form.niche_keyword.trim()) {
    errors.niche_keyword = "Niche keyword is required.";
  } else if (form.niche_keyword.trim().length > 200) {
    errors.niche_keyword = "Niche keyword must be 200 characters or fewer.";
  }
  return errors;
}

function validateStep2(form: FormState): Step2Errors {
  const errors: Step2Errors = {};
  if (!form.time) {
    errors.time = "Please set a time for the pipeline to run.";
  } else if (!/^\d{2}:\d{2}$/.test(form.time)) {
    errors.time = "Time must be in HH:MM format.";
  }
  if (!form.timezone) {
    errors.timezone = "Please select a timezone.";
  }
  if (form.recurrence === "custom" && form.custom_days.length === 0) {
    errors.custom_days = "Select at least one day for custom recurrence.";
  }
  return errors;
}

function validateStep3(form: FormState): Step3Errors {
  const errors: Step3Errors = {};
  if (form.selected_platforms.length === 0) {
    errors.selected_platforms =
      "Select at least one platform to publish your videos to.";
  }
  return errors;
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewPipelinePage() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const [step1Errors, setStep1Errors] = useState<Step1Errors>({});
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});
  const [step3Errors, setStep3Errors] = useState<Step3Errors>({});

  // Detect user's local timezone as default
  const localTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const [form, setForm] = useState<FormState>({
    name: "",
    niche_keyword: "",
    recurrence: "daily",
    time: "09:00",
    timezone: TIMEZONE_OPTIONS.includes(localTz) ? localTz : "UTC",
    custom_days: [],
    selected_platforms: [],
  });

  // Fetch connected platforms
  const { data: platforms = [], isLoading: platformsLoading } = useSWR<
    ConnectedPlatform[]
  >(`${API_BASE}/credentials`, fetchCredentials, {
    revalidateOnFocus: false,
  });

  function updateField(field: keyof FormState, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear relevant error when user changes the field
    if (field in step1Errors) setStep1Errors((e) => ({ ...e, [field]: undefined }));
    if (field in step2Errors) setStep2Errors((e) => ({ ...e, [field]: undefined }));
    if (field in step3Errors) setStep3Errors((e) => ({ ...e, [field]: undefined }));
  }

  // Announce step changes to screen readers
  useEffect(() => {
    const announcement = document.getElementById("step-announcement");
    if (announcement) {
      announcement.textContent = `Step ${currentStep} of ${TOTAL_STEPS}: ${
        ["Basic info", "Schedule", "Publishing"][currentStep - 1]
      }`;
    }
  }, [currentStep]);

  function handleNext() {
    if (currentStep === 1) {
      const errors = validateStep1(form);
      setStep1Errors(errors);
      if (hasErrors(errors)) return;
    }
    if (currentStep === 2) {
      const errors = validateStep2(form);
      setStep2Errors(errors);
      if (hasErrors(errors)) return;
    }
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    setGlobalError(null);
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 1));
    setGlobalError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Final step validation
    const errors = validateStep3(form);
    setStep3Errors(errors);
    if (hasErrors(errors)) return;

    setSubmitting(true);
    setGlobalError(null);
    setLimitReached(false);

    try {
      // Fetch CSRF token
      let csrfToken = "";
      try {
        csrfToken = await fetchCsrfToken();
      } catch {
        // Non-blocking — proceed without CSRF token if endpoint unavailable
      }

      const payload = {
        name: form.name.trim(),
        niche_keyword: form.niche_keyword.trim(),
        schedule: {
          recurrence: form.recurrence,
          time: form.time,
          timezone: form.timezone,
          ...(form.recurrence === "custom"
            ? { days_of_week: form.custom_days }
            : {}),
        },
        platforms: form.selected_platforms,
      };

      const res = await fetch(`${API_BASE}/pipelines`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/dashboard");
        return;
      }

      const data: ApiError = await res.json().catch(() => ({}));

      // Check for pipeline limit error (Req 6.1)
      if (
        data.error_code === "pipeline_limit_reached" ||
        (data.message ?? "").toLowerCase().includes("pipeline limit reached")
      ) {
        setLimitReached(true);
        return;
      }

      setGlobalError(
        data.message ?? "An unexpected error occurred. Please try again."
      );
    } catch {
      setGlobalError("Unable to reach the server. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = ["Basic info", "Schedule", "Publishing"];

  return (
    <div className="container mx-auto max-w-xl px-4 py-10">
      {/* Screen reader announcement */}
      <div
        id="step-announcement"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Create a pipeline
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Set up automated AI video production and publishing in three steps.
        </p>
      </div>

      {/* Pipeline limit upgrade message */}
      {limitReached && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4"
        >
          <p className="font-semibold text-amber-800">Pipeline limit reached</p>
          <p className="mt-1 text-sm text-amber-700">
            Pipeline limit reached. Upgrade your plan to create more pipelines.
          </p>
          <a
            href="/settings/billing"
            className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
          >
            Upgrade plan
          </a>
        </div>
      )}

      {/* Step progress indicator */}
      <StepIndicator
        current={currentStep}
        total={TOTAL_STEPS}
        stepLabels={stepLabels}
      />

      {/* Global error */}
      {globalError && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {globalError}
        </div>
      )}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label={`Create pipeline — step ${currentStep} of ${TOTAL_STEPS}: ${stepLabels[currentStep - 1]}`}
      >
        {/* Step panels */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-800">
            {currentStep === 1 && "Basic information"}
            {currentStep === 2 && "Schedule"}
            {currentStep === 3 && "Publishing platforms"}
          </h2>

          {currentStep === 1 && (
            <Step1BasicInfo
              form={form}
              errors={step1Errors}
              onChange={updateField}
            />
          )}
          {currentStep === 2 && (
            <Step2Schedule
              form={form}
              errors={step2Errors}
              onChange={updateField}
            />
          )}
          {currentStep === 3 && (
            <Step3Publishing
              form={form}
              errors={step3Errors}
              platforms={platforms}
              platformsLoading={platformsLoading}
              onChange={updateField}
            />
          )}
        </div>

        {/* Navigation buttons */}
        <div className="mt-6 flex items-center justify-between">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50"
              aria-label="Go back to previous step"
            >
              Back
            </button>
          ) : (
            <a
              href="/dashboard"
              className="text-sm text-gray-400 hover:text-gray-600 hover:underline focus:outline-none focus:underline"
              aria-label="Cancel and return to dashboard"
            >
              Cancel
            </a>
          )}

          {currentStep < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              aria-label={`Continue to ${stepLabels[currentStep]}`}
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-busy={submitting}
              aria-label="Create pipeline"
            >
              {submitting && <Spinner className="h-4 w-4" />}
              {submitting ? "Creating…" : "Create pipeline"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
