"use client";

import Link from "next/link";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import QuotesTicker from "@/components/QuotesTicker";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineStatus = "active" | "paused" | "disabled" | "running";
export type ExecutionStatus = "success" | "failed" | "partial" | "skipped" | "running";

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

// ── SWR fetcher ────────────────────────────────────────────────────────────

async function fetchPipelines(url: string): Promise<Pipeline[]> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { credentials: "include", headers });
  if (res.status === 401) return [];
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Failed to fetch pipelines: ${res.status}`);
  }
  return res.json();
}

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PipelineStatus, string> = {
  active: "bg-green-100 text-green-700 ring-green-200",
  paused: "bg-amber-100 text-amber-700 ring-amber-200",
  disabled: "bg-gray-100 text-gray-500 ring-gray-200",
  running: "bg-blue-100 text-blue-700 ring-blue-200",
};
const STATUS_LABELS: Record<PipelineStatus, string> = {
  active: "Active", paused: "Paused", disabled: "Disabled", running: "Running",
};

function StatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Execution display ──────────────────────────────────────────────────────

const EXEC_STYLES: Record<ExecutionStatus, string> = {
  success: "text-green-600", failed: "text-red-600",
  partial: "text-amber-600", skipped: "text-gray-400", running: "text-blue-600",
};
const EXEC_LABELS: Record<ExecutionStatus, string> = {
  success: "Succeeded", failed: "Failed", partial: "Partial",
  skipped: "Skipped", running: "Running",
};

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LastExecution({ execution }: { execution: PipelineLastExecution | null }) {
  if (!execution) return <p className="text-sm text-gray-400">No executions yet</p>;
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${EXEC_STYLES[execution.status]}`}>{EXEC_LABELS[execution.status]}</span>
      <span className="text-sm text-gray-400">{formatTs(execution.ended_at ?? execution.started_at)}</span>
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <svg className="h-8 w-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-100 bg-indigo-50/30 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100">
        <svg className="h-8 w-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-gray-800">Create your first pipeline</h2>
      <p className="mb-6 max-w-xs text-sm text-gray-500">
        Set up an automated AI video pipeline and start publishing content across all platforms — hands-free.
      </p>
      <Link href="/pipelines/new"
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
        Get started →
      </Link>
    </div>
  );
}

// ── Pipeline card ──────────────────────────────────────────────────────────

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <li className="group">
      <Link href={`/pipelines/${pipeline.id}`}
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="truncate text-base font-semibold text-gray-900">{pipeline.name}</h2>
            <StatusBadge status={pipeline.status} />
          </div>
          <LastExecution execution={pipeline.last_execution} />
        </div>
        <svg className="hidden h-5 w-5 shrink-0 text-gray-400 transition group-hover:text-indigo-500 sm:block"
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </li>
  );
}

// ── Left panel ─────────────────────────────────────────────────────────────

function LeftPanel() {
  return (
    <aside className="hidden xl:flex xl:flex-col xl:w-60 xl:shrink-0 gap-6 pt-10 pr-6">

      {/* Animated quote */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 p-5 shadow-lg">
        <QuotesTicker vertical />
      </div>

      {/* Quick stats */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Platform Stats</p>
        <div className="space-y-3">
          {[
            { label: "Videos automated", value: "10×", color: "text-indigo-600" },
            { label: "Always publishing", value: "24/7", color: "text-purple-600" },
            { label: "Platforms supported", value: "5+", color: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{s.label}</span>
              <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Decorative dots */}
      <div className="flex justify-center gap-2 opacity-30">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`rounded-full bg-indigo-400 ${i === 1 ? "h-3 w-3" : "h-2 w-2 mt-0.5"}`} />
        ))}
      </div>
    </aside>
  );
}

// ── Right panel ─────────────────────────────────────────────────────────────

function RightPanel() {
  return (
    <aside className="hidden xl:flex xl:flex-col xl:w-56 xl:shrink-0 gap-6 pt-10 pl-6">

      {/* Quick actions */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Quick Actions</p>
        <div className="space-y-2">
          {[
            { label: "New Pipeline", href: "/pipelines/new", icon: "➕", color: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100" },
            { label: "Credentials", href: "/settings/credentials", icon: "🔑", color: "bg-gray-50 text-gray-700 hover:bg-gray-100" },
            { label: "Billing", href: "/settings/billing", icon: "💳", color: "bg-gray-50 text-gray-700 hover:bg-gray-100" },
          ].map((a) => (
            <Link key={a.href} href={a.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${a.color}`}>
              <span>{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Pipeline flow diagram — decorative */}
      <div className="rounded-2xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">Your Flow</p>
        <div className="flex flex-col items-center gap-1">
          {[
            { icon: "🔍", label: "Fetch" },
            { icon: "✍️", label: "Script" },
            { icon: "🎬", label: "Video" },
            { icon: "☁️", label: "Upload" },
            { icon: "📱", label: "Publish" },
          ].map((step, i) => (
            <div key={step.label} className="flex flex-col items-center">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs shadow-sm w-full justify-center">
                <span>{step.icon}</span>
                <span className="font-medium text-gray-700">{step.label}</span>
              </div>
              {i < 4 && (
                <div className="h-3 w-px bg-indigo-200 my-0.5" />
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: pipelines, error, isLoading, isValidating, mutate } = useSWR<Pipeline[]>(
    `${API_BASE}/pipelines`,
    fetchPipelines,
    { refreshInterval: 30_000, revalidateOnFocus: true }
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50">
      {/* Subtle background pattern */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 top-20 h-72 w-72 rounded-full bg-indigo-100/40 blur-3xl" />
        <div className="absolute -right-40 bottom-20 h-72 w-72 rounded-full bg-purple-100/40 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-50/30 blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-7xl px-4 py-8 lg:px-8">

        {/* Left panel */}
        <LeftPanel />

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Header */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Your Pipelines</h1>
              <p className="mt-1 text-sm text-gray-500">Monitor and manage your automated video pipelines.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <button type="button" onClick={() => mutate()} disabled={isValidating}
                aria-label="Refresh"
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-50 disabled:opacity-50">
                <svg className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <Link href="/pipelines/new"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
                Create pipeline
              </Link>
            </div>
          </div>

          {/* States */}
          {isLoading && <Spinner />}

          {!isLoading && error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              <p className="font-medium">Failed to load pipelines</p>
              <p className="mt-1 text-red-600">{error.message}</p>
              <button type="button" onClick={() => mutate()}
                className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200">
                Retry
              </button>
            </div>
          )}

          {!isLoading && !error && pipelines?.length === 0 && <EmptyState />}

          {!isLoading && !error && pipelines && pipelines.length > 0 && (
            <ul className="space-y-3" aria-label={`${pipelines.length} pipeline${pipelines.length !== 1 ? "s" : ""}`}>
              {pipelines.map((p) => <PipelineCard key={p.id} pipeline={p} />)}
            </ul>
          )}

          {/* Bottom quote — visible on smaller screens where side panels hide */}
          <div className="mt-12 xl:hidden rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 p-5 shadow-lg">
            <QuotesTicker />
          </div>
        </main>

        {/* Right panel */}
        <RightPanel />
      </div>
    </div>
  );
}
