"use client";

/**
 * useExecutionLogs
 *
 * Subscribes to Supabase Realtime changes on the `execution_logs` table for a
 * given pipeline_id. Also performs an initial SWR fetch so the component has
 * data immediately on mount without waiting for the first Realtime event.
 *
 * Requirements: 13.5 — Live execution status updates delivered via Supabase
 * Realtime to the Dashboard without manual polling.
 *
 * How it works:
 * 1. SWR fetches the current execution log list from the Backend API on mount.
 * 2. A Supabase Realtime channel subscribes to INSERT/UPDATE events on
 *    `execution_logs` filtered by `pipeline_id = eq.<pipelineId>`.
 * 3. On any change, SWR's mutate() is called to revalidate and merge the new
 *    data, keeping the UI in sync with minimal network traffic.
 * 4. The channel is cleaned up when the component unmounts.
 *
 * @param pipelineId - The UUID of the pipeline whose logs to subscribe to.
 *                     Pass null/undefined to skip subscription (no pipeline selected).
 */

import { useEffect, useRef } from "react";
import useSWR, { type KeyedMutator } from "swr";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionLog {
  id: string;
  pipeline_id: string;
  user_id: string;
  status: "running" | "success" | "failed" | "partial" | "skipped";
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  failure_reason: string | null;
  // Content fetch step
  content_fetch_status: string | null;
  content_fetch_article_url: string | null;
  content_fetch_error: string | null;
  // Script generation step
  script_gen_status: string | null;
  script_text: string | null;
  script_gen_error: string | null;
  // Video generation step
  video_gen_status: string | null;
  heygen_video_id: string | null;
  r2_object_key: string | null;
  video_file_size_bytes: number | null;
  video_gen_error: string | null;
  // Drive upload step
  drive_upload_status: string | null;
  gdrive_file_id: string | null;
  gdrive_link: string | null;
  drive_upload_error: string | null;
  // Social publish step
  social_publish_results: Record<
    string,
    {
      status: "success" | "failed" | "skipped";
      post_id?: string;
      ayrshare_post_id?: string;
      error?: string;
    }
  > | null;
  created_at: string;
}

export interface UseExecutionLogsReturn {
  logs: ExecutionLog[] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: KeyedMutator<ExecutionLog[]>;
}

// ---------------------------------------------------------------------------
// SWR fetcher — calls the Backend API endpoint
// ---------------------------------------------------------------------------

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function fetchExecutionLogs(url: string): Promise<ExecutionLog[]> {
  const res = await fetch(url, {
    credentials: "include", // send HttpOnly session cookie
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.message ?? `Failed to fetch execution logs: ${res.status}`
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExecutionLogs(
  pipelineId: string | null | undefined
): UseExecutionLogsReturn {
  const swrKey = pipelineId
    ? `${apiBaseUrl}/pipelines/${pipelineId}/executions`
    : null;

  const { data, isLoading, error, mutate } = useSWR<ExecutionLog[]>(
    swrKey,
    fetchExecutionLogs,
    {
      // Refresh every 10 seconds as a fallback in case Realtime misses an event
      // (Req 13.5 — execution status polling every 10s)
      refreshInterval: 10_000,
      // Keep stale data visible while revalidating for a smooth UX
      revalidateOnFocus: true,
    }
  );

  // Keep a stable ref to mutate so the Realtime callback doesn't recreate the
  // channel on every render
  const mutateRef = useRef(mutate);
  useEffect(() => {
    mutateRef.current = mutate;
  }, [mutate]);

  // ---------------------------------------------------------------------------
  // Supabase Realtime subscription
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pipelineId) return;

    const supabase = createClient();
    let channel: RealtimeChannel;

    channel = supabase
      .channel(`execution_logs:pipeline_id=eq.${pipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "execution_logs",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        () => {
          // New execution started — revalidate to show it immediately
          mutateRef.current();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "execution_logs",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        (payload) => {
          // An existing log was updated (e.g., step completed, status changed).
          // Optimistically patch the local SWR cache with the new row, then
          // revalidate in the background to confirm.
          mutateRef.current(
            (current) => {
              if (!current) return current;
              const updated = payload.new as ExecutionLog;
              const idx = current.findIndex((log) => log.id === updated.id);
              if (idx === -1) {
                // Not in the current page — just revalidate
                return current;
              }
              const next = [...current];
              next[idx] = updated;
              return next;
            },
            { revalidate: true }
          );
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          // Realtime connection failed — SWR polling every 10s is the fallback
          console.warn(
            `[useExecutionLogs] Realtime channel error for pipeline ${pipelineId}. ` +
              "Falling back to SWR polling."
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pipelineId]);

  return {
    logs: data,
    isLoading,
    error,
    mutate,
  };
}
