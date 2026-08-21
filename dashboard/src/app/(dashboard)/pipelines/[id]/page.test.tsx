/**
 * Tests for the Pipeline Detail page
 * Requirements: 13.3, 13.5
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PipelineDetailPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "pipe-test-123" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("@/hooks/useExecutionLogs", () => ({
  useExecutionLogs: vi.fn(),
}));

import useSWR from "swr";
import { useExecutionLogs } from "@/hooks/useExecutionLogs";
const mockUseSWR = vi.mocked(useSWR);
const mockUseExecutionLogs = vi.mocked(useExecutionLogs);

const MOCK_PIPELINE = {
  id: "pipe-test-123",
  name: "Tech News Daily",
  status: "active" as const,
  niche_keyword: "artificial intelligence",
  schedule_recurrence: "daily" as const,
  schedule_days_of_week: null,
  schedule_time_hhmm: "09:00",
  schedule_timezone: "America/New_York",
  publishing_platforms: ["youtube", "tiktok"],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T10:00:00Z",
};

describe("PipelineDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseExecutionLogs.mockReturnValue({
      logs: [],
      isLoading: false,
      error: null,
    });
  });

  it("shows loading spinner while fetching pipeline", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByRole("status", { name: /loading pipeline/i })).toBeInTheDocument();
  });

  it("shows error state on pipeline fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Not found"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders pipeline name and status badge", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByRole("heading", { name: /tech news daily/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/pipeline status: active/i).length).toBeGreaterThan(0);
  });

  it("renders pipeline details section", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByText("Pipeline details")).toBeInTheDocument();
    expect(screen.getByText("artificial intelligence")).toBeInTheDocument();
  });

  it("renders schedule information", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByText(/daily at 09:00/i)).toBeInTheDocument();
  });

  it("renders publishing platforms", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
  });

  it("renders actions section with disable button for active pipeline", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<PipelineDetailPage />);
    expect(screen.getByRole("button", { name: /disable pipeline/i })).toBeInTheDocument();
  });

  it("shows empty state when no executions", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    mockUseExecutionLogs.mockReturnValue({ logs: [], isLoading: false, error: null });
    render(<PipelineDetailPage />);
    expect(screen.getByText(/no executions yet/i)).toBeInTheDocument();
  });

  it("renders execution table when executions exist", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_PIPELINE,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    mockUseExecutionLogs.mockReturnValue({
      logs: [
        { id: "exec-1", pipeline_id: "pipe-test-123", status: "success", started_at: "2024-01-15T09:00:00Z", ended_at: "2024-01-15T09:05:00Z", duration_ms: 300000 },
      ],
      isLoading: false,
      error: null,
    });
    render(<PipelineDetailPage />);
    expect(screen.getByRole("table", { name: /execution history/i })).toBeInTheDocument();
  });
});
