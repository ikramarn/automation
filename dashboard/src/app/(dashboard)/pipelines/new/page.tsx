"use client";

/**
 * Pipeline creation wizard — /pipelines/new
 *
 * 4-step wizard. Step 1 asks WHERE the script/content comes from, which
 * drives the rest of the form:
 *
 *   Step 1 — Content source : openai | agent | custom_script | drive
 *   Step 2 — Content config  : adapts completely per source choice
 *   Step 3 — Schedule        : recurrence, time, timezone
 *   Step 4 — Publish         : platforms + Google Drive storage
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

type ContentSource = "openai" | "agent" | "custom_script" | "drive";
type Recurrence    = "daily" | "weekdays" | "custom";
type Platform      = "youtube" | "tiktok" | "facebook" | "instagram";

interface ConnectedCredentials {
  hasHeyGen: boolean;
  hasOpenAI: boolean;
  hasDrive: boolean;
  connectedPlatforms: Platform[];
}

interface FormState {
  // Step 1 — content source
  content_source: ContentSource;
  name: string;

  // Step 2 — OpenAI path
  niche_keyword: string;
  script_tone: string;
  openai_model: string;
  target_duration_secs: number;

  // Step 2 — Agent path
  heygen_agent_prompt: string;
  heygen_orientation: "portrait" | "landscape";

  // Step 2 — Custom script path
  heygen_custom_script: string;

  // Step 2 — Drive path
  drive_source_folder_id: string;

  // Step 2 — Shared HeyGen settings (classic + custom_script)
  heygen_engine: "avatar_iv" | "avatar_v" | "avatar_iii";
  heygen_avatar_id: string;
  heygen_voice_id: string;
  heygen_resolution: "1080p" | "720p" | "4k";
  heygen_aspect_ratio: "9:16" | "16:9" | "1:1" | "4:5";
  heygen_motion_prompt: string;
  video_language: string;

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
  youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram",
};
const PLATFORM_ICONS: Record<Platform, string> = {
  youtube: "▶", tiktok: "♪", facebook: "f", instagram: "◈",
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
  { value: "professional", label: "Professional" },
  { value: "casual",       label: "Casual" },
  { value: "educational",  label: "Educational" },
  { value: "entertaining", label: "Entertaining" },
  { value: "energetic",    label: "Energetic" },
];

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (fast, recommended)" },
  { value: "gpt-4o",      label: "GPT-4o (higher quality)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

const HEYGEN_ENGINES = [
  {
    value: "avatar_iv",
    label: "Avatar IV — Standard",
    desc: "Default engine. Expressive facial + head motion. Great for most use cases.",
    badge: "Recommended", badgeColor: "bg-indigo-100 text-indigo-700",
    credits: "20 credits/min",
  },
  {
    value: "avatar_v",
    label: "Avatar V — Premium",
    desc: "Highest fidelity. Full-body realism and cinematic lip-sync.",
    badge: "Best Quality", badgeColor: "bg-purple-100 text-purple-700",
    credits: "20 credits/min",
  },
  {
    value: "avatar_iii",
    label: "Avatar III — Fast",
    desc: "Fastest rendering. Precise lip-sync. Best for photo avatars.",
    badge: "Cheapest", badgeColor: "bg-green-100 text-green-700",
    credits: "3 credits/min",
  },
] as const;

const HEYGEN_RESOLUTIONS = [
  { value: "1080p", label: "1080p Full HD (recommended)" },
  { value: "720p",  label: "720p HD (faster render)" },
  { value: "4k",    label: "4K (Avatar III only)" },
];

const HEYGEN_ASPECT_RATIOS = [
  { value: "9:16",  label: "9:16 Portrait — TikTok / Reels / Shorts" },
  { value: "16:9",  label: "16:9 Landscape — YouTube" },
  { value: "1:1",   label: "1:1 Square — Instagram feed" },
  { value: "4:5",   label: "4:5 Vertical — Instagram" },
];

const COMMON_TIMEZONES = [
  "UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Toronto","America/Sao_Paulo","America/Mexico_City",
  "Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Moscow",
  "Africa/Cairo","Africa/Johannesburg","Africa/Lagos",
  "Asia/Dubai","Asia/Kolkata","Asia/Dhaka","Asia/Bangkok","Asia/Singapore",
  "Asia/Hong_Kong","Asia/Shanghai","Asia/Tokyo","Asia/Seoul",
  "Australia/Sydney","Australia/Melbourne","Pacific/Auckland",
];
const TIMEZONE_OPTIONS = [...new Set(COMMON_TIMEZONES)].sort();

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchConnectedCredentials(url: string): Promise<ConnectedCredentials> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });
  if (!res.ok) return { hasHeyGen: false, hasOpenAI: false, hasDrive: false, connectedPlatforms: [] };

  const json = await res.json().catch(() => []);
  const data: Array<{ credential_type: string; status: string }> =
    Array.isArray(json) ? json : (json?.data ?? []);

  const active = (type: string) => data.some(c => c.credential_type === type && c.status === "active");
  const platforms: Platform[] = ["youtube", "tiktok", "facebook", "instagram"];

  return {
    hasHeyGen:  active("heygen_api_key"),
    hasOpenAI:  active("openai_api_key"),
    hasDrive:   active("google_drive_refresh_token"),
    connectedPlatforms: platforms.filter(p => active(`${p}_access_token`)),
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

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
      {children}
    </div>
  );
}

function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <nav aria-label="Pipeline creation steps" className="mb-8">
      <ol className="flex items-center gap-0">
        {labels.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          return (
            <li key={label} className={`flex items-center ${i < total - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center shrink-0">
                <span
                  aria-current={active ? "step" : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    done ? "bg-indigo-600 text-white" :
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
// HeyGen avatar/voice/engine shared block
// ---------------------------------------------------------------------------

function HeyGenVideoSettings({
  form,
  onChange,
  showEngine = true,
}: {
  form: FormState;
  onChange: (field: keyof FormState, value: unknown) => void;
  showEngine?: boolean;
}) {
  return (
    <>
      {showEngine && (
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-gray-700">Rendering engine</p>
          <div className="grid gap-2">
            {HEYGEN_ENGINES.map(eng => (
              <label key={eng.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-all ${
                  form.heygen_engine === eng.value ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <input type="radio" name="heygen_engine" value={eng.value}
                  checked={form.heygen_engine === eng.value}
                  onChange={() => onChange("heygen_engine", eng.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{eng.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${eng.badgeColor}`}>{eng.badge}</span>
                    <span className="ml-auto text-xs text-gray-400">{eng.credits}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{eng.desc}</p>
                </div>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">Avatar III = 3 credits/min vs 20 for IV/V.</p>
        </div>
      )}

      {/* Avatar + Voice */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="hav-id" className="mb-1 block text-sm font-medium text-gray-700">
            Avatar ID <span className="text-xs font-normal text-gray-400">(optional)</span>
          </label>
          <input id="hav-id" type="text" value={form.heygen_avatar_id}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_avatar_id", e.target.value)}
            placeholder="e.g. avatar_abc123"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-400">HeyGen → Avatars → look ID. Blank = account default.</p>
        </div>
        <div>
          <label htmlFor="hvoice-id" className="mb-1 block text-sm font-medium text-gray-700">
            Voice ID <span className="text-xs font-normal text-gray-400">(optional)</span>
          </label>
          <input id="hvoice-id" type="text" value={form.heygen_voice_id}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_voice_id", e.target.value)}
            placeholder="e.g. voice_en_us_abc"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-400">Blank = avatar&apos;s default voice.</p>
        </div>
      </div>

      {/* Resolution + Aspect ratio */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="h-res" className="mb-1 block text-sm font-medium text-gray-700">Resolution</label>
          <select id="h-res" value={form.heygen_resolution}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("heygen_resolution", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {HEYGEN_RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="h-ar" className="mb-1 block text-sm font-medium text-gray-700">Aspect ratio</label>
          <select id="h-ar" value={form.heygen_aspect_ratio}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("heygen_aspect_ratio", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {HEYGEN_ASPECT_RATIOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* Language */}
      <div className="mb-5">
        <label htmlFor="h-lang" className="mb-1 block text-sm font-medium text-gray-700">Video language</label>
        <select id="h-lang" value={form.video_language}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("video_language", e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Motion prompt (advanced, Avatar V / photo avatars) */}
      {(form.heygen_engine === "avatar_v" || form.heygen_engine === "avatar_iii") && (
        <div className="mb-5">
          <label htmlFor="motion-p" className="mb-1 block text-sm font-medium text-gray-700">
            Motion prompt <span className="text-xs font-normal text-gray-400">(Avatar V + photo avatars)</span>
          </label>
          <input id="motion-p" type="text" value={form.heygen_motion_prompt}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_motion_prompt", e.target.value)}
            placeholder="e.g. Speak with hand gestures, look directly at camera"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Content source
// ---------------------------------------------------------------------------

function Step1ContentSource({
  form,
  credentials,
  onChange,
}: {
  form: FormState;
  credentials: ConnectedCredentials | undefined;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  const options: Array<{
    value: ContentSource;
    icon: string;
    title: string;
    desc: string;
    tags: string[];
    tagColor: string;
    badge?: string;
    warn?: string;
  }> = [
    {
      value: "openai",
      icon: "📰",
      title: "News article → OpenAI script → HeyGen",
      desc: "AutoFlow fetches a fresh news article on your niche every run, writes a script with OpenAI, then renders an AI avatar video with HeyGen. Fully hands-free.",
      tags: ["News", "OpenAI", "HeyGen"],
      tagColor: "bg-purple-100 text-purple-700",
      warn: !credentials?.hasHeyGen ? "HeyGen API key required" : undefined,
    },
    {
      value: "agent",
      icon: "✨",
      title: "HeyGen Video Agent (prompt only)",
      desc: "You describe the video you want in plain language. HeyGen picks the avatar, writes the script, composes scenes, and renders — no OpenAI key needed.",
      tags: ["HeyGen Agent", "No OpenAI"],
      tagColor: "bg-blue-100 text-blue-700",
      warn: !credentials?.hasHeyGen ? "HeyGen API key required" : undefined,
    },
    {
      value: "custom_script",
      icon: "✍️",
      title: "Your own script → HeyGen",
      desc: "You write or paste the exact script. HeyGen renders your avatar speaking it. No news fetching, no OpenAI — you control every word.",
      tags: ["Your script", "HeyGen"],
      tagColor: "bg-emerald-100 text-emerald-700",
      warn: !credentials?.hasHeyGen ? "HeyGen API key required" : undefined,
    },
    {
      value: "drive",
      icon: "📁",
      title: "Your own video from Google Drive",
      desc: "Point to a Google Drive folder containing your pre-made videos. AutoFlow picks them up and publishes on schedule — no generation at all.",
      tags: ["Google Drive", "Your videos"],
      tagColor: "bg-amber-100 text-amber-700",
      badge: "Coming soon",
    },
  ];

  return (
    <fieldset>
      <legend className="mb-6 text-base font-semibold text-gray-900">
        Where does the script / content come from?
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(opt => (
          <label key={opt.value}
            className={`relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 p-5 transition-all ${
              form.content_source === opt.value
                ? "border-indigo-500 bg-indigo-50"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <input type="radio" name="content_source" value={opt.value}
              checked={form.content_source === opt.value}
              onChange={() => onChange("content_source", opt.value)}
              className="sr-only"
            />
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-2xl">
                {opt.icon}
              </div>
              <div className="flex items-center gap-2">
                {opt.badge && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{opt.badge}</span>
                )}
                {form.content_source === opt.value && (
                  <svg className="h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{opt.title}</p>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">{opt.desc}</p>
            </div>
            {opt.warn && (
              <p className="text-xs text-amber-600">
                ⚠ {opt.warn}.{" "}
                <Link href="/settings/credentials" className="underline">Add it in Credentials</Link>
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-1">
              {opt.tags.map(t => (
                <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-medium ${opt.tagColor}`}>{t}</span>
              ))}
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Content config (adapts per content_source)
// ---------------------------------------------------------------------------

interface Step2Errors extends Record<string, string | undefined> {
  name?: string;
  niche_keyword?: string;
  heygen_custom_script?: string;
}

function Step2Content({
  form,
  errors,
  credentials,
  onChange,
}: {
  form: FormState;
  errors: Step2Errors;
  credentials: ConnectedCredentials | undefined;
  onChange: (field: keyof FormState, value: unknown) => void;
}) {
  const src = form.content_source;

  return (
    <fieldset>
      <legend className="sr-only">Content configuration</legend>

      {/* Pipeline name — always shown */}
      <div className="mb-5">
        <label htmlFor="pipeline-name" className="mb-1 block text-sm font-medium text-gray-700">
          Pipeline name <span className="text-red-500">*</span>
        </label>
        <input id="pipeline-name" type="text"
          value={form.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("name", e.target.value)}
          maxLength={100} placeholder="e.g. Tech News Daily"
          aria-invalid={!!errors.name}
          className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            errors.name ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <FieldError message={errors.name} />
      </div>

      {/* ── OPENAI path ── */}
      {src === "openai" && (
        <>
          {credentials && !credentials.hasHeyGen && (
            <Warn><strong>HeyGen API key not found.</strong> Add it in <Link href="/settings/credentials" className="underline">Credentials</Link> before running this pipeline.</Warn>
          )}
          {credentials && !credentials.hasOpenAI && (
            <Info>No personal OpenAI key saved — the pipeline will use the platform key as a fallback.</Info>
          )}

          <div className="mb-5">
            <label htmlFor="niche-keyword" className="mb-1 block text-sm font-medium text-gray-700">
              Niche keyword <span className="text-red-500">*</span>
            </label>
            <input id="niche-keyword" type="text"
              value={form.niche_keyword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
              maxLength={200} placeholder="e.g. artificial intelligence, crypto, fitness"
              aria-invalid={!!errors.niche_keyword}
              className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
                errors.niche_keyword ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
              }`}
            />
            <p className="mt-1 text-xs text-gray-400">
              AutoFlow searches Google News for recent articles on this topic — one article per execution.
            </p>
            <FieldError message={errors.niche_keyword} />
          </div>

          {/* Tone + OpenAI model */}
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tone" className="mb-1 block text-sm font-medium text-gray-700">Script tone</label>
              <select id="tone" value={form.script_tone}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("script_tone", e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="oai-model" className="mb-1 block text-sm font-medium text-gray-700">OpenAI model</label>
              <select id="oai-model" value={form.openai_model}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("openai_model", e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {OPENAI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* Duration */}
          <div className="mb-6">
            <label htmlFor="dur" className="mb-1 block text-sm font-medium text-gray-700">
              Target video duration: <strong>{form.target_duration_secs}s</strong>
            </label>
            <input id="dur" type="range" min={30} max={300} step={15}
              value={form.target_duration_secs}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("target_duration_secs", Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>30s</span><span>1 min</span><span>2.5 min</span><span>5 min</span>
            </div>
          </div>

          <HeyGenVideoSettings form={form} onChange={onChange} />
        </>
      )}

      {/* ── AGENT path ── */}
      {src === "agent" && (
        <>
          {credentials && !credentials.hasHeyGen && (
            <Warn><strong>HeyGen API key not found.</strong> Add it in <Link href="/settings/credentials" className="underline">Credentials</Link>.</Warn>
          )}
          <Info>
            <strong>HeyGen Video Agent</strong> handles scripting, avatar selection, and scene composition automatically.
            Describe the video you want — or leave blank and AutoFlow will build a prompt from the niche keyword + news article.
          </Info>

          {/* Niche — for auto-prompt fallback */}
          <div className="mb-5">
            <label htmlFor="niche-agent" className="mb-1 block text-sm font-medium text-gray-700">
              Niche keyword <span className="text-xs font-normal text-gray-400">(for auto-prompt)</span>
            </label>
            <input id="niche-agent" type="text"
              value={form.niche_keyword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
              maxLength={200} placeholder="e.g. artificial intelligence, crypto"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Custom prompt */}
          <div className="mb-5">
            <label htmlFor="agent-prompt" className="mb-1 block text-sm font-medium text-gray-700">
              Video Agent prompt <span className="text-xs font-normal text-gray-400">(optional — overrides auto-prompt)</span>
            </label>
            <textarea id="agent-prompt" rows={4}
              value={form.heygen_agent_prompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange("heygen_agent_prompt", e.target.value)}
              placeholder="e.g. Create a 60-second professional video about the latest AI breakthroughs. Portrait, suitable for TikTok and Instagram Reels."
              maxLength={2000}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">Max 2,000 characters. HeyGen picks avatar and style automatically.</p>
          </div>

          {/* Orientation */}
          <div className="mb-5">
            <p className="mb-2 text-sm font-medium text-gray-700">Orientation</p>
            <div className="flex gap-3">
              {[
                { value: "portrait" as const, label: "Portrait (9:16)", hint: "TikTok, Reels, Shorts" },
                { value: "landscape" as const, label: "Landscape (16:9)", hint: "YouTube, LinkedIn" },
              ].map(o => (
                <label key={o.value}
                  className={`flex flex-1 cursor-pointer flex-col gap-1 rounded-xl border-2 p-3 transition-all ${
                    form.heygen_orientation === o.value ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input type="radio" name="h-orient" value={o.value}
                    checked={form.heygen_orientation === o.value}
                    onChange={() => onChange("heygen_orientation", o.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-gray-900">{o.label}</span>
                  <span className="text-xs text-gray-400">{o.hint}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional avatar/voice hint */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="agent-av" className="mb-1 block text-sm font-medium text-gray-700">
                Preferred avatar <span className="text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <input id="agent-av" type="text" value={form.heygen_avatar_id}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_avatar_id", e.target.value)}
                placeholder="Leave blank — agent chooses"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="agent-voice" className="mb-1 block text-sm font-medium text-gray-700">
                Preferred voice <span className="text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <input id="agent-voice" type="text" value={form.heygen_voice_id}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("heygen_voice_id", e.target.value)}
                placeholder="Leave blank — agent chooses"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </>
      )}

      {/* ── CUSTOM SCRIPT path ── */}
      {src === "custom_script" && (
        <>
          {credentials && !credentials.hasHeyGen && (
            <Warn><strong>HeyGen API key not found.</strong> Add it in <Link href="/settings/credentials" className="underline">Credentials</Link>.</Warn>
          )}
          <Info>
            Write your script once — HeyGen renders your avatar speaking it on every execution.
            The same script runs each time unless you update the pipeline.
          </Info>

          <div className="mb-5">
            <label htmlFor="custom-script" className="mb-1 block text-sm font-medium text-gray-700">
              Your script <span className="text-red-500">*</span>
            </label>
            <textarea id="custom-script" rows={8}
              value={form.heygen_custom_script}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange("heygen_custom_script", e.target.value)}
              placeholder="Write your complete video script here. This is the exact text HeyGen will speak."
              maxLength={5000}
              aria-invalid={!!errors.heygen_custom_script}
              className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
                errors.heygen_custom_script ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
              }`}
            />
            <div className="mt-1 flex justify-between">
              <FieldError message={errors.heygen_custom_script} />
              <span className="text-xs text-gray-400">{form.heygen_custom_script.length}/5000</span>
            </div>
          </div>

          {/* Niche keyword — used for captions/hashtags when publishing */}
          <div className="mb-5">
            <label htmlFor="niche-custom" className="mb-1 block text-sm font-medium text-gray-700">
              Topic / niche <span className="text-xs font-normal text-gray-400">(for captions)</span>
            </label>
            <input id="niche-custom" type="text"
              value={form.niche_keyword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
              maxLength={200} placeholder="e.g. AI tips, fitness motivation"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">Used to generate hashtags and social captions for your posts.</p>
          </div>

          <HeyGenVideoSettings form={form} onChange={onChange} />
        </>
      )}

      {/* ── DRIVE path ── */}
      {src === "drive" && (
        <>
          <Info>
            <strong>Drive upload pipelines are coming soon.</strong> Configure it now — once launched,
            AutoFlow will pick up videos from your Drive folder and publish on schedule automatically.
          </Info>
          {credentials && !credentials.hasDrive && (
            <Warn>Google Drive not connected. <Link href="/settings/credentials" className="underline">Connect Drive</Link> first.</Warn>
          )}

          <div className="mb-5">
            <label htmlFor="drive-folder" className="mb-1 block text-sm font-medium text-gray-700">
              Source Google Drive folder ID <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <input id="drive-folder" type="text"
              value={form.drive_source_folder_id}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("drive_source_folder_id", e.target.value)}
              placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              Open folder in Drive → the ID is the last part of the URL.
            </p>
          </div>

          <div className="mb-5">
            <label htmlFor="niche-drive" className="mb-1 block text-sm font-medium text-gray-700">
              Content topic <span className="text-xs font-normal text-gray-400">(for captions)</span>
            </label>
            <input id="niche-drive" type="text"
              value={form.niche_keyword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("niche_keyword", e.target.value)}
              maxLength={200} placeholder="e.g. travel vlogs, cooking tutorials"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </>
      )}
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

      <div className="mb-5">
        <span className="mb-2 block text-sm font-medium text-gray-700">Recurrence <span className="text-red-500">*</span></span>
        <div className="flex flex-wrap gap-3">
          {(["daily", "weekdays", "custom"] as Recurrence[]).map(opt => (
            <label key={opt}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                form.recurrence === opt ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <input type="radio" name="recurrence" value={opt}
                checked={form.recurrence === opt}
                onChange={() => onChange("recurrence", opt)}
                className="sr-only"
              />
              {opt === "daily" ? "Every day" : opt === "weekdays" ? "Weekdays (Mon–Fri)" : "Custom days"}
            </label>
          ))}
        </div>
      </div>

      {form.recurrence === "custom" && (
        <div className="mb-5">
          <span className="mb-2 block text-sm font-medium text-gray-700">Select days <span className="text-red-500">*</span></span>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((day, i) => {
              const sel = form.custom_days.includes(i);
              return (
                <button key={day} type="button" onClick={() => toggleDay(i)} aria-pressed={sel}
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

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sched-time" className="mb-1 block text-sm font-medium text-gray-700">Time <span className="text-red-500">*</span></label>
          <input id="sched-time" type="time" value={form.time}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("time", e.target.value)}
            className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
              errors.time ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />
          <FieldError message={errors.time} />
        </div>
        <div>
          <label htmlFor="sched-tz" className="mb-1 block text-sm font-medium text-gray-700">Timezone <span className="text-red-500">*</span></label>
          <select id="sched-tz" value={form.timezone}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange("timezone", e.target.value)}
            className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
              errors.timezone ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          >
            <option value="" disabled>Select timezone…</option>
            {TIMEZONE_OPTIONS.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
          </select>
          <FieldError message={errors.timezone} />
        </div>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Publish destinations
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

      <div className="mb-6">
        <p className="mb-1 text-sm font-medium text-gray-700">Social platforms <span className="text-red-500">*</span></p>
        <p className="mb-4 text-xs text-gray-400">Select at least one connected platform to publish to.</p>

        {connected.length === 0 && (
          <Warn>No platforms connected. <Link href="/settings/credentials" className="underline font-medium">Connect platforms</Link> in Settings → Credentials.</Warn>
        )}

        {connected.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {connected.map(p => {
              const sel = form.selected_platforms.includes(p);
              return (
                <label key={p}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${
                    sel ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input type="checkbox" checked={sel} onChange={() => togglePlatform(p)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${PLATFORM_COLORS[p]}`}>
                    {PLATFORM_ICONS[p]}
                  </span>
                  <span className={`text-sm font-medium ${sel ? "text-indigo-700" : "text-gray-700"}`}>{PLATFORM_DISPLAY[p]}</span>
                  <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Connected</span>
                </label>
              );
            })}
          </div>
        )}

        {disconnected.length > 0 && (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Not connected</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {disconnected.map(p => (
                <Link key={p} href="/settings/credentials"
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 opacity-60 transition hover:opacity-80"
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${PLATFORM_COLORS[p]}`}>{PLATFORM_ICONS[p]}</span>
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
          <input id="save-drive" type="checkbox"
            checked={form.save_to_drive}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("save_to_drive", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div className="flex-1">
            <label htmlFor="save-drive" className="cursor-pointer text-sm font-medium text-gray-900">
              Also save each video to Google Drive
            </label>
            <p className="mt-0.5 text-xs text-gray-400">Every generated video will be backed up to a Drive folder.</p>
            {credentials && !credentials.hasDrive && form.save_to_drive && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ Google Drive not connected. <Link href="/settings/credentials" className="underline">Connect it first</Link>.
              </p>
            )}
          </div>
        </div>

        {form.save_to_drive && (
          <div className="mt-4">
            <label htmlFor="gdrive-folder" className="mb-1 block text-sm font-medium text-gray-700">
              Google Drive folder ID <span className="text-xs font-normal text-gray-400">(optional — saves to root if blank)</span>
            </label>
            <input id="gdrive-folder" type="text"
              value={form.gdrive_folder_id}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange("gdrive_folder_id", e.target.value)}
              placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-400">Open the folder in Drive — the ID is at the end of the URL.</p>
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
  if (!form.name.trim())            e.name = "Pipeline name is required.";
  else if (form.name.length > 100)  e.name = "Must be 100 characters or fewer.";

  if (form.content_source === "openai") {
    if (!form.niche_keyword.trim()) e.niche_keyword = "Niche keyword is required for the OpenAI path.";
  }
  if (form.content_source === "custom_script") {
    if (!form.heygen_custom_script.trim()) e.heygen_custom_script = "Script text is required.";
    else if (form.heygen_custom_script.length > 5000) e.heygen_custom_script = "Max 5,000 characters.";
  }
  return e;
}

function validateStep3(form: FormState): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (!form.time)     e.time     = "Please set a time.";
  if (!form.timezone) e.timezone = "Please select a timezone.";
  if (form.recurrence === "custom" && form.custom_days.length === 0)
    e.custom_days = "Select at least one day.";
  return e;
}

function validateStep4(form: FormState): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (form.selected_platforms.length === 0)
    e.selected_platforms = "Select at least one platform.";
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
    ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  const [form, setForm] = useState<FormState>({
    content_source:       "openai",
    name:                 "",
    niche_keyword:        "",
    script_tone:          "professional",
    openai_model:         "gpt-4o-mini",
    target_duration_secs: 60,
    heygen_agent_prompt:  "",
    heygen_orientation:   "portrait",
    heygen_custom_script: "",
    drive_source_folder_id: "",
    heygen_engine:        "avatar_iv",
    heygen_avatar_id:     "",
    heygen_voice_id:      "",
    heygen_resolution:    "1080p",
    heygen_aspect_ratio:  "9:16",
    heygen_motion_prompt: "",
    video_language:       "English",
    recurrence:           "daily",
    time:                 "09:00",
    timezone:             TIMEZONE_OPTIONS.includes(localTz) ? localTz : "UTC",
    custom_days:          [],
    selected_platforms:   [],
    save_to_drive:        false,
    gdrive_folder_id:     "",
  });

  const { data: credentials, isLoading: credsLoading } = useSWR<ConnectedCredentials>(
    `${API_BASE}/credentials`,
    fetchConnectedCredentials,
    { revalidateOnFocus: false }
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
      ["Content source", "Content config", "Schedule", "Publishing"][currentStep - 1]
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
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const payload: Record<string, unknown> = {
        name:                 form.name.trim(),
        niche_keyword:        form.niche_keyword.trim() || form.name.trim(),
        content_source:       form.content_source,
        publishing_platforms: form.selected_platforms,
        schedule_recurrence:  form.recurrence,
        schedule_time_hhmm:   form.time,
        schedule_timezone:    form.timezone,
        ...(form.recurrence === "custom" ? { schedule_days_of_week: form.custom_days } : {}),
        // HeyGen settings
        heygen_engine:        form.heygen_engine,
        heygen_mode:          form.content_source === "agent" ? "agent" : "classic",
        ...(form.heygen_avatar_id.trim()     ? { heygen_avatar_id:     form.heygen_avatar_id.trim() }     : {}),
        ...(form.heygen_voice_id.trim()      ? { heygen_voice_id:      form.heygen_voice_id.trim() }      : {}),
        heygen_resolution:    form.heygen_resolution,
        heygen_aspect_ratio:  form.heygen_aspect_ratio,
        ...(form.heygen_motion_prompt.trim() ? { heygen_motion_prompt: form.heygen_motion_prompt.trim() } : {}),
        ...(form.heygen_agent_prompt.trim()  ? { heygen_agent_prompt:  form.heygen_agent_prompt.trim() }  : {}),
        heygen_orientation:   form.heygen_orientation,
        ...(form.content_source === "custom_script" ? { heygen_custom_script: form.heygen_custom_script.trim() } : {}),
        // Script/content config
        ...(form.script_tone           ? { script_tone:           form.script_tone }           : {}),
        ...(form.video_language        ? { video_language:        form.video_language }         : {}),
        ...(form.openai_model          ? { openai_model:          form.openai_model }           : {}),
        ...(form.target_duration_secs  ? { target_duration_secs:  form.target_duration_secs }   : {}),
        // Drive storage
        ...(form.save_to_drive && form.gdrive_folder_id.trim()
          ? { gdrive_folder_id: form.gdrive_folder_id.trim() } : {}),
      };

      const res = await fetch(`${API_BASE}/pipelines`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) { router.push("/dashboard"); return; }

      const data: ApiError = await res.json().catch(() => ({}));

      if (data.error_code === "pipeline_limit_reached" || (data.message ?? "").toLowerCase().includes("pipeline limit")) {
        setLimitReached(true); return;
      }
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

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Create a pipeline</h1>
        <p className="mt-1 text-sm text-gray-500">Set up an automated video production and publishing workflow.</p>
      </div>

      {limitReached && (
        <div role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="font-semibold text-amber-800">Pipeline limit reached</p>
          <p className="mt-1 text-sm text-amber-700">Upgrade your plan to create more pipelines.</p>
          <Link href="/settings/billing"
            className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500">
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
            <Step1ContentSource form={form} credentials={credentials} onChange={updateField} />
          )}
          {currentStep === 2 && (
            <Step2Content form={form} errors={step2Errors} credentials={credentials} onChange={updateField} />
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

        <div className="mt-6 flex items-center justify-between">
          <button type="button" onClick={handleBack} disabled={currentStep === 1}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
            Back
          </button>

          {currentStep < TOTAL_STEPS ? (
            <button type="button" onClick={handleNext}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
              Continue →
            </button>
          ) : (
            <button type="submit" disabled={submitting} aria-busy={submitting}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting && <Spinner className="h-4 w-4" />}
              {submitting ? "Creating…" : "Create pipeline"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
