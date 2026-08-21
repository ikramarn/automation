"use client";

/**
 * Execution detail page — /executions/:id
 *
 * Shows full execution metadata and per-step statuses including:
 * - Start/end time, duration
 * - Per-step statuses (content fetch, script generation, video generation,
 *   drive upload, per-platform publish)
 * - Generated script text (collapsible)
 * - Video/Drive link (if available)
 * - Failure reason formatted as "[step name]: [error description]"
 *
 * Requirements: 13.4
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types — mirrors the API response from GET /executions/:id
// ---------------------------------------------------------------------------

type OverallStatus = "running" | "success" | "failed" | "partial" | "skipped";

interface SocialPublishPlatformResult {
  status: "success" | "failed" | "skipped";
  post_id?: string;
  ayrshare_post_id?: string;
  error?: string;
}

interface StepStatuses {
  content_fetch: string | null;
  script_generation: string | null;
  video_generation: string | null;
  drive_upload: string | null;
  social_publish: Record<string, SocialPublishPlatformResult> | null;
}

interface ExecutionDetail {
  id: string;
  pipeline_id: string;
  status: OverallStatus;
  started_at: string;
  /** ISO timestamp or "in progress" */
  ended_at: string | "in progress";
  duration_ms: number | null;
  failure_reason: string | null;
  step_statuses: StepStatuses;
  script_text: string | null;
  video_link: string | null;
  heygen_video_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchExecution(url: string): Promise<ExecutionDetail> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch execution: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | null | undefined | "in progress"): string {
  if (!iso) return "—";
  if (iso === "in progress") return "In progress";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

const OVERALL_STATUS_STYLES: Record<OverallStatus, string> = {
  success: "bg-green-100 text-green-700 ring-green-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  partial: "bg-amber-100 text-amber-700 ring-amber-200",
  skipped: "bg-gray-100 text-gray-500 ring-gray-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
};

const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  success: "Succeeded",
  failed: "Failed",
  partial: "Partial success",
  skipped: "Skipped",
  running: "Running",
};

type StepState = "success" | "failed" | "running" | "skipped" | "pending" | string;

/**
 * Derive a normalized step state from the raw step value returned by the API.
 * The API returns either a formatted "[step name]: [error]" string for failed
 * steps, or the raw status string (success / failed / running / skipped).
 */
function classifyStepState(raw: string | null): StepState {
  if (!raw) return "pending";
  const lower = raw.toLowerCase();
  if (lower === "success" || lower === "completed") return "success";
  if (lower === "running" || lower === "in_progress") return "running";
  if (lower === "skipped" || lower.startsWith("skipped:")) return "skipped";
  // If the value contains a colon it was formatted as "[step name]: [error]"
  if (raw.includes(":")) return "failed";
  if (lower === "failed") return "failed";
  return raw; // unknown
}

const STEP_STATE_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-700 ring-green-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
  skipped: "bg-gray-100 text-gray-500 ring-gray-200",
  pending: "bg-gray-50 text-gray-400 ring-gray-100",
};

const STEP_STATE_LABELS: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  running: "Running",
  skipped: "Skipped",
  pending: "Pending",
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex justify-center py-16" aria-label={label} role="status">
      <svg
        aria-hidden="true"
        className="h-8 w-8 animate-spin text-indigo-600"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

