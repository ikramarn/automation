"use client";

/**
 * Pipeline detail page — /pipelines/:id
 *
 * Shows pipeline metadata (name, status, schedule, niche keyword, platforms)
 * and a paginated execution history using useExecutionLogs for real-time
 * updates via Supabase Realtime.
 *
 * Requirements: 13.3, 13.5
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useExecutionLogs, type ExecutionLog } from "@/hooks/useExecutionLogs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PipelineStatus = "active" | "paused" | "disabled" | "running";

interface Pipeline {
  id: string;
  name: string;
  status: PipelineStatus;
  niche_keyword: string;
  schedule_recurrence: "daily" | "weekdays" | "custom";
  schedule_days_of_week: number[] | null;
  schedule_time_hhmm: string;
  schedule_timezone: string;
  publishing_platforms: string[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchPipeline(url: string): Promise<Pipeline> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch pipeline: ${res.status}`);
  }
  return res.json();
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf-token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");
  const data = await res.json();
  return data.csrfToken as string;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PIPELINE_STATUS_STYLES: Record<PipelineStatus, string> = {
  active: "bg-green-100 text-green-700 ring-green-200",
  paused: "bg-amber-100 text-amber-700 ring-amber-200",
  disabled: "bg-gray-100 text-gray-500 ring-gray-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
};

const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  running: "Running",
};

type ExecutionStatus = ExecutionLog["status"];

const EXEC_STATUS_STYLES: Record<ExecutionStatus, string> = {
  success: "bg-green-100 text-green-700 ring-green-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  partial: "bg-amber-100 text-amber-700 ring-amber-200",
  skipped: "bg-gray-100 text-gray-500 ring-gray-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
};

const EXEC_STATUS_LABELS: Record<ExecutionStatus, string> = {
  success: "Succeeded",
  failed: "Failed",
  partial: "Partial",
  skipped: "Skipped",
  running: "Running",
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
};

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
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

function formatSchedule(pipeline: Pipeline): string {
  const { schedule_recurrence, schedule_days_of_week, schedule_time_hhmm, schedule_timezone } =
    pipeline;
  let recurrenceLabel: string;
  if (schedule_recurrence === "daily") {
    recurrenceLabel = "Daily";
  } else if (schedule_recurrence === "weekdays") {
    recurrenceLabel = "Weekdays (Mon–Fri)";
  } else {
    const days = (schedule_days_of_week ?? [])
      .map((d) => DAY_NAMES[d] ?? String(d))
      .join(", ");
    recurrenceLabel = days || "Custom";
  }
  return `${recurrenceLabel} at ${schedule_time_hhmm} (${schedule_timezone})`;
}

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

function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${PIPELINE_STATUS_STYLES[status]}`}
      aria-label={`Pipeline status: ${PIPELINE_STATUS_LABELS[status]}`}
    >
      {PIPELINE_STATUS_LABELS[status]}
    </span>
  );
}

function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${EXEC_STATUS_STYLES[status]}`}
      aria-label={`Execution status: ${EXEC_STATUS_LABELS[status]}`}
    >
      {EXEC_STATUS_LABELS[status]}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-36 shrink-0 text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle buttons (Enable / Disable)
// ---------------------------------------------------------------------------

interface ToggleButtonsProps {
  pipelineId: string;
  status: PipelineStatus;
  onSuccess: () => void;
}

function ToggleButtons({ pipelineId, status, onSuccess }: ToggleButtonsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (action: "enable" | "disable") => {
      setBusy(true);
      setError(null);
      try {
        const csrfToken = await fetchCsrfToken();
        const res = await fetch(`${API_BASE}/pipelines/${pipelineId}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `Failed to ${action} pipeline`);
        }
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setBusy(false);
      }
    },
    [pipelineId, onSuccess]
  );

  const isDisabled = status === "disabled";
  const isRunning = status === "running";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {/* Enable button — shown when pipeline is paused or disabled */}
        {(isDisabled || status === "paused") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle("enable")}
            aria-label="Enable pipeline"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable"}
          </button>
        )}

        {/* Disable button — shown when pipeline is active or paused */}
        {(status === "active" || status === "paused") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle("disable")}
            aria-label="Disable pipeline"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50"
          >
            {busy ? "Disabling…" : "Disable"}
          </button>
        )}

        {/* Running — no toggle available */}
        {isRunning && (
          <span className="text-sm text-gray-400 italic py-2">
            Running — toggle unavailable
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execution history row
// ---------------------------------------------------------------------------

function ExecutionRow({ log }: { log: ExecutionLog }) {
  return (
    <tr className="group hover:bg-gray-50 transition-colors">
      <td className="whitespace-nowrap py-3 pl-4 pr-3 sm:pl-6">
        <ExecutionStatusBadge status={log.status} />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">
        {formatTimestamp(log.started_at)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500">
        {formatDuration(log.duration_ms)}
      </td>
      <td className="whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm sm:pr-6">
        <Link
          href={`/executions/${log.id}`}
          className="font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
          aria-label={`View execution detail for run at ${formatTimestamp(log.started_at)}`}
        >
          View
        </Link>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PipelineDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pipelineId = params.id;

  const [page, setPage] = useState(1);

  // Pipeline metadata fetch
  const {
    data: pipeline,
    error: pipelineError,
    isLoading: pipelineLoading,
    mutate: mutatePipeline,
  } = useSWR<Pipeline>(
    pipelineId ? `${API_BASE}/pipelines/${pipelineId}` : null,
    fetchPipeline,
    { revalidateOnFocus: true }
  );

  // Realtime execution logs (Req 13.5)
  const { logs, isLoading: logsLoading, error: logsError } = useExecutionLogs(pipelineId);

  // Client-side pagination of the logs returned by the hook
  const totalLogs = logs?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageOffset = (clampedPage - 1) * PAGE_SIZE;
  const pageLogs = logs?.slice(pageOffset, pageOffset + PAGE_SIZE) ?? [];

  // Reset to page 1 when new data arrives and current page is out of range
  if (page > totalPages && totalPages > 0) {
    setPage(1);
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (pipelineLoading) {
    return <Spinner label="Loading pipeline…" />;
  }

  // ---------------------------------------------------------------------------
  // Error state — pipeline not found or network error
  // ---------------------------------------------------------------------------
  if (pipelineError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
        >
          <p className="font-medium">Failed to load pipeline</p>
          <p className="mt-1 text-red-600">
            {pipelineError.message ?? "An unexpected error occurred."}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => mutatePipeline()}
              className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-md bg-white border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!pipeline) return null;

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-indigo-600 focus:outline-none focus:underline">
          Pipelines
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium truncate">{pipeline.name}</span>
      </nav>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 truncate">
              {pipeline.name}
            </h1>
            <PipelineStatusBadge status={pipeline.status} />
          </div>
          <p className="text-sm text-gray-500">Pipeline ID: {pipeline.id}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Edit link */}
          <Link
            href={`/pipelines/${pipeline.id}/edit`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            aria-label="Edit pipeline"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* ── Pipeline info card ───────────────────────────────────────────────── */}
      <section
        aria-labelledby="pipeline-info-heading"
        className="mb-8 rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
      >
        <h2
          id="pipeline-info-heading"
          className="mb-4 text-base font-semibold text-gray-900"
        >
          Pipeline details
        </h2>
        <dl className="space-y-3">
          <InfoRow label="Niche keyword" value={pipeline.niche_keyword} />
          <InfoRow label="Schedule" value={formatSchedule(pipeline)} />
          <InfoRow
            label="Platforms"
            value={
              pipeline.publishing_platforms.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {pipeline.publishing_platforms.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                    >
                      {PLATFORM_LABELS[p] ?? p}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-gray-400">No platforms configured</span>
              )
            }
          />
          <InfoRow label="Status" value={<PipelineStatusBadge status={pipeline.status} />} />
        </dl>
      </section>

      {/* ── Enable / Disable actions ─────────────────────────────────────────── */}
      <section
        aria-labelledby="pipeline-actions-heading"
        className="mb-8 rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
      >
        <h2 id="pipeline-actions-heading" className="mb-3 text-base font-semibold text-gray-900">
          Actions
        </h2>
        <ToggleButtons
          pipelineId={pipeline.id}
          status={pipeline.status}
          onSuccess={() => mutatePipeline()}
        />
      </section>

      {/* ── Execution history ────────────────────────────────────────────────── */}
      <section aria-labelledby="execution-history-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="execution-history-heading"
            className="text-base font-semibold text-gray-900"
          >
            Execution history
          </h2>
          {totalLogs > 0 && (
            <p className="text-sm text-gray-500">
              {totalLogs} execution{totalLogs !== 1 ? "s" : ""} (last 30)
            </p>
          )}
        </div>

        {/* Loading */}
        {logsLoading && <Spinner label="Loading execution history…" />}

        {/* Error */}
        {!logsLoading && logsError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
          >
            <p className="font-medium">Failed to load execution history</p>
            <p className="mt-1 text-red-600">
              {logsError.message ?? "An unexpected error occurred."}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!logsLoading && !logsError && totalLogs === 0 && (
          <div
            role="status"
            aria-label="No executions"
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12 text-center"
          >
            <svg
              aria-hidden="true"
              className="mb-3 h-10 w-10 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm font-medium text-gray-600">No executions yet</p>
            <p className="mt-1 max-w-xs text-xs text-gray-400">
              Your first execution will appear here after the pipeline runs.
            </p>
          </div>
        )}

        {/* Execution table */}
        {!logsLoading && !logsError && totalLogs > 0 && (
          <>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200" aria-label="Execution history">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 sm:pl-6"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Started
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Duration
                    </th>
                    <th scope="col" className="relative py-3 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">View</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {pageLogs.map((log) => (
                    <ExecutionRow key={log.id} log={log} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav
                aria-label="Execution history pagination"
                className="mt-4 flex items-center justify-between"
              >
                <p className="text-sm text-gray-500">
                  Page {clampedPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={clampedPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    disabled={clampedPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
