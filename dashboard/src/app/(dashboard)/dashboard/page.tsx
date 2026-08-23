"use client";

/**
 * Pipeline list dashboard — /dashboard
 *
 * Fetches all pipelines via SWR and displays them with status badges,
 * last execution result, and timestamp. Shows an empty state with a CTA
 * when no pipelines exist.
 *
 * Requirements: 13.1, 13.2, 13.8
 */

import Link from "next/link";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStatus = "active" | "paused" | "disabled" | "running";
export type ExecutionStatus =
  | "success"
  | "failed"
  | "partial"
  | "skipped"
  | "running";

export interface PipelineLastExecution {
  status: ExecutionStatus;
  ended_at: string | null;
  started_at: string;
}

export interface Pipeline {
  id: string;
  name: string;
  status: PipelineStatus;
  last_execution: PipelineLastExecution | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// SWR fetcher
// ---------------------------------------------------------------------------

async function fetchPipelines(url: string): Promise<Pipeline[]> {
  // Get the current Supabase session token to authenticate API requests
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch pipelines: ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<PipelineStatus, string> = {
  active: "bg-green-100 text-green-700 ring-green-200",
  paused: "bg-amber-100 text-amber-700 ring-amber-200",
  disabled: "bg-gray-100 text-gray-500 ring-gray-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
};

const STATUS_LABELS: Record<PipelineStatus, string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  running: "Running",
};

function StatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
      aria-label={`Pipeline status: ${STATUS_LABELS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Execution result display
// ---------------------------------------------------------------------------

const EXEC_STATUS_STYLES: Record<ExecutionStatus, string> = {
  success: "text-green-600",
  failed: "text-red-600",
  partial: "text-amber-600",
  skipped: "text-gray-400",
  running: "text-blue-600",
};

const EXEC_STATUS_LABELS: Record<ExecutionStatus, string> = {
  success: "Succeeded",
  failed: "Failed",
  partial: "Partial",
  skipped: "Skipped",
  running: "Running",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function LastExecution({
  execution,
}: {
  execution: PipelineLastExecution | null;
}) {
  if (!execution) {
    return (
      <p className="text-sm text-gray-400">
        No executions yet. Your first execution will appear here after the
        pipeline runs.
      </p>
    );
  }

  const timestamp =
    execution.ended_at ?? execution.started_at;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-sm font-medium ${EXEC_STATUS_STYLES[execution.status]}`}
        aria-label={`Last execution: ${EXEC_STATUS_LABELS[execution.status]}`}
      >
        {EXEC_STATUS_LABELS[execution.status]}
      </span>
      <span className="text-sm text-gray-400" aria-label="Last execution time">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center py-16" aria-label="Loading pipelines">
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
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16 text-center"
      role="status"
      aria-label="No pipelines"
    >
      {/* Icon */}
      <svg
        aria-hidden="true"
        className="mb-4 h-12 w-12 text-gray-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
        />
      </svg>
      <h2 className="mb-1 text-lg font-semibold text-gray-700">
        No pipelines yet
      </h2>
      <p className="mb-6 max-w-sm text-sm text-gray-400">
        Create your first pipeline to start automating AI video production and
        publishing.
      </p>
      <Link
        href="/pipelines/new"
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        aria-label="Create your first pipeline"
      >
        Create pipeline
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline card
// ---------------------------------------------------------------------------

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <li className="group relative">
      <Link
        href={`/pipelines/${pipeline.id}`}
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:flex-row sm:items-center sm:justify-between"
        aria-label={`Pipeline: ${pipeline.name}`}
      >
        {/* Left: name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="truncate text-base font-semibold text-gray-900">
              {pipeline.name}
            </h2>
            <StatusBadge status={pipeline.status} />
          </div>
          <LastExecution execution={pipeline.last_execution} />
        </div>

        {/* Right: arrow */}
        <div className="hidden sm:block shrink-0">
          <svg
            aria-hidden="true"
            className="h-5 w-5 text-gray-400 transition group-hover:text-indigo-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const {
    data: pipelines,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<Pipeline[]>(`${API_BASE}/pipelines`, fetchPipelines, {
    // Refresh every 30s to keep status badges current (Req 13.8)
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Your Pipelines
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor and manage your automated video pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Refresh button */}
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isValidating}
            aria-label="Refresh pipeline list"
            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            <svg
              aria-hidden="true"
              className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          {/* Create pipeline CTA */}
          <Link
            href="/pipelines/new"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            aria-label="Create a new pipeline"
          >
            Create pipeline
          </Link>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && <Spinner />}

      {/* Error state */}
      {!isLoading && error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
        >
          <p className="font-medium">Failed to load pipelines</p>
          <p className="mt-1 text-red-600">
            {error.message ?? "An unexpected error occurred. Please try again."}
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && pipelines?.length === 0 && <EmptyState />}

      {/* Pipeline list */}
      {!isLoading && !error && pipelines && pipelines.length > 0 && (
        <ul
          className="space-y-3"
          aria-label={`${pipelines.length} pipeline${pipelines.length !== 1 ? "s" : ""}`}
        >
          {pipelines.map((pipeline) => (
            <PipelineCard key={pipeline.id} pipeline={pipeline} />
          ))}
        </ul>
      )}
    </div>
  );
}
