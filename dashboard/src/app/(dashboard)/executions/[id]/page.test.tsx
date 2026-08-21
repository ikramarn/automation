/**
 * Tests for the Execution Detail page
 * Requirements: 13.4
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ExecutionDetailPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "exec-test-123" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";
const mockUseSWR = vi.mocked(useSWR);

const MOCK_EXECUTION = {
  id: "exec-test-123",
  pipeline_id: "pipe-abc",
  status: "success" as const,
  started_at: "2024-01-15T09:00:00Z",
  ended_at: "2024-01-15T09:05:00Z",
  duration_ms: 300000,
  failure_reason: null,
  step_statuses: {
    content_fetch: "success",
    script_generation: "success",
    video_generation: "success",
    drive_upload: "success",
    social_publish: {
      youtube: { status: "success", post_id: "yt-vid-123" },
      tiktok: { status: "success", post_id: "tt-vid-456" },
    },
  },
  script_text: "Today in tech news, AI continues to advance rapidly...",
  video_link: "https://drive.google.com/file/d/abc123",
  heygen_video_id: "heygen-vid-abc",
  created_at: "2024-01-15T09:00:00Z",
};

describe("ExecutionDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("status", { name: /loading execution details/i })).toBeInTheDocument();
  });

  it("shows error state on fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Not found"),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders Execution detail heading", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("heading", { name: /execution detail/i })).toBeInTheDocument();
  });

  it("renders execution status badge", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    const statusBadges = screen.getAllByLabelText(/execution status: succeeded/i);
    expect(statusBadges.length).toBeGreaterThan(0);
  });

  it("renders execution overview with started/ended/duration", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByText("Execution overview")).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument(); // 300000ms = 5min
  });

  it("renders per-step status table", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("table", { name: /per-step execution status/i })).toBeInTheDocument();
    expect(screen.getByText("Content fetch")).toBeInTheDocument();
    expect(screen.getByText("Script generation")).toBeInTheDocument();
    expect(screen.getByText("Video generation")).toBeInTheDocument();
    expect(screen.getByText("Drive upload")).toBeInTheDocument();
  });

  it("renders social publish results table", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("table", { name: /per-platform publish status/i })).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();
  });

  it("renders generated script text", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByLabelText(/generated script text/i)).toBeInTheDocument();
    expect(screen.getByText(/Today in tech news/)).toBeInTheDocument();
  });

  it("renders video link when available", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    // Check for a link that has the href to Google Drive
    const driveLink = screen.getByRole("link", { name: /google drive/i });
    expect(driveLink).toHaveAttribute("href", "https://drive.google.com/file/d/abc123");
  });

  it("shows failure reason section when execution failed", () => {
    const failedExecution = {
      ...MOCK_EXECUTION,
      status: "failed" as const,
      failure_reason: "script generation: OpenAI API rate limit exceeded",
    };
    mockUseSWR.mockReturnValue({
      data: failedExecution,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/script generation: openai api rate limit exceeded/i);
  });

  it("renders breadcrumb navigation", () => {
    mockUseSWR.mockReturnValue({
      data: MOCK_EXECUTION,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    } as ReturnType<typeof useSWR>);
    render(<ExecutionDetailPage />);
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pipelines/i })).toBeInTheDocument();
  });
});