function OverallStatusBadge({ status }: { status: OverallStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${OVERALL_STATUS_STYLES[status]}`}
      aria-label={`Execution status: ${OVERALL_STATUS_LABELS[status]}`}
    >
      {OVERALL_STATUS_LABELS[status]}
    </span>
  );
}

function StepBadge({ state }: { state: StepState }) {
  const styles = STEP_STATE_STYLES[state] ?? STEP_STATE_STYLES["pending"];
  const label = STEP_STATE_LABELS[state] ?? state;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-32 shrink-0 text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step status table
// ---------------------------------------------------------------------------

interface PipelineStep {
  key: string;
  label: string;
  rawValue: string | null;
}

function StepStatusTable({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200" aria-label="Per-step execution status">
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 sm:pl-6"
            >
              Step
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Detail
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {steps.map(({ key, label, rawValue }) => {
            const state = classifyStepState(rawValue);
            // Show raw value as detail only when it contains useful info beyond the badge
            const showDetail =
              rawValue &&
              rawValue !== state &&
              rawValue.toLowerCase() !== "success" &&
              rawValue.toLowerCase() !== "failed" &&
              rawValue.toLowerCase() !== "running" &&
              rawValue.toLowerCase() !== "skipped";

            return (
              <tr key={key} className="hover:bg-gray-50 transition-colors">
                <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                  {label}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <StepBadge state={state} />
                </td>
                <td className="px-3 py-3 text-sm text-gray-500 max-w-xs">
                  {showDetail ? (
                    <span className="break-words">{rawValue}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Social publish results table
// ---------------------------------------------------------------------------

function SocialPublishTable({
  results,
}: {
  results: Record<string, SocialPublishPlatformResult>;
}) {
  const entries = Object.entries(results);
  if (entries.length === 0) return <p className="text-sm text-gray-400">No platforms configured.</p>;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table
        className="min-w-full divide-y divide-gray-200"
        aria-label="Per-platform publish status"
      >
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 sm:pl-6"
            >
              Platform
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
            >
              Post ID / Error
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {entries.map(([platform, result]) => {
            const state = classifyStepState(result.status);
            const detail =
              result.error
                ? `${PLATFORM_LABELS[platform] ?? platform}: ${result.error}`
                : result.ayrshare_post_id ?? result.post_id ?? null;

            return (
              <tr key={platform} className="hover:bg-gray-50 transition-colors">
                <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                  {PLATFORM_LABELS[platform] ?? platform}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <StepBadge state={state} />
                </td>
                <td className="px-3 py-3 text-sm text-gray-500 max-w-xs">
                  {detail ? (
                    <span className="break-words">{detail}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Script text section (collapsible when long)
// ---------------------------------------------------------------------------

const SCRIPT_COLLAPSE_THRESHOLD = 400; // characters

function ScriptSection({ scriptText }: { scriptText: string }) {
  const isLong = scriptText.length > SCRIPT_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  return (
    <div>
      <div
        className={`rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-800 whitespace-pre-wrap break-words transition-all ${
          !expanded ? "max-h-28 overflow-hidden relative" : ""
        }`}
        aria-label="Generated script text"
      >
        {scriptText}
        {!expanded && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-gray-50 to-transparent"
          />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
          aria-expanded={expanded}
          aria-controls="script-content"
        >
          {expanded ? "Show less" : "Show full script"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const executionId = params.id;

  const {
    data: execution,
    error,
    isLoading,
    mutate,
  } = useSWR<ExecutionDetail>(
    executionId ? `${API_BASE}/executions/${executionId}` : null,
    fetchExecution,
    {
      // Poll while execution is running (Req 13.5 — 10s polling)
      refreshInterval: (data) =>
        data?.status === "running" ? 10_000 : 0,
      revalidateOnFocus: true,
    }
  );

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return <Spinner label="Loading execution details…" />;
  }

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------
  if (error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
        >
          <p className="font-medium">Failed to load execution details</p>
          <p className="mt-1 text-red-600">
            {error.message ?? "An unexpected error occurred."}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => mutate()}
              className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-md bg-white border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!execution) return null;

  // ---------------------------------------------------------------------------
  // Build step list for the status table
  // ---------------------------------------------------------------------------
  const { step_statuses: steps } = execution;

  const pipelineSteps: PipelineStep[] = [
    { key: "content_fetch", label: "Content fetch", rawValue: steps.content_fetch },
    { key: "script_generation", label: "Script generation", rawValue: steps.script_generation },
    { key: "video_generation", label: "Video generation", rawValue: steps.video_generation },
    { key: "drive_upload", label: "Drive upload", rawValue: steps.drive_upload },
  ];

  const hasSocialResults =
    steps.social_publish && Object.keys(steps.social_publish).length > 0;

  const isInProgress = execution.ended_at === "in progress";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-indigo-600 focus:outline-none focus:underline">
          Pipelines
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/pipelines/${execution.pipeline_id}`}
          className="hover:text-indigo-600 focus:outline-none focus:underline"
        >
          Pipeline
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium">Execution</span>
      </nav>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Execution detail
            </h1>
            <OverallStatusBadge status={execution.status} />
            {isInProgress && (
              <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">ID: {execution.id}</p>
        </div>

        <button
          type="button"
          onClick={() => mutate()}
          aria-label="Refresh execution status"
          className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* ── Execution metadata ───────────────────────────────────────────────── */}
      <section
        aria-labelledby="execution-metadata-heading"
        className="mb-6 rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
      >
        <h2 id="execution-metadata-heading" className="mb-4 text-base font-semibold text-gray-900">
          Execution overview
        </h2>
        <dl className="space-y-3">
          <InfoRow label="Status" value={<OverallStatusBadge status={execution.status} />} />
          <InfoRow label="Started" value={formatTimestamp(execution.started_at)} />
          <InfoRow
            label="Ended"
            value={
              isInProgress ? (
                <span className="italic text-blue-600">In progress</span>
              ) : (
                formatTimestamp(execution.ended_at)
              )
            }
          />
          <InfoRow label="Duration" value={formatDuration(execution.duration_ms)} />
        </dl>
      </section>

      {/* ── Failure reason ───────────────────────────────────────────────────── */}
      {execution.failure_reason && (
        <section
          aria-labelledby="failure-reason-heading"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-6 py-5"
        >
          <h2
            id="failure-reason-heading"
            className="mb-2 text-base font-semibold text-red-700"
          >
            Failure reason
          </h2>
          <p className="text-sm font-mono text-red-800 break-words" role="alert">
            {execution.failure_reason}
          </p>
        </section>
      )}

      {/* ── Per-step statuses ────────────────────────────────────────────────── */}
      <section aria-labelledby="step-statuses-heading" className="mb-6">
        <h2
          id="step-statuses-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          Pipeline steps
        </h2>
        <StepStatusTable steps={pipelineSteps} />
      </section>

      {/* ── Social publish results ───────────────────────────────────────────── */}
      <section aria-labelledby="social-publish-heading" className="mb-6">
        <h2
          id="social-publish-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          Social publish
        </h2>
        {hasSocialResults ? (
          <SocialPublishTable results={steps.social_publish!} />
        ) : (
          <p className="text-sm text-gray-400">
            {execution.status === "running"
              ? "Waiting for social publish step…"
              : "No social publish results available."}
          </p>
        )}
      </section>

      {/* ── Generated script ────────────────────────────────────────────────── */}
      <section aria-labelledby="script-heading" className="mb-6">
        <h2 id="script-heading" className="mb-3 text-base font-semibold text-gray-900">
          Generated script
        </h2>
        {execution.script_text ? (
          <ScriptSection scriptText={execution.script_text} />
        ) : (
          <p className="text-sm text-gray-400">
            {execution.status === "running"
              ? "Script will appear here once generated."
              : "No script was generated for this execution."}
          </p>
        )}
      </section>

      {/* ── Video / Drive link ───────────────────────────────────────────────── */}
      <section aria-labelledby="video-link-heading" className="mb-6">
        <h2 id="video-link-heading" className="mb-3 text-base font-semibold text-gray-900">
          Video file
        </h2>
        {execution.video_link ? (
          <a
            href={execution.video_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            aria-label="Open video in Google Drive"
          >
            {/* Drive icon */}
            <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6.5 20l-4-7 4-7h11l4 7-4 7zm1.73-2h7.54l3.77-5H5.46l2.77 5zM8 9l-2.77 5h7.54L16 9H8zm4-7l4 7H8L12 2z" />
            </svg>
            Open in Google Drive
          </a>
        ) : (
          <p className="text-sm text-gray-400">
            {execution.status === "running"
              ? "Video link will appear here once Drive upload completes."
              : "No video link available for this execution."}
          </p>
        )}
      </section>

      {/* ── Back link ───────────────────────────────────────────────────────── */}
      <div className="mt-8 border-t border-gray-100 pt-6">
        <Link
          href={`/pipelines/${execution.pipeline_id}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
          aria-label="Back to pipeline detail"
        >
          ← Back to pipeline
        </Link>
      </div>
    </div>
  );
}
