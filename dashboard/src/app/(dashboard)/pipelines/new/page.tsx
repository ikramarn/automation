"use client";

/**
 * Pipeline creation wizard — /pipelines/new
 *
 * Smart 4-step wizard that adapts based on the user's chosen video source:
 *
 *   Step 1 — Video source  : AI Generation (HeyGen) or Drive/Upload
 *   Step 2 — Content       : Niche + AI settings (HeyGen) OR folder/file source (Drive)
 *   Step 3 — Schedule      : Recurrence, time, timezone
 *   Step 4 — Publish       : Platform selection + Google Drive storage toggle
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VideoSource = "heygen" | "drive";
type Recurrence  = "daily" | "weekdays" | "custom";
type Platform    = "youtube" | "tiktok" | "facebook" | "instagram";

interface ConnectedCredentials {
  hasHeyGen: boolean;
  hasDrive: boolean;
  connectedPlatforms: Platform[];
}

interface FormState {
  // Step 1 — source
  video_source: VideoSource;
  // Step 2 — content (HeyGen path)
  name: string;
  niche_keyword: string;
  heygen_avatar_id: string;
  video_language: string;
  script_tone: string;
  openai_model: string;
  target_duration_secs: number;
  // Step 2 — content (Drive path — future; stored but not sent to API yet)
  drive_source_folder_id: string;
  // Step 3 — schedule
  recurrence: Recurrence;
  time: string;
  timezone: string;
  custom_days: number[];
  // Step 4 — publish
  selected_platforms: Platform[];
  save_to_drive: boolean;
  gdrive_folder_id: string;
}

interface ApiError {
  error_code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4;

const PLATFORM_DISPLAY: Record<Platform, string> = {
  youtube:   "YouTube",
  tiktok:    "TikTok",
  facebook:  "Facebook",
  instagram: "Instagram",
};

const PLATFORM_ICONS: Record<Platform, string> = {
  youtube:   "▶",
  tiktok:    "♪",
  facebook:  "f",
  instagram: "◈",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  youtube:   "border-red-200 bg-red-50 text-red-700",
  tiktok:    "border-pink-200 bg-pink-50 text-pink-700",
  facebook:  "border-blue-200 bg-blue-50 text-blue-700",
  instagram: "border-orange-200 bg-orange-50 text-orange-700",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Portuguese",
  "Arabic", "Hindi", "Japanese", "Korean", "Chinese",
];

const TONES = [
  { value: "professional",  label: "Professional" },
  { value: "casual",        label: "Casual" },
  { value: "educational",   label: "Educational" },
  { value: "entertaining",  label: "Entertaining" },
  { value: "energetic",     label: "Energetic" },
];

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (fast, recommended)" },
  { value: "gpt-4o",      label: "GPT-4o (higher quality)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

const COMMON_TIMEZONES = [
  "UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Toronto","America/Vancouver","America/Sao_Paulo","America/Mexico_City",
  "Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Rome",
  "Europe/Amsterdam","Europe/Moscow","Africa/Cairo","Africa/Johannesburg","Africa/Lagos",
  "Asia/Dubai","Asia/Kolkata","Asia/Dhaka","Asia/Bangkok","Asia/Singapore",
  "Asia/Hong_Kong","Asia/Shanghai","Asia/Tokyo","Asia/Seoul",
  "Australia/Sydney","Australia/Melbourne","Australia/Perth","Pacific/Auckland",
];
const TIMEZONE_OPTIONS = [...new Set(COMMON_TIMEZONES)].sort();

// ---------------------------------------------------------------------------
// Credential fetcher
// ---------------------------------------------------------------------------

async function fetchConnectedCredentials(url: string): Promise<ConnectedCredentials> {
  const supabase = (await import("@/lib/supabase/client")).createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });

  if (!res.ok) return { hasHeyGen: false, hasDrive: false, connectedPlatforms: [] };

  const data: Array<{ credential_type: string; status: string }> =
    await res.json().catch(() => []);

  const active = (type: string) => data.some(c => c.credential_type === type && c.status === "active");

  const platforms: Platform[] = ["youtube", "tiktok", "facebook", "instagram"];
  const connectedPlatforms = platforms.filter(p => active(`${p}_access_token`));

  return {
    hasHeyGen:         active("heygen_api_key"),
    hasDrive:          active("google_drive_refresh_token"),
    connectedPlatforms,
  };
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf-token`, { credentials: "include" });
  if (!res.ok) return "";
  const data = await res.json();
  return (data.csrf_token ?? data.csrfToken ?? "") as string;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-xs text-red-600">{message}</p>;
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
      {children}
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step progress indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <nav aria-label="Pipeline creation steps" className="mb-8">
      <ol className="flex items-center gap-0">
        {labels.map((label, i) => {
          const step = i + 1;
          const done   = step < current;
          const active = step === current;
          return (
            <li key={label} className={`flex items-center ${i < total - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center shrink-0">
                <span
                  aria-current={active ? "step" : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    done   ? "bg-indigo-600 text-white" :
                    active ? "bg-indigo-600 text-white ring-4 ring-indigo-100" :
                             "bg-gray-200 text-gray-500"
                  }`}
                >
                  {done ? (
                    <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : step}
                </span>
                <span className={`mt-1 hidden text-xs font-medium sm:block ${active ? "text-indigo-600" : "text-gray-400"}`}>
                  {label}
                </span>
              </div>
              {i < total - 1 && (
                <div aria-hidden="true" className={`mx-2 h-0.5 flex-1 ${done ? "bg-indigo-600" : "bg-gray-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Video source
// ---------------------------------------------------------------------------

function Step1VideoSource({
  form,
  credentials,
  onChange,
}: {
  form: FormState;
  credentials: ConnectedCredentials | undefined;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-6 text-base font-semibold text-gray-900">
        How will videos be created for this pipeline?
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* HeyGen AI generation */}
        <label
          className={`relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 p-5 transition-all ${
            form.video_source === "heygen"
              ? "border-indigo-500 bg-indigo-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          }`}
        >
          <input
            type="radio"
            name="video_source"
            value="heygen"
            checked={form.video_source === "heygen"}
            onChange={() => onChange("video_source", "heygen")}
            className="sr-only"
          />
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-2xl">
              🤖
            </div>
            {form.video_source === "heygen" && (
              <svg className="h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-semibold text-gray-900">AI Video Generation</p>
            <p className="mt-1 text-sm text-gray-500">
              AutoFlow finds a news article on your niche, writes a script with OpenAI, then renders an AI avatar video with HeyGen — fully automated.
            </p>
          </div>
          {credentials && !credentials.hasHeyGen && (
            <p className="text-xs text-amber-600">
              ⚠ HeyGen API key required.{" "}
              <Link href="/settings/credentials" className="underline">Add it in Credentials</Link>
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {["News → Script", "OpenAI", "HeyGen"].map(t => (
              <span key={t} className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">{t}</span>
            ))}
          </div>
        </label>

        {/* Google Drive source */}
        <label
          className={`relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 p-5 transition-all ${
            form.video_source === "drive"
              ? "border-indigo-500 bg-indigo-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          }`}
        >
          <input
            type="radio"
            name="video_source"
            value="drive"
            checked={form.video_source === "drive"}
            onChange={() => onChange("video_source", "drive")}
            className="sr-only"
          />
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-2xl">
              📁
            </div>
            {form.video_source === "drive" && (
              <svg className="h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-semibold text-gray-900">Upload Your Own Video</p>
            <p className="mt-1 text-sm text-gray-500">
              Point the pipeline to a Google Drive folder containing your videos. AutoFlow will pick them up and publish to your connected platforms on schedule.
            </p>
          </div>
          {credentials && !credentials.hasDrive && (
            <p className="text-xs text-amber-600">
              ⚠ Google Drive connection required.{" "}
              <Link href="/settings/credentials" className="underline">Connect Drive</Link>
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Coming soon</span>
            {["Your videos", "Google Drive"].map(t => (
              <span key={t} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{t}</span>
            ))}
          </div>
        </label>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 2a — Content config for HeyGen
// ---------------------------------------------------------------------------

interface Step2HeyGenErrors extends Record<string, string | undefined> {
  name?: string;
  niche_keyword?: string;
}

function Step2HeyGen({
  form,
  errors,
  credentials,
  onChange,
}: {
  form: FormState;
  errors: Step2HeyGenErrors;
  credentials: ConnectedCredentials | undefined;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">AI video content configuration</legend>

      {credentials && !credentials.hasHeyGen && (
        <WarningBox>
          <strong>HeyGen API key not found.</strong> You can still create the pipeline, but it won&apos;t run until you{" "}
          <Link href="/settings/credentials" className="underline font-medium">add your HeyGen key</Link>.
        </WarningBox>
      )}

      {/* Pipeline name */}
      <div className="mb-5">
        <label htmlFor="pipeline-name" className="mb-1 block text-sm font-medium text-gray-700">
          Pipeline name <span className="text-red-500">*</span>
        </label>
        <input
          id="pipeline-name"
          type="text"
          value={form.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("name", e.target.value)}
          maxLength={100}
          placeholder="e.g. Tech News Daily"
          aria-invalid={!!errors.name}
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.name ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <FieldError message={errors.name} />
      </div>

      {/* Niche keyword */}
      <div className="mb-5">
        <label htmlFor="niche-keyword" className="mb-1 block text-sm font-medium text-gray-700">
          Niche keyword <span className="text-red-500">*</span>
        </label>
        <input
          id="niche-keyword"
          type="text"
          value={form.niche_keyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
          maxLength={200}
          placeholder="e.g. artificial intelligence, crypto, fitness"
          aria-invalid={!!errors.niche_keyword}
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.niche_keyword ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <p className="mt-1 text-xs text-gray-400">
          AutoFlow searches Google News and NewsAPI for articles matching this keyword to generate each video.
        </p>
        <FieldError message={errors.niche_keyword} />
      </div>

      {/* HeyGen Avatar ID */}
      <div className="mb-5">
        <label htmlFor="heygen-avatar-id" className="mb-1 block text-sm font-medium text-gray-700">
          HeyGen Avatar ID
          <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input
          id="heygen-avatar-id"
          type="text"
          value={form.heygen_avatar_id}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_avatar_id", e.target.value)}
          placeholder="e.g. avatar_abc123"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Find your avatar IDs in <strong>HeyGen → Avatars</strong>. Leave blank to use your HeyGen account default.
        </p>
      </div>

      {/* Language + Tone row */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="video-language" className="mb-1 block text-sm font-medium text-gray-700">
            Video language
          </label>
          <select
            id="video-language"
            value={form.video_language}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("video_language", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="script-tone" className="mb-1 block text-sm font-medium text-gray-700">
            Script tone
          </label>
          <select
            id="script-tone"
            value={form.script_tone}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("script_tone", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Advanced settings — collapsed by default */}
      <details className="rounded-lg border border-gray-200 bg-gray-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600 select-none hover:text-gray-900">
          Advanced settings
        </summary>
        <div className="border-t border-gray-200 px-4 py-4">

          {/* OpenAI model */}
          <div className="mb-4">
            <label htmlFor="openai-model" className="mb-1 block text-sm font-medium text-gray-700">
              OpenAI model
            </label>
            <select
              id="openai-model"
              value={form.openai_model}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("openai_model", e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {OPENAI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Uses your OpenAI key if saved in Credentials, otherwise falls back to the platform key.
            </p>
          </div>

          {/* Target duration */}
          <div className="mb-4">
            <label htmlFor="target-duration" className="mb-1 block text-sm font-medium text-gray-700">
              Target video duration: <strong>{form.target_duration_secs}s</strong>
            </label>
            <input
              id="target-duration"
              type="range"
              min={30}
              max={300}
              step={15}
              value={form.target_duration_secs}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("target_duration_secs", Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>30s</span><span>1 min</span><span>2.5 min</span><span>5 min</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Determines target word count for the AI script (~140 words/min).
            </p>
          </div>

        </div>
      </details>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 2b — Content config for Drive upload
// ---------------------------------------------------------------------------

function Step2Drive({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Drive upload configuration</legend>

      <InfoBox>
        <strong>Drive upload pipelines are coming soon.</strong> You can configure the pipeline now — once this feature launches, it will automatically pick up videos from your specified Drive folder and publish them on schedule.
      </InfoBox>

      {/* Pipeline name */}
      <div className="mb-5">
        <label htmlFor="pipeline-name-drive" className="mb-1 block text-sm font-medium text-gray-700">
          Pipeline name <span className="text-red-500">*</span>
        </label>
        <input
          id="pipeline-name-drive"
          type="text"
          value={form.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("name", e.target.value)}
          maxLength={100}
          placeholder="e.g. My Weekly Vlog Upload"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Source Drive folder */}
      <div className="mb-5">
        <label htmlFor="drive-source-folder" className="mb-1 block text-sm font-medium text-gray-700">
          Source Google Drive folder ID
          <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input
          id="drive-source-folder"
          type="text"
          value={form.drive_source_folder_id}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("drive_source_folder_id", e.target.value)}
          placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Open the folder in Google Drive. The ID is the last part of the URL: <code className="rounded bg-gray-100 px-1">drive.google.com/drive/folders/<strong>THIS_PART</strong></code>
        </p>
      </div>

      {/* Niche keyword — used for captions */}
      <div className="mb-5">
        <label htmlFor="niche-keyword-drive" className="mb-1 block text-sm font-medium text-gray-700">
          Content topic / niche
          <span className="ml-1 text-xs font-normal text-gray-400">(for captions)</span>
        </label>
        <input
          id="niche-keyword-drive"
          type="text"
          value={form.niche_keyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
          maxLength={200}
          placeholder="e.g. travel vlogs, cooking tutorials"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Used to generate hashtags and captions for your social posts.
        </p>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Schedule
// ---------------------------------------------------------------------------

interface Step3Errors extends Record<string, string | undefined> {
  time?: string;
  timezone?: string;
  custom_days?: string;
}

function Step3Schedule({
  form,
  errors,
  onChange,
}: {
  form: FormState;
  errors: Step3Errors;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  function toggleDay(day: number) {
    const next = form.custom_days.includes(day)
      ? form.custom_days.filter(d => d !== day)
      : [...form.custom_days, day].sort((a, b) => a - b);
    onChange("custom_days", next);
  }

  return (
    <fieldset>
      <legend className="sr-only">Pipeline schedule</legend>

      {/* Recurrence */}
      <div className="mb-5">
        <span className="mb-2 block text-sm font-medium text-gray-700">Recurrence <span className="text-red-500">*</span></span>
        <div className="flex flex-wrap gap-3">
          {(["daily", "weekdays", "custom"] as Recurrence[]).map(opt => (
            <label
              key={opt}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                form.recurrence === opt
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="recurrence"
                value={opt}
                checked={form.recurrence === opt}
                onChange={() => onChange("recurrence", opt)}
                className="sr-only"
              />
              {opt === "daily" ? "Every day" : opt === "weekdays" ? "Weekdays (Mon–Fri)" : "Custom days"}
            </label>
          ))}
        </div>
      </div>

      {/* Custom day picker */}
      {form.recurrence === "custom" && (
        <div className="mb-5">
          <span className="mb-2 block text-sm font-medium text-gray-700">Select days <span className="text-red-500">*</span></span>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((day, i) => {
              const sel = form.custom_days.includes(i);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(i)}
                  aria-pressed={sel}
                  className={`h-10 w-12 rounded-lg border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
                    sel ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
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

      {/* Time + timezone row */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="schedule-time" className="mb-1 block text-sm font-medium text-gray-700">
            Time <span className="text-red-500">*</span>
          </label>
          <input
            id="schedule-time"
            type="time"
            value={form.time}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("time", e.target.value)}
            className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
              errors.time ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />
          <FieldError message={errors.time} />
        </div>

        <div>
          <label htmlFor="schedule-timezone" className="mb-1 block text-sm font-medium text-gray-700">
            Timezone <span className="text-red-500">*</span>
          </label>
          <select
            id="schedule-timezone"
            value={form.timezone}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("timezone", e.target.value)}
            className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
              errors.timezone ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          >
            <option value="" disabled>Select timezone…</option>
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
          <FieldError message={errors.timezone} />
        </div>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Publishing destinations
// ---------------------------------------------------------------------------

interface Step4Errors extends Record<string, string | undefined> {
  selected_platforms?: string;
}

function Step4Publish({
  form,
  errors,
  credentials,
  onChange,
}: {
  form: FormState;
  errors: Step4Errors;
  credentials: ConnectedCredentials | undefined;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  function togglePlatform(p: Platform) {
    const next = form.selected_platforms.includes(p)
      ? form.selected_platforms.filter(x => x !== p)
      : [...form.selected_platforms, p];
    onChange("selected_platforms", next);
  }

  const allPlatforms: Platform[] = ["youtube", "tiktok", "facebook", "instagram"];
  const connected = credentials?.connectedPlatforms ?? [];
  const disconnected = allPlatforms.filter(p => !connected.includes(p));

  return (
    <fieldset>
      <legend className="sr-only">Publishing destinations</legend>

      {/* Social platforms */}
      <div className="mb-6">
        <p className="mb-1 text-sm font-medium text-gray-700">
          Social platforms <span className="text-red-500">*</span>
        </p>
        <p className="mb-4 text-xs text-gray-400">
          Select at least one platform to publish to. Only connected platforms are available.
        </p>

        {connected.length === 0 && (
          <WarningBox>
            No social platforms connected.{" "}
            <Link href="/settings/credentials" className="font-medium underline">Connect platforms</Link>{" "}
            in Settings → Credentials before creating a pipeline.
          </WarningBox>
        )}

        {connected.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {connected.map(p => {
              const sel = form.selected_platforms.includes(p);
              return (
                <label
                  key={p}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${
                    sel ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => togglePlatform(p)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${PLATFORM_COLORS[p]}`}>
                    {PLATFORM_ICONS[p]}
                  </span>
                  <span className={`text-sm font-medium ${sel ? "text-indigo-700" : "text-gray-700"}`}>
                    {PLATFORM_DISPLAY[p]}
                  </span>
                  <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Connected
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* Disconnected platforms — greyed out with connect link */}
        {disconnected.length > 0 && (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Not connected</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {disconnected.map(p => (
                <Link
                  key={p}
                  href="/settings/credentials"
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 opacity-60 transition hover:opacity-80"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-500">
                    {PLATFORM_ICONS[p]}
                  </span>
                  <span className="text-sm font-medium text-gray-400">{PLATFORM_DISPLAY[p]}</span>
                  <span className="ml-auto text-xs text-indigo-500 underline">Connect →</span>
                </Link>
              ))}
            </div>
          </>
        )}
        <FieldError message={errors.selected_platforms} />
      </div>

      {/* Google Drive storage toggle */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <div className="flex items-start gap-4">
          <input
            id="save-to-drive"
            type="checkbox"
            checked={form.save_to_drive}
            onChange={e => onChange("save_to_drive", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div className="flex-1">
            <label htmlFor="save-to-drive" className="cursor-pointer text-sm font-medium text-gray-900">
              Also save each video to Google Drive
            </label>
            <p className="mt-0.5 text-xs text-gray-400">
              Every generated video will be uploaded to a Drive folder as a permanent backup.
            </p>
            {credentials && !credentials.hasDrive && form.save_to_drive && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ Google Drive not connected.{" "}
                <Link href="/settings/credentials" className="underline">Connect it first</Link>.
              </p>
            )}
          </div>
        </div>

        {form.save_to_drive && (
          <div className="mt-4">
            <label htmlFor="gdrive-folder-id" className="mb-1 block text-sm font-medium text-gray-700">
              Google Drive folder ID
              <span className="ml-1 text-xs font-normal text-gray-400">(optional — uses Drive root if blank)</span>
            </label>
            <input
              id="gdrive-folder-id"
              type="text"
              value={form.gdrive_folder_id}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("gdrive_folder_id", e.target.value)}
              placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              Open the folder in Drive — the ID is at the end of the URL.
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateStep2(form: FormState): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (!form.name.trim())          e.name = "Pipeline name is required.";
  else if (form.name.length > 100) e.name = "Must be 100 characters or fewer.";
  if (form.video_source === "heygen") {
    if (!form.niche_keyword.trim()) e.niche_keyword = "Niche keyword is required.";
    else if (form.niche_keyword.length > 200) e.niche_keyword = "Must be 200 characters or fewer.";
  }
  return e;
}

function validateStep3(form: FormState): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (!form.time)                   e.time = "Please set a time for the pipeline.";
  if (!form.timezone)               e.timezone = "Please select a timezone.";
  if (form.recurrence === "custom" && form.custom_days.length === 0)
    e.custom_days = "Select at least one day.";
  return e;
}

function validateStep4(form: FormState): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (form.selected_platforms.length === 0)
    e.selected_platforms = "Select at least one platform to publish to.";
  return e;
}

function hasErrors(e: Record<string, string | undefined>): boolean {
  return Object.values(e).some(Boolean);
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
  const [step2Errors, setStep2Errors] = useState<Record<string, string | undefined>>({});
  const [step3Errors, setStep3Errors] = useState<Record<string, string | undefined>>({});
  const [step4Errors, setStep4Errors] = useState<Record<string, string | undefined>>({});

  const localTz = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

  const [form, setForm] = useState<FormState>({
    video_source:          "heygen",
    name:                  "",
    niche_keyword:         "",
    heygen_avatar_id:      "",
    video_language:        "English",
    script_tone:           "professional",
    openai_model:          "gpt-4o-mini",
    target_duration_secs:  60,
    drive_source_folder_id: "",
    recurrence:            "daily",
    time:                  "09:00",
    timezone:              TIMEZONE_OPTIONS.includes(localTz) ? localTz : "UTC",
    custom_days:           [],
    selected_platforms:    [],
    save_to_drive:         false,
    gdrive_folder_id:      "",
  });

  const { data: credentials, isLoading: credsLoading } = useSWR<ConnectedCredentials>(
    `${API_BASE}/credentials`,
    fetchConnectedCredentials,
    { revalidateOnFocus: false },
  );

  function updateField(field: keyof FormState, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (field in step2Errors) setStep2Errors(e => ({ ...e, [field]: undefined }));
    if (field in step3Errors) setStep3Errors(e => ({ ...e, [field]: undefined }));
    if (field in step4Errors) setStep4Errors(e => ({ ...e, [field]: undefined }));
  }

  useEffect(() => {
    const el = document.getElementById("step-announcement");
    if (el) el.textContent = `Step ${currentStep} of ${TOTAL_STEPS}: ${
      ["Video source", "Content", "Schedule", "Publishing"][currentStep - 1]
    }`;
  }, [currentStep]);

  function handleNext() {
    if (currentStep === 2) {
      const errs = validateStep2(form);
      setStep2Errors(errs);
      if (hasErrors(errs)) return;
    }
    if (currentStep === 3) {
      const errs = validateStep3(form);
      setStep3Errors(errs);
      if (hasErrors(errs)) return;
    }
    setCurrentStep(s => Math.min(s + 1, TOTAL_STEPS));
    setGlobalError(null);
  }

  function handleBack() {
    setCurrentStep(s => Math.max(s - 1, 1));
    setGlobalError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const errs = validateStep4(form);
    setStep4Errors(errs);
    if (hasErrors(errs)) return;

    setSubmitting(true);
    setGlobalError(null);
    setLimitReached(false);

    try {
      const csrfToken = await fetchCsrfToken().catch(() => "");

      const supabase = (await import("@/lib/supabase/client")).createClient();
      const { data: { session } } = await supabase.auth.getSession();

      // Map language display name → language code (HeyGen/OpenAI prefer short codes)
      const langMap: Record<string, string> = {
        English: "English", Spanish: "Spanish", French: "French",
        German: "German", Portuguese: "Portuguese", Arabic: "Arabic",
        Hindi: "Hindi", Japanese: "Japanese", Korean: "Korean", Chinese: "Chinese",
      };

      const payload: Record<string, unknown> = {
        name:                 form.name.trim(),
        niche_keyword:        (form.niche_keyword.trim() || form.name.trim()),
        publishing_platforms: form.selected_platforms,
        schedule_recurrence:  form.recurrence,
        schedule_time_hhmm:   form.time,
        schedule_timezone:    form.timezone,
        ...(form.recurrence === "custom" ? { schedule_days_of_week: form.custom_days } : {}),
        // Optional config
        ...(form.heygen_avatar_id.trim() ? { heygen_avatar_id: form.heygen_avatar_id.trim() } : {}),
        ...(form.script_tone            ? { script_tone: form.script_tone } : {}),
        ...(form.video_language         ? { video_language: langMap[form.video_language] ?? form.video_language } : {}),
        ...(form.openai_model           ? { openai_model: form.openai_model } : {}),
        ...(form.target_duration_secs   ? { target_duration_secs: form.target_duration_secs } : {}),
        ...(form.save_to_drive && form.gdrive_folder_id.trim()
          ? { gdrive_folder_id: form.gdrive_folder_id.trim() }
          : {}),
      };

      const res = await fetch(`${API_BASE}/pipelines`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken                  ? { "X-CSRF-Token": csrfToken } : {}),
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/dashboard");
        return;
      }

      const data: ApiError = await res.json().catch(() => ({}));

      if (data.error_code === "pipeline_limit_reached" ||
          (data.message ?? "").toLowerCase().includes("pipeline limit")) {
        setLimitReached(true);
        return;
      }

      // HeyGen key missing — show helpful message instead of raw API error
      if ((data.message ?? "").toLowerCase().includes("heygen")) {
        setGlobalError("HeyGen API key not found. Add it in Settings → Credentials, then try again.");
        return;
      }

      setGlobalError(data.message ?? "An unexpected error occurred. Please try again.");
    } catch {
      setGlobalError("Unable to reach the server. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = ["Source", "Content", "Schedule", "Publish"];

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <div id="step-announcement" aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Create a pipeline</h1>
        <p className="mt-1 text-sm text-gray-500">
          Set up an automated video production and publishing workflow.
        </p>
      </div>

      {/* Pipeline limit banner */}
      {limitReached && (
        <div role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="font-semibold text-amber-800">Pipeline limit reached</p>
          <p className="mt-1 text-sm text-amber-700">Upgrade your plan to create more pipelines.</p>
          <Link
            href="/settings/billing"
            className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500"
          >
            Upgrade plan
          </Link>
        </div>
      )}

      <StepIndicator current={currentStep} total={TOTAL_STEPS} labels={stepLabels} />

      {globalError && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {globalError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">

          {currentStep === 1 && (
            <Step1VideoSource form={form} credentials={credentials} onChange={updateField} />
          )}
          {currentStep === 2 && form.video_source === "heygen" && (
            <Step2HeyGen form={form} errors={step2Errors} credentials={credentials} onChange={updateField} />
          )}
          {currentStep === 2 && form.video_source === "drive" && (
            <Step2Drive form={form} onChange={updateField} />
          )}
          {currentStep === 3 && (
            <Step3Schedule form={form} errors={step3Errors} onChange={updateField} />
          )}
          {currentStep === 4 && (
            credsLoading
              ? <div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Spinner />Loading credentials…</div>
              : <Step4Publish form={form} errors={step4Errors} credentials={credentials} onChange={updateField} />
          )}

        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>

          {currentStep < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Continue →
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
